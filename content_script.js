
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
    itemSelector: 'a[data-sidebar-item="true"][href*="/c/"]',
    titleSelector: '.truncate span, .truncate',
    menuBtnSelector: '.trailing-pair, button[aria-haspopup="menu"], [id^="radix-"]',
    // 菜单中的删除选项文字（支持中英文）
    deleteOptionTexts: ['delete', '删除'],
    // 确认弹窗中的红色删除按钮选择器（来自用户截图：data-testid="delete-conversation-confirm-button"）
    confirmBtnSelector: '[data-testid="delete-conversation-confirm-button"]',
    confirmBtnTexts: ['delete', '删除', 'confirm', '确认']
  },
  gemini: {
    container: 'nav',
    itemSelector: 'div[role="listitem"]:has(a[href*="/app/"])',
    titleSelector: 'a, .conversation-title',
    menuBtnSelector: 'button[aria-haspopup="true"]',
    deleteOptionTexts: ['delete', '删除'],
    confirmBtnSelector: 'button',
    confirmBtnTexts: ['delete', '删除', 'confirm', '确认']
  }
};

/**
 * 辅助函数：等待元素出现
 */
const waitForElement = (selector, predicate, timeout = 5000) => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const check = () => {
      const elements = Array.from(document.querySelectorAll(selector));
      const found = predicate ? elements.find(predicate) : elements[0];
      if (found) {
        resolve(found);
      } else if (Date.now() - startTime > timeout) {
        reject(new Error(`Timeout waiting for ${selector}`));
      } else {
        setTimeout(check, 100);
      }
    };
    check();
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
    const titleEl = el.querySelector(config.titleSelector);
    if (!titleEl) return;

    let title = titleEl.innerText.trim();
    const url = el.getAttribute('href');
    if (!title || title.length < 1) return;

    const id = url ? `id-${url.split('/').pop()}` : `item-${index}`;

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
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📂</div>
        <h3>No Conversations Found</h3>
        <p>Ensure sidebar is expanded and you have some history. Scroll to load more items.</p>
        <button id="retry-scan-btn" class="btn-primary">Refresh List</button>
      </div>
    `;
    document.getElementById('retry-scan-btn')?.addEventListener('click', () => {
      scannedItems = scanHistory();
      renderDashboard();
    });
    return;
  }
  
  container.innerHTML = scannedItems.map(item => `
    <div class="chat-card ${selectedIds.has(item.id) ? 'selected' : ''}" data-id="${item.id}">
      <div class="card-icon">💬</div>
      <div class="card-title" title="${item.title}">${item.title}</div>
      <div class="card-checkbox"></div>
    </div>
  `).join('');

  container.querySelectorAll('.chat-card').forEach(card => {
    card.onclick = (e) => {
      if (isProcessing) return;
      const id = card.getAttribute('data-id');
      if (selectedIds.has(id)) selectedIds.delete(id);
      else selectedIds.add(id);
      updateDashboardUI();
      e.stopPropagation();
    };
  });
};

const updateDashboardUI = () => {
  const container = document.getElementById('dashboard-items-grid');
  if (!container) return;

  container.querySelectorAll('.chat-card').forEach(card => {
    const id = card.getAttribute('data-id');
    if (selectedIds.has(id)) card.classList.add('selected');
    else card.classList.remove('selected');
  });

  const countLabel = document.getElementById('selected-count-label');
  if (countLabel) countLabel.innerText = `${selectedIds.size} Selected`;
  
  const deleteBtn = document.getElementById('dash-delete-btn');
  if (deleteBtn) deleteBtn.disabled = selectedIds.size === 0 || isProcessing;
};

/**
 * 核心批量删除逻辑
 */
const runBatchDelete = async () => {
  const toDelete = scannedItems.filter(item => selectedIds.has(item.id));
  if (toDelete.length === 0) return;

  if (!confirm(`Confirm batch deletion of ${toDelete.length} chats?\nThis will take a moment.`)) return;

  isProcessing = true;
  const platform = getPlatform();
  const config = PLATFORM_CONFIG[platform];
  const deleteBtn = document.getElementById('dash-delete-btn');
  const originalText = deleteBtn.innerText;
  
  deleteBtn.innerText = 'Initializing...';
  deleteBtn.disabled = true;

  for (let i = 0; i < toDelete.length; i++) {
    const item = toDelete[i];
    deleteBtn.innerText = `Deleting ${i+1}/${toDelete.length}: ${item.title.substring(0, 10)}...`;
    
    try {
      const el = item.originalElement;
      
      // 1. 确保元素在可见范围内并悬停
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await new Promise(r => setTimeout(r, 400));

      // 2. 点击菜单按钮
      let menuBtn = el.querySelector(config.menuBtnSelector);
      if (!menuBtn) menuBtn = el.querySelector('button');

      if (menuBtn) {
        menuBtn.click();
        
        // 3. 等待一级菜单项（"Delete"）
        try {
          const deleteOption = await waitForElement(
            '[role="menuitem"], button, div',
            (m) => {
              const text = m.innerText.toLowerCase();
              return config.deleteOptionTexts.some(t => text.includes(t)) && m.offsetParent !== null;
            }
          );
          deleteOption.click();
          
          // 4. 等待二级确认弹窗按钮
          // 优先使用精准的 data-testid，如果没有则根据文字寻找
          const confirmBtn = await waitForElement(
            config.confirmBtnSelector + ', button',
            (b) => {
              const text = b.innerText.toLowerCase();
              // 如果是通过属性匹配到的
              if (b.matches(config.confirmBtnSelector)) return true;
              // 否则通过文字和样式属性匹配
              const isDanger = b.classList.contains('btn-danger') || b.classList.contains('bg-red-600');
              return config.confirmBtnTexts.some(t => text.includes(t)) && b.offsetParent !== null;
            }
          );
          
          confirmBtn.click();

          // 等待删除网络请求和 UI 动画完成
          await new Promise(r => setTimeout(r, 2000));
          
          // 更新管理面板 UI
          selectedIds.delete(item.id);
          scannedItems = scannedItems.filter(it => it.id !== item.id);
          renderDashboard();
          updateDashboardUI();
        } catch (innerError) {
          console.error(`Step failed for ${item.title}:`, innerError);
          // 尝试关闭可能遮挡的弹窗
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          await new Promise(r => setTimeout(r, 500));
        }
      }
    } catch (e) {
      console.error('Batch error for item:', item.title, e);
    }
    
    await new Promise(r => setTimeout(r, 500));
  }

  isProcessing = false;
  deleteBtn.innerText = originalText;
  updateDashboardUI();
  alert('Batch process finished.');
};

const initOverlay = () => {
  if (document.getElementById('history-manager-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'history-manager-overlay';
  overlay.innerHTML = `
    <div class="dashboard-window">
      <div class="dashboard-header">
        <div class="header-info">
          <h2>Bulk Manage History</h2>
          <p>Multi-select chats using click or drag. Deletion simulates manual clicks.</p>
        </div>
        <button id="close-dash-btn">✕</button>
      </div>
      <div id="dashboard-items-grid" class="dashboard-body"></div>
      <div class="dashboard-footer">
        <span id="selected-count-label">0 Selected</span>
        <div class="footer-actions">
          <button id="dash-refresh-btn">Refresh List</button>
          <button id="dash-delete-btn" class="danger" disabled>Delete Selected</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('close-dash-btn').onclick = toggleDashboard;
  document.getElementById('dash-refresh-btn').onclick = () => {
    if (isProcessing) return;
    scannedItems = scanHistory();
    renderDashboard();
    updateDashboardUI();
  };
  document.getElementById('dash-delete-btn').onclick = runBatchDelete;

  const grid = document.getElementById('dashboard-items-grid');
  grid.onmousedown = (e) => {
    if (isProcessing || e.target.closest('.chat-card')) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    if (dragBox) dragBox.remove();
    dragBox = document.createElement('div');
    dragBox.className = 'dashboard-drag-box';
    document.body.appendChild(dragBox);
  };

  window.onmousemove = (e) => {
    if (!isDragging || !dragBox) return;
    const left = Math.min(startX, e.clientX);
    const top = Math.min(startY, e.clientY);
    const width = Math.abs(e.clientX - startX);
    const height = Math.abs(e.clientY - startY);
    dragBox.style.left = `${left}px`;
    dragBox.style.top = `${top}px`;
    dragBox.style.width = `${width}px`;
    dragBox.style.height = `${height}px`;

    const cards = grid.querySelectorAll('.chat-card');
    cards.forEach(card => {
      const rect = card.getBoundingClientRect();
      const intersects = !(rect.right < left || rect.left > left + width || rect.bottom < top || rect.top > top + height);
      if (intersects) selectedIds.add(card.getAttribute('data-id'));
    });
    updateDashboardUI();
  };

  window.onmouseup = () => {
    isDragging = false;
    if (dragBox) { dragBox.remove(); dragBox = null; }
  };
};

const injectLauncher = () => {
  const platform = getPlatform();
  if (!platform || document.getElementById('history-manager-launcher')) return;
  const config = PLATFORM_CONFIG[platform];
  const nav = document.querySelector(config.container);
  if (nav) {
    const btn = document.createElement('button');
    btn.id = 'history-manager-launcher';
    btn.innerHTML = `<span>⚡ Bulk Manage History</span>`;
    btn.onclick = toggleDashboard;
    nav.prepend(btn);
  }
};

const observer = new MutationObserver(() => {
  injectLauncher();
  initOverlay();
});
observer.observe(document.body, { childList: true, subtree: true });

setTimeout(() => { injectLauncher(); initOverlay(); }, 1500);
