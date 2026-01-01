
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
    // 更加通用的选择器：查找包含 /c/ 的链接
    item: 'li:has(a[href*="/c/"]), [data-testid^="history-item-"], .relative.group:has(a[href*="/c/"])',
    title: 'a[href*="/c/"]', 
    container: 'nav',
    menuBtn: 'button[id^="radix-"], button[aria-haspopup="menu"], .group button',
  },
  gemini: {
    item: 'div[role="listitem"], a.conversation-container, .history-item:has(a)',
    title: 'a, .conversation-title, .custom-label',
    container: 'nav',
    menuBtn: 'button[aria-haspopup="true"], .more-actions-button',
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
  
  const config = PLATFORM_CONFIG[platform];
  // 尝试多种可能的选择器组合
  let items = Array.from(document.querySelectorAll(config.item));
  
  // 如果没搜到，尝试兜底逻辑：查找所有包含对话链接的 A 标签
  if (items.length === 0) {
    items = Array.from(document.querySelectorAll('nav a[href*="/c/"]')).map(a => a.closest('li') || a.parentElement);
  }

  const results = [];
  const seenTitles = new Set();

  items.forEach((el, index) => {
    if (!el) return;
    
    const titleEl = el.querySelector(config.title) || el;
    let title = titleEl.innerText.trim().split('\n')[0]; // 只取第一行标题
    
    if (!title || title.length < 1) title = `Chat ${index + 1}`;
    
    // 生成唯一 ID
    const id = `item-${index}-${title.replace(/\s+/g, '-').substring(0, 20)}`;
    
    // 过滤掉重复的元素（某些选择器可能会选中嵌套元素）
    if (!results.some(r => r.originalElement === el)) {
      results.push({ id, title, originalElement: el });
    }
  });
  
  return results;
};

/**
 * 切换仪表盘显示
 */
const toggleDashboard = () => {
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

/**
 * 渲染仪表盘内容
 */
const renderDashboard = () => {
  const container = document.getElementById('dashboard-items-grid');
  if (!container) return;
  
  if (scannedItems.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <h3>No Chats Found</h3>
        <p>Make sure your chat history is visible in the sidebar, then try refreshing.</p>
        <button onclick="window.dispatchEvent(new CustomEvent('refresh-history'))" class="btn-primary">Scan Again</button>
      </div>
    `;
    return;
  }
  
  container.innerHTML = scannedItems.map(item => `
    <div class="chat-card ${selectedIds.has(item.id) ? 'selected' : ''}" data-id="${item.id}">
      <div class="card-icon">💬</div>
      <div class="card-title" title="${item.title}">${item.title}</div>
      <div class="card-checkbox"></div>
    </div>
  `).join('');

  // 绑定点击事件
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
  if (!container) return;

  container.querySelectorAll('.chat-card').forEach(card => {
    const id = card.getAttribute('data-id');
    if (selectedIds.has(id)) card.classList.add('selected');
    else card.classList.remove('selected');
  });

  const countLabel = document.getElementById('selected-count-label');
  if (countLabel) countLabel.innerText = `${selectedIds.size} Selected`;
  
  const deleteBtn = document.getElementById('dash-delete-btn');
  if (deleteBtn) deleteBtn.disabled = selectedIds.size === 0;
};

/**
 * 批量删除逻辑
 */
const runBatchDelete = async () => {
  const count = selectedIds.size;
  if (!confirm(`Confirm batch deletion of ${count} chats?\n\nThis will simulate clicking the 'Delete' button for each selected chat in the sidebar.`)) return;

  const platform = getPlatform();
  const deleteBtn = document.getElementById('dash-delete-btn');
  const originalText = deleteBtn.innerText;
  
  deleteBtn.innerText = 'Deleting...';
  deleteBtn.disabled = true;

  const toDelete = scannedItems.filter(item => selectedIds.has(item.id));

  for (const item of toDelete) {
    try {
      const el = item.originalElement;
      const config = PLATFORM_CONFIG[platform];
      
      // 1. 寻找菜单按钮 (...)
      let menuBtn = el.querySelector(config.menuBtn);
      
      // 特殊处理：有些菜单按钮是隐藏的，需要先 hover 或直接寻找
      if (!menuBtn) {
        // 尝试在元素内寻找任何按钮
        menuBtn = el.querySelector('button');
      }

      if (menuBtn) {
        menuBtn.click();
        await new Promise(r => setTimeout(r, 600)); // 等待菜单弹出
        
        // 2. 寻找删除选项
        const menuItems = Array.from(document.querySelectorAll('[role="menuitem"], li[role="menuitem"], button, div'));
        const deleteOption = menuItems.find(m => 
          m.innerText.toLowerCase().includes('delete') && 
          m.offsetParent !== null // 必须是可见的
        );

        if (deleteOption) {
          deleteOption.click();
          await new Promise(r => setTimeout(r, 600)); // 等待确认弹窗
          
          // 3. 寻找确认删除按钮
          const confirmButtons = Array.from(document.querySelectorAll('button'));
          const confirmBtn = confirmButtons.find(b => 
            b.innerText.toLowerCase().includes('delete') && 
            b.classList.contains('bg-red-600') || b.innerText.toLowerCase().includes('confirm')
          );
          
          if (confirmBtn) confirmBtn.click();
        }
      }
      
      selectedIds.delete(item.id);
      scannedItems = scannedItems.filter(i => i.id !== item.id);
      renderDashboard();
      updateDashboardUI();
      await new Promise(r => setTimeout(r, 1000)); // 间隔一段时间再删下一个，防止 UI 崩溃
    } catch (e) {
      console.error('Failed to delete', item.title, e);
    }
  }

  deleteBtn.innerText = originalText;
  deleteBtn.disabled = selectedIds.size === 0;
  alert('Batch operation finished.');
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
  
  const refreshHandler = () => {
    scannedItems = scanHistory();
    renderDashboard();
    updateDashboardUI();
  };
  
  document.getElementById('dash-refresh-btn').onclick = refreshHandler;
  window.addEventListener('refresh-history', refreshHandler);
  
  document.getElementById('dash-delete-btn').onclick = runBatchDelete;

  // 框选逻辑
  const grid = document.getElementById('dashboard-items-grid');
  grid.onmousedown = (e) => {
    // 只有点击空白处或网格本身才触发框选，点击卡片不触发
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

    // 检测卡片相交
    const cards = grid.querySelectorAll('.chat-card');
    cards.forEach(card => {
      const rect = card.getBoundingClientRect();
      const intersects = !(rect.right < left || rect.left > left + width || rect.bottom < top || rect.top > top + height);
      if (intersects) {
        const id = card.getAttribute('data-id');
        selectedIds.add(id);
      }
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

  // 寻找侧边栏容器
  const config = PLATFORM_CONFIG[platform];
  const nav = document.querySelector(config.container);
  if (nav) {
    // 如果已经有按钮了就不加了
    if (nav.querySelector('#history-manager-launcher')) return;
    nav.prepend(btn);
  }
};

// 监听 DOM 变化以便重新注入按钮
const observer = new MutationObserver(() => {
  injectLauncher();
  initOverlay();
});
observer.observe(document.body, { childList: true, subtree: true });

// 初始化尝试
setTimeout(() => {
  injectLauncher();
  initOverlay();
}, 1000);
