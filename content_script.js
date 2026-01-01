
/**
 * Global State
 */
let isDashboardOpen = false;
let scannedItems = []; // { id, title, originalElement, url }
let selectedIds = new Set();
let isDragging = false;
let startX = 0, startY = 0;
let dragBox = null;
let isProcessing = false;

const PLATFORM_CONFIG = {
  chatgpt: {
    container: 'nav, [role="navigation"]',
    // 适配用户提供的 #history > a 结构
    itemSelector: '#history a[href*="/c/"], nav a[href*="/c/"]',
    titleSelector: '.truncate',
    // 更多按钮：用户提供的 Selector 指向 .trailing-pair 内部的第二个 div
    menuBtnSelector: '.trailing-pair > div:nth-child(2), .trailing, [data-testid$="-options"]',
    // 删除菜单项：data-testid="delete-chat-menu-item"
    deleteOptionSelector: '[data-testid="delete-chat-menu-item"]',
    // 确认按钮：data-testid="delete-conversation-confirm-button"
    confirmBtnSelector: '[data-testid="delete-conversation-confirm-button"]',
    deleteTexts: ['删除', 'delete'],
  },
  gemini: {
    container: 'nav',
    itemSelector: 'div[role="listitem"]:has(a[href*="/app/"])',
    titleSelector: 'a, .conversation-title',
    menuBtnSelector: 'button[aria-haspopup="true"]',
    deleteOptionSelector: '[role="menuitem"]',
    confirmBtnSelector: 'button',
    deleteTexts: ['删除', 'delete'],
  }
};

/**
 * 模拟真实点击（包含 mousedown/mouseup）
 */
const simulateRealClick = (element) => {
  if (!element) return;
  const opts = { bubbles: true, cancelable: true, view: window };
  element.dispatchEvent(new MouseEvent('mousedown', opts));
  element.dispatchEvent(new MouseEvent('mouseup', opts));
  element.click();
};

/**
 * 辅助函数：全局等待元素
 */
const waitForGlobalElement = (selector, timeout = 4000) => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const timer = setInterval(() => {
      const el = document.querySelector(selector);
      if (el && el.offsetParent !== null) { // 确保可见
        clearInterval(timer);
        resolve(el);
      } else if (Date.now() - startTime > timeout) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for: ${selector}`));
      }
    }, 100);
  });
};

const getPlatform = () => {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
  if (host.includes('gemini.google.com')) return 'gemini';
  return null;
};

const scanHistory = () => {
  const platform = getPlatform();
  if (!platform) return [];
  const config = PLATFORM_CONFIG[platform];
  const items = Array.from(document.querySelectorAll(config.itemSelector));
  const results = [];

  items.forEach((el, index) => {
    const titleEl = el.querySelector(config.titleSelector) || el;
    const title = titleEl.innerText.trim();
    const url = el.getAttribute('href');
    if (!title || !url) return;
    const id = `id-${url.split('/').pop()}`;
    if (!results.some(r => r.id === id)) {
      results.push({ id, title, url, originalElement: el });
    }
  });
  return results;
};

const toggleDashboard = () => {
  if (isProcessing) return;
  const overlay = document.getElementById('history-manager-overlay');
  if (!overlay) return;

  isDashboardOpen = !isDashboardOpen;
  if (isDashboardOpen) {
    scannedItems = scanHistory();
    selectedIds.clear();
    renderDashboard();
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  } else {
    overlay.style.display = 'none';
    document.body.style.overflow = '';
  }
};

const renderDashboard = () => {
  const container = document.getElementById('dashboard-items-grid');
  if (!container) return;
  
  if (scannedItems.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>No History Found</h3><p>Please expand sidebar and refresh.</p></div>`;
    return;
  }
  
  container.innerHTML = scannedItems.map(item => `
    <div class="chat-card ${selectedIds.has(item.id) ? 'selected' : ''}" data-id="${item.id}">
      <div class="card-title">${item.title}</div>
      <div class="card-checkbox"></div>
    </div>
  `).join('');

  container.querySelectorAll('.chat-card').forEach(card => {
    card.onclick = (e) => {
      const id = card.getAttribute('data-id');
      if (selectedIds.has(id)) selectedIds.delete(id);
      else selectedIds.add(id);
      updateDashboardUI();
    };
  });
};

const updateDashboardUI = () => {
  const container = document.getElementById('dashboard-items-grid');
  if (!container) return;
  container.querySelectorAll('.chat-card').forEach(card => {
    if (selectedIds.has(card.getAttribute('data-id'))) card.classList.add('selected');
    else card.classList.remove('selected');
  });
  document.getElementById('selected-count-label').innerText = `${selectedIds.size} Selected`;
  document.getElementById('dash-delete-btn').disabled = selectedIds.size === 0 || isProcessing;
};

/**
 * 批量删除核心逻辑
 */
