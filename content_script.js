
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
    // 菜单按钮：截图显示在 .trailing-pair 中。也可能是 aria-haspopup="menu" 的按钮
    menuBtnSelector: '.trailing-pair, button[aria-haspopup="menu"], [id^="radix-"]',
    // 删除选项文本检测
    deleteText: 'delete',
    // 确认按钮文本检测
    confirmText: 'delete'
  },
  gemini: {
    container: 'nav',
    itemSelector: 'div[role="listitem"]:has(a[href*="/app/"])',
    titleSelector: 'a, .conversation-title',
    menuBtnSelector: 'button[aria-haspopup="true"]',
    deleteText: 'delete',
    confirmText: 'delete'
  }
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
  if (isProcessing) return; // 正在处理时不允许关闭或重复打开
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
        <h3>No Real Conversations Found</h3>
        <p>Ensure sidebar is expanded. If items are visible but not shown here, please scroll the sidebar to load them.</p>
        <button id="retry-scan-btn" class="btn-primary">Retry Scan</button>
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
 * 核心删除动作逻辑
 */
const runBatchDelete = async () => {
  const toDelete = scannedItems.filter(item => selectedIds.has(item.id));
  if (toDelete.length === 0) return;

  if (!confirm(`Confirm deletion of ${toDelete.length} chats? \n\nWarning: This will simulate real clicks. Please do not interact with the page during the process.`)) return;

  isProcessing = true;
  const platform = getPlatform();
  const config = PLATFORM_CONFIG[platform];
  const deleteBtn = document.getElementById('dash-delete-btn');
  const originalText = deleteBtn.innerText;
  
  deleteBtn.innerText = 'Deleting...';
  deleteBtn.disabled = true;

  for (let i = 0; i < toDelete.length; i++) {
    const item = toDelete[i];
    deleteBtn.innerText = `Deleting (${i+1}/${toDelete.length})...`;
    
    try {
      const el = item.originalElement;
      
      // 1. 滚动到该元素并点击菜单 (...)
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      await new Promise(r => setTimeout(r, 400));

      let menuBtn = el.querySelector(config.menuBtnSelector);
      if (!menuBtn) menuBtn = el.querySelector('button');
      
      if (menuBtn) {
        menuBtn.click();
        // 给 React 渲染菜单的时间
        await new Promise(r => setTimeout(r, 800));
        
        // 2. 寻找全局弹出的删除选项
        // 注意：菜单通常渲染在 body 末尾，而不是在 item 内部
        const allButtons = Array.from(document.querySelectorAll('[role="menuitem"], button, div'));
        const deleteOption = allButtons.find(m => {
          const text = m.innerText.toLowerCase();
          return text.includes(config.deleteText) && m.offsetParent !== null;
        });

        if (deleteOption) {
          deleteOption.click();
          // 等待确认对话框出现
          await new Promise(r => setTimeout(r, 800));
          
          // 3. 确认删除按钮
          const confirmButtons = Array.from(document.querySelectorAll('button'));
          const confirmBtn = confirmButtons.find(b => {
            const text = b.innerText.toLowerCase();
            const isRed = b.classList.contains('bg-red-600') || b.classList.contains('bg-red-500') || b.classList.contains('btn-danger');
            return (text.includes(config.confirmText) || text.includes('confirm')) && b.offsetParent !== null;
          });
          
          if (confirmBtn) {
            confirmBtn.click();
            // 稍等让后端处理完成
            await new Promise(r => setTimeout(r, 1200));
            
            // UI 同步
            selectedIds.delete(item.id);
            scannedItems = scannedItems.filter(it => it.id !== item.id);
            renderDashboard();
            updateDashboardUI();
          } else {
            console.warn('Could not find confirmation button for:', item.title);
          }
        } else {
          console.warn('Could not find delete option in menu for:', item.title);
          // 尝试关闭可能卡住的菜单（点击空白处）
          document.body.click();
        }
      } else {
        console.warn('Could not find menu button for:', item.title);
      }
    } catch (e) {
      console.error('Batch error for item:', item.title, e);
    }
  }

  isProcessing = false;
  deleteBtn.innerText = originalText;
  deleteBtn.disabled = selectedIds.size === 0;
  alert('Batch process completed.');
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
          <p>Click items to select, or drag to multi-select.</p>
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
    if (isProcessing) return;
    if (e.target.closest('.chat-card')) return;
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
    btn.innerHTML = `⚡ Manage Chats`;
    btn.onclick = toggleDashboard;
    nav.prepend(btn);
  }
};

const observer = new MutationObserver(() => {
  injectLauncher();
  initOverlay();
});
observer.observe(document.body, { childList: true, subtree: true });

setTimeout(() => { injectLauncher(); initOverlay(); }, 1000);
