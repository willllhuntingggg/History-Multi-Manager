
/**
 * Global State
 */
let isDashboardOpen = false;
let scannedItems = []; // { id, title, originalElement }
let selectedIds = new Set();
let isDragging = false;
let startX = 0, startY = 0;
let dragBox = null;

const PLATFORM_CONFIG = {
  chatgpt: {
    item: 'li:has(a[href^="/c/"]), li[data-testid^="history-item-"]',
    title: '.truncate',
    container: 'nav',
    menuBtn: 'button[id^="radix-"], button[aria-haspopup="menu"]',
  },
  gemini: {
    item: 'div[role="listitem"], a.conversation-container',
    title: '.conversation-title, .custom-label',
    container: 'nav',
    menuBtn: 'button[aria-haspopup="true"]',
  }
};

const getPlatform = () => {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
  if (host.includes('gemini.google.com')) return 'gemini';
  return null;
};

/**
 * 扫描当前页面侧边栏已加载的对话
 */
const scanHistory = () => {
  const platform = getPlatform();
  if (!platform) return [];
  
  const items = document.querySelectorAll(PLATFORM_CONFIG[platform].item);
  const results = [];
  
  items.forEach((el, index) => {
    const titleEl = el.querySelector(PLATFORM_CONFIG[platform].title);
    const title = titleEl ? titleEl.innerText.trim() : `Untitled Chat ${index + 1}`;
    // 使用索引和标题组合作为 ID 避免重复
    const id = `item-${index}-${title.substring(0, 10)}`;
    results.push({ id, title, originalElement: el });
  });
  
  return results;
};

/**
 * 切换仪表盘显示
 */
const toggleDashboard = () => {
  isDashboardOpen = !isDashboardOpen;
  const overlay = document.getElementById('history-manager-overlay');
  
  if (isDashboardOpen) {
    scannedItems = scanHistory();
    selectedIds.clear();
    renderDashboard();
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden'; // 禁止页面滚动
  } else {
    overlay.style.display = 'none';
    document.body.style.overflow = '';
  }
};

/**
 * 渲染仪表盘内容
 */
const renderDashboard = () => {
  const container = document.getElementById('dashboard-items-grid');
  if (!container) return;
  
  container.innerHTML = scannedItems.map(item => `
    <div class="chat-card ${selectedIds.has(item.id) ? 'selected' : ''}" data-id="${item.id}">
      <div class="card-icon">💬</div>
      <div class="card-title">${item.title}</div>
      <div class="card-checkbox"></div>
    </div>
  `).join('');

  // 重新绑定点击事件
  container.querySelectorAll('.chat-card').forEach(card => {
    card.onclick = (e) => {
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
  container.querySelectorAll('.chat-card').forEach(card => {
    const id = card.getAttribute('data-id');
    if (selectedIds.has(id)) card.classList.add('selected');
    else card.classList.remove('selected');
  });

  document.getElementById('selected-count-label').innerText = `${selectedIds.size} Selected`;
  document.getElementById('dash-delete-btn').disabled = selectedIds.size === 0;
};

/**
 * 批量删除逻辑
 */
const runBatchDelete = async () => {
  const count = selectedIds.size;
  if (!confirm(`Are you sure to delete ${count} chats?\nThis will automate clicks on your sidebar.`)) return;

  const platform = getPlatform();
  const deleteBtn = document.getElementById('dash-delete-btn');
  deleteBtn.innerText = 'Deleting...';
  deleteBtn.disabled = true;

  const toDelete = scannedItems.filter(item => selectedIds.has(item.id));

  for (const item of toDelete) {
    try {
      const el = item.originalElement;
      const menuBtn = el.querySelector(PLATFORM_CONFIG[platform].menuBtn);
      if (menuBtn) {
        menuBtn.click();
        await new Promise(r => setTimeout(r, 500));
        
        const menuItems = document.querySelectorAll('[role="menuitem"], li[role="menuitem"], .flex.items-center.gap-2.p-3');
        for (const m of Array.from(menuItems)) {
          if (m.innerText.toLowerCase().includes('delete')) {
            m.click();
            await new Promise(r => setTimeout(r, 500));
            const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.toLowerCase().includes('delete'));
            if (confirmBtn) confirmBtn.click();
            break;
          }
        }
      }
      selectedIds.delete(item.id);
      renderDashboard();
      updateDashboardUI();
      await new Promise(r => setTimeout(r, 700));
    } catch (e) {
      console.error('Failed to delete', item.title, e);
    }
  }

  deleteBtn.innerText = 'Delete Selected';
  alert('Batch deletion complete.');
};

/**
 * 初始化弹窗 DOM
 */
const initOverlay = () => {
  if (document.getElementById('history-manager-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'history-manager-overlay';
  overlay.innerHTML = `
    <div class="dashboard-window">
      <div class="dashboard-header">
        <div class="header-info">
          <h2>Chat History Manager</h2>
          <p>Drag to select multiple chats. Only currently loaded items are shown.</p>
        </div>
        <button id="close-dash-btn">✕</button>
      </div>
      
      <div id="dashboard-items-grid" class="dashboard-body">
        <!-- Cards will be injected here -->
      </div>

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

  // 绑定基础事件
  document.getElementById('close-dash-btn').onclick = toggleDashboard;
  document.getElementById('dash-refresh-btn').onclick = () => {
    scannedItems = scanHistory();
    renderDashboard();
    updateDashboardUI();
  };
  document.getElementById('dash-delete-btn').onclick = runBatchDelete;

  // 框选逻辑
  const grid = document.getElementById('dashboard-items-grid');
  grid.onmousedown = (e) => {
    if (e.target !== grid && !grid.contains(e.target)) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
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

    // 检测卡片相交
    const cards = grid.querySelectorAll('.chat-card');
    cards.forEach(card => {
      const rect = card.getBoundingClientRect();
      const intersects = !(rect.right < left || rect.left > left + width || rect.bottom < top || rect.top > top + height);
      const id = card.getAttribute('data-id');
      if (intersects) selectedIds.add(id);
    });
    updateDashboardUI();
  };

  window.onmouseup = () => {
    isDragging = false;
    if (dragBox) { dragBox.remove(); dragBox = null; }
  };
};

/**
 * 注入页面上的启动按钮
 */
const injectLauncher = () => {
  const platform = getPlatform();
  if (!platform || document.getElementById('history-manager-launcher')) return;

  const btn = document.createElement('button');
  btn.id = 'history-manager-launcher';
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/></svg>
    Bulk Manage
  `;
  btn.onclick = toggleDashboard;

  const nav = document.querySelector(PLATFORM_CONFIG[platform].container);
  if (nav) nav.prepend(btn);
};

const observer = new MutationObserver(() => {
  injectLauncher();
  initOverlay();
});
observer.observe(document.body, { childList: true, subtree: true });

initOverlay();
