
/**
 * Global State
 */
let isDashboardOpen = false;
let scannedItems = []; 
let selectedIds = new Set();
let isDragging = false;
let startX = 0, startY = 0;
let dragBox = null;
let isProcessing = false;

const PLATFORM_CONFIG = {
  chatgpt: {
    container: 'nav',
    itemSelector: '#history a[href*="/c/"], nav a[href*="/c/"]',
    menuBtnSelector: '.trailing-pair > div:nth-child(2), .trailing, [data-testid$="-options"]',
  },
  gemini: {
    container: 'nav',
    itemSelector: 'div[role="listitem"]:has(a[href*="/app/"])',
    menuBtnSelector: 'button[aria-haspopup="true"]',
  }
};

/**
 * 极其强力的真实点击模拟
 * 包含 PointerEvents 和 MouseEvents 序列，绕过大部分 React 拦截
 */
const hardClick = (el) => {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;

  const common = { bubbles: true, cancelable: true, view: window, clientX, clientY };
  
  el.dispatchEvent(new PointerEvent('pointerdown', common));
  el.dispatchEvent(new MouseEvent('mousedown', common));
  el.focus();
  el.dispatchEvent(new PointerEvent('pointerup', common));
  el.dispatchEvent(new MouseEvent('mouseup', common));
  el.click();
};

/**
 * 按文本查找并返回元素
 */
const findElementByText = (selector, texts) => {
  const elements = Array.from(document.querySelectorAll(selector));
  return elements.find(el => {
    const content = (el.innerText || el.textContent || "").toLowerCase().trim();
    return texts.some(t => content.includes(t.toLowerCase())) && el.offsetParent !== null;
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

  items.forEach((el) => {
    const title = (el.querySelector('.truncate') || el).innerText.split('\n')[0].trim() || "Untitled";
    const url = el.getAttribute('href');
    if (!url) return;
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
    container.innerHTML = `<div class="empty-state"><h3>未找到记录</h3><p>请确保侧边栏已加载内容。</p></div>`;
    return;
  }
  container.innerHTML = scannedItems.map(item => `
    <div class="chat-card ${selectedIds.has(item.id) ? 'selected' : ''}" data-id="${item.id}">
      <div class="card-title">${item.title}</div>
      <div class="card-checkbox"></div>
    </div>
  `).join('');
  container.querySelectorAll('.chat-card').forEach(card => {
    card.onclick = () => {
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
    card.classList.toggle('selected', selectedIds.has(card.getAttribute('data-id')));
  });
  document.getElementById('selected-count-label').innerText = `已选 ${selectedIds.size} 项`;
  document.getElementById('dash-delete-btn').disabled = selectedIds.size === 0 || isProcessing;
};

/**
 * 严格批量删除逻辑
 */
const runBatchDelete = async () => {
  const idsToDelete = Array.from(selectedIds);
  if (!confirm(`确定要批量删除 ${idsToDelete.length} 条对话吗？`)) return;

  isProcessing = true;
  const platform = getPlatform();
  const config = PLATFORM_CONFIG[platform];
  const overlay = document.getElementById('history-manager-overlay');
  
  // 弱化面板，允许背景点击
  overlay.style.opacity = "0.1";
  overlay.style.pointerEvents = "none";

  for (let id of idsToDelete) {
    const item = scannedItems.find(it => it.id === id);
    if (!item || !document.body.contains(item.originalElement)) {
      console.warn(`跳过失效条目: ${item?.title}`);
      continue;
    }

    console.log(`[Manager] 正在处理: ${item.title}`);
    try {
      const row = item.originalElement;
      
      // 1. 滚动并触发悬停
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await new Promise(r => setTimeout(r, 400));

      // 2. 点击 ... 按钮
      const menuBtn = row.querySelector(config.menuBtnSelector);
      if (menuBtn) {
        hardClick(menuBtn);
        
        // 等待 500ms
        await new Promise(r => setTimeout(r, 550));

        // 3. 点击“删除”菜单项
        // ChatGPT 的删除项通常在 [role="menuitem"] 或 data-testid="delete-chat-menu-item"
        const deleteItem = findElementByText('[role="menuitem"], div, button', ['删除', 'Delete']);
        if (deleteItem) {
          hardClick(deleteItem);

          // 等待 500ms
          await new Promise(r => setTimeout(r, 550));

          // 4. 点击确认按钮
          // 通常是 data-testid="delete-conversation-confirm-button" 或红色按钮
          const confirmBtn = findElementByText('button', ['删除', 'Delete', 'Confirm', '确认']);
          if (confirmBtn) {
            hardClick(confirmBtn);
            // 每一个删除操作完成后多等一会，让 ChatGPT 同步
            await new Promise(r => setTimeout(r, 1500));
            
            selectedIds.delete(id);
            scannedItems = scannedItems.filter(it => it.id !== id);
            renderDashboard();
            updateDashboardUI();
          } else {
            console.error("未找到二次确认按钮");
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          }
        } else {
          console.error("未找到删除菜单项");
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        }
      } else {
        console.error("未找到更多按钮(...)");
      }
    } catch (err) {
      console.error("删除执行异常:", err);
    }
    await new Promise(r => setTimeout(r, 400));
  }

  overlay.style.opacity = "1";
  overlay.style.pointerEvents = "auto";
  isProcessing = false;
  updateDashboardUI();
  alert('批量删除完成。');
};

const initOverlay = () => {
  if (document.getElementById('history-manager-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'history-manager-overlay';
  overlay.innerHTML = `
    <div class="dashboard-window">
      <div class="dashboard-header">
        <div class="header-info">
          <h2>批量管理助手</h2>
          <p>请保持此页面处于活动状态直到操作完成。</p>
        </div>
        <button id="close-dash-btn">✕</button>
      </div>
      <div id="dashboard-items-grid" class="dashboard-body"></div>
      <div class="dashboard-footer">
        <span id="selected-count-label">0 项已选</span>
        <div class="footer-actions">
          <button id="dash-refresh-btn">刷新</button>
          <button id="dash-delete-btn" class="danger" disabled>批量删除</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('close-dash-btn').onclick = toggleDashboard;
  document.getElementById('dash-refresh-btn').onclick = () => { scannedItems = scanHistory(); renderDashboard(); };
  document.getElementById('dash-delete-btn').onclick = runBatchDelete;

  // 划选逻辑
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

/**
 * 安全注入 Launcher 按钮
 * 避开 React 核心节点，采用绝对/固定定位或非侵入式插入
 */
const injectLauncher = () => {
  const platform = getPlatform();
  if (!platform || document.getElementById('history-manager-launcher')) return;
  
  // 注入到 sidepanel-footer 或者直接 fixed 定位在左下角
  const btn = document.createElement('button');
  btn.id = 'history-manager-launcher';
  btn.style.position = 'fixed';
  btn.style.bottom = '20px';
  btn.style.left = '20px';
  btn.style.width = '160px';
  btn.style.zIndex = '9999';
  btn.innerHTML = `<span>⚡ 批量管理</span>`;
  btn.onclick = toggleDashboard;
  document.body.appendChild(btn);
};

const observer = new MutationObserver(() => { injectLauncher(); initOverlay(); });
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(() => { injectLauncher(); initOverlay(); }, 1500);
