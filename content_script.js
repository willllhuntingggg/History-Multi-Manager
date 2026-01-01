
/**
 * Global State
 */
let isDashboardOpen = false;
let scannedItems = []; // { id, title, originalElement, url }
let selectedIds = new Set();
let isDragging = false;
let startX = 0, startY = 0;
let dragBox = null;

const PLATFORM_CONFIG = {
  chatgpt: {
    // 侧边栏对话条目的容器
    container: 'nav',
    // 查找所有对话链接，ChatGPT 对话链接通常包含 /c/
    itemSelector: 'li:has(a[href*="/c/"])',
    // 标题通常在 a 标签内的 div 中
    titleSelector: 'a[href*="/c/"]',
    // 菜单按钮通常是 a 标签同级的 button 或内部的 radix 按钮
    menuBtnSelector: 'button[aria-haspopup="menu"], button[id^="radix-"], .group button'
  },
  gemini: {
    container: 'nav',
    itemSelector: 'div[role="listitem"]:has(a[href*="/app/"])',
    titleSelector: 'a',
    menuBtnSelector: 'button[aria-haspopup="true"]'
  }
};

const getPlatform = () => {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
  if (host.includes('gemini.google.com')) return 'gemini';
  return null;
};

/**
 * 深度扫描真实对话历史
 */
const scanHistory = () => {
  const platform = getPlatform();
  if (!platform) return [];
  
  const config = PLATFORM_CONFIG[platform];
  // 获取所有可能的条目
  const items = Array.from(document.querySelectorAll(config.itemSelector));
  const results = [];

  items.forEach((el, index) => {
    // 提取标题：优先找链接里的文本，过滤掉多余的换行和空白
    const linkEl = el.querySelector(config.titleSelector);
    if (!linkEl) return;

    // 尝试获取最纯净的标题文本
    // ChatGPT 的结构通常是 <a><div>...title...</div></a>
    let title = linkEl.innerText.split('\n')[0].trim();
    const url = linkEl.getAttribute('href');

    // 过滤掉明显的非对话项（如“New Chat”）
    if (!title || title.toLowerCase().includes('new chat') || title.length < 1) return;

    // 生成唯一标识，使用 URL 或 索引+标题
    const id = url ? `id-${url.split('/').pop()}` : `item-${index}`;

    // 避免重复抓取
    if (!results.some(r => r.id === id)) {
      results.push({
        id,
        title,
        url,
        originalElement: el
      });
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
        <div class="empty-icon">📂</div>
        <h3>No Real Conversations Found</h3>
        <p>We couldn't detect your chat list. Please make sure the sidebar is open and you are logged in.</p>
        <button id="retry-scan-btn" class="btn-primary">Try Deep Scan</button>
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
  if (countLabel) countLabel.innerText = `${selectedIds.size} Chats Selected`;
  
  const deleteBtn = document.getElementById('dash-delete-btn');
  if (deleteBtn) deleteBtn.disabled = selectedIds.size === 0;
};

/**
 * 自动化批量删除逻辑
 */
const runBatchDelete = async () => {
  const toDelete = scannedItems.filter(item => selectedIds.has(item.id));
  if (toDelete.length === 0) return;

  if (!confirm(`Confirm deletion of ${toDelete.length} conversations?\nThis will interact with the sidebar buttons automatically.`)) return;

  const platform = getPlatform();
  const deleteBtn = document.getElementById('dash-delete-btn');
  const originalText = deleteBtn.innerText;
  
  deleteBtn.innerText = 'Processing...';
  deleteBtn.disabled = true;

  for (const item of toDelete) {
    try {
      const el = item.originalElement;
      const config = PLATFORM_CONFIG[platform];
      
      // 1. 触发菜单按钮
      let menuBtn = el.querySelector(config.menuBtnSelector);
      
      // 如果没找到，尝试在 el 中找任何有 "..." 或 "More" 的按钮
      if (!menuBtn) {
        menuBtn = Array.from(el.querySelectorAll('button')).find(b => b.innerText.includes('...') || b.getAttribute('aria-haspopup'));
      }

      if (menuBtn) {
        menuBtn.click();
        await new Promise(r => setTimeout(r, 700)); // 稍长一点等待 React 渲染菜单
        
        // 2. 寻找删除选项（通常在 body 底部或 portal 中）
        const allPossibleMenuItems = Array.from(document.querySelectorAll('[role="menuitem"], button, div'));
        const deleteOption = allPossibleMenuItems.find(m => 
          m.innerText.toLowerCase().includes('delete') && 
          m.offsetParent !== null
        );

        if (deleteOption) {
          deleteOption.click();
          await new Promise(r => setTimeout(r, 700));
          
          // 3. 寻找确认按钮
          const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => 
            (b.innerText.toLowerCase().includes('delete') || b.innerText.toLowerCase().includes('confirm')) &&
            (b.classList.contains('bg-red-600') || b.classList.contains('btn-danger') || b.style.backgroundColor.includes('red'))
          );
          
          if (confirmBtn) {
            confirmBtn.click();
            // 成功后在 UI 中移除
            selectedIds.delete(item.id);
            scannedItems = scannedItems.filter(i => i.id !== item.id);
            renderDashboard();
            updateDashboardUI();
          }
        }
      }
      await new Promise(r => setTimeout(r, 800)); // 间隔
    } catch (e) {
      console.error('Batch delete error for:', item.title, e);
    }
  }

  deleteBtn.innerText = originalText;
  deleteBtn.disabled = selectedIds.size === 0;
};

/**
 * 初始化
 */
const initOverlay = () => {
  if (document.getElementById('history-manager-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'history-manager-overlay';
  overlay.innerHTML = `
    <div class="dashboard-window">
      <div class="dashboard-header">
        <div class="header-info">
          <h2>Batch History Manager</h2>
          <p>Scanned conversations from your sidebar. Drag to select.</p>
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
    scannedItems = scanHistory();
    renderDashboard();
    updateDashboardUI();
  };
  document.getElementById('dash-delete-btn').onclick = runBatchDelete;

  // 框选逻辑
  const grid = document.getElementById('dashboard-items-grid');
  grid.onmousedown = (e) => {
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
    btn.innerHTML = `<span>⚡ Manage History</span>`;
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