const runBatchDelete = async () => {
  const idsToDelete = Array.from(selectedIds);
  if (!confirm(`Confirm batch deletion of ${idsToDelete.length} chats?`)) return;

  isProcessing = true;
  const config = PLATFORM_CONFIG[getPlatform()];
  const deleteBtn = document.getElementById('dash-delete-btn');
  const overlay = document.getElementById('history-manager-overlay');

  // 1. 临时降低面板透明度，防止遮挡底层元素点击
  overlay.style.pointerEvents = 'none';
  overlay.style.opacity = '0.4';

  for (let i = 0; i < idsToDelete.length; i++) {
    const id = idsToDelete[i];
    const item = scannedItems.find(it => it.id === id);
    if (!item) continue;

    console.log(`[Batch] Attempting to delete: ${item.title}`);
    
    try {
      const el = item.originalElement;
      
      // A. 滚动并激活悬停状态（使更多按钮出现）
      el.scrollIntoView({ block: 'center' });
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await new Promise(r => setTimeout(r, 600));

      // B. 寻找并点击更多按钮 (...)
      const menuBtn = el.querySelector(config.menuBtnSelector);
      if (menuBtn) {
        simulateRealClick(menuBtn);
        
        // C. 等待并点击“删除”菜单项
        try {
          const deleteMenuItem = await waitForGlobalElement(config.deleteOptionSelector);
          simulateRealClick(deleteMenuItem);
          
          // D. 等待并点击“二次确认”按钮
          const confirmBtn = await waitForGlobalElement(config.confirmBtnSelector);
          simulateRealClick(confirmBtn);

          // 等待 UI 响应
          await new Promise(r => setTimeout(r, 1500));
          
          // 成功后更新状态
          selectedIds.delete(id);
          scannedItems = scannedItems.filter(it => it.id !== id);
          renderDashboard();
          updateDashboardUI();
        } catch (stepErr) {
          console.error(`Step failed for ${item.title}:`, stepErr);
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        }
      }
    } catch (e) {
      console.error(`Batch error on ${item.title}:`, e);
    }
    
    await new Promise(r => setTimeout(r, 500));
  }

  // 恢复面板
  overlay.style.pointerEvents = 'auto';
  overlay.style.opacity = '1';
  isProcessing = false;
  updateDashboardUI();
  alert('Batch deletion process completed.');
};

const initOverlay = () => {
  if (document.getElementById('history-manager-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'history-manager-overlay';
  overlay.innerHTML = `
    <div class="dashboard-window">
      <div class="dashboard-header">
        <div class="header-info">
          <h2>History Manager</h2>
          <p>Click or drag to select chats for deletion.</p>
        </div>
        <button id="close-dash-btn">✕</button>
      </div>
      <div id="dashboard-items-grid" class="dashboard-body"></div>
      <div class="dashboard-footer">
        <span id="selected-count-label">0 Selected</span>
        <div class="footer-actions">
          <button id="dash-refresh-btn">Refresh</button>
          <button id="dash-delete-btn" class="danger" disabled>Delete Selected</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('close-dash-btn').onclick = toggleDashboard;
  document.getElementById('dash-refresh-btn').onclick = () => { scannedItems = scanHistory(); renderDashboard(); };
  document.getElementById('dash-delete-btn').onclick = runBatchDelete;

  // 拖拽逻辑保持不变
  const grid = document.getElementById('dashboard-items-grid');
  grid.onmousedown = (e) => {
    if (isProcessing || e.target.closest('.chat-card')) return;
    isDragging = true; startX = e.clientX; startY = e.clientY;
    dragBox = document.createElement('div');
    dragBox.className = 'dashboard-drag-box';
    document.body.appendChild(dragBox);
  };
  window.onmousemove = (e) => {
    if (!isDragging || !dragBox) return;
    const l = Math.min(startX, e.clientX), t = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);
    dragBox.style.left = `${l}px`; dragBox.style.top = `${t}px`;
    dragBox.style.width = `${w}px`; dragBox.style.height = `${h}px`;
    grid.querySelectorAll('.chat-card').forEach(card => {
      const r = card.getBoundingClientRect();
      if (!(r.right < l || r.left > l+w || r.bottom < t || r.top > t+h)) selectedIds.add(card.getAttribute('data-id'));
    });
    updateDashboardUI();
  };
  window.onmouseup = () => { isDragging = false; dragBox?.remove(); dragBox = null; };
};

const injectLauncher = () => {
  const platform = getPlatform();
  if (!platform || document.getElementById('history-manager-launcher')) return;
  const nav = document.querySelector(PLATFORM_CONFIG[platform].container);
  if (nav) {
    const btn = document.createElement('button');
    btn.id = 'history-manager-launcher';
    btn.innerHTML = `<span>⚡ Bulk Manage</span>`;
    btn.onclick = toggleDashboard;
    nav.prepend(btn);
  }
};

const observer = new MutationObserver(() => { injectLauncher(); initOverlay(); });
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(() => { injectLauncher(); initOverlay(); }, 1500);
