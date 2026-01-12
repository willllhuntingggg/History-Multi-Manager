
/**
 * Global State
 */
let isDashboardOpen = false;
let isTOCSidebarOpen = false; 
let scannedItems = []; 
let selectedIds = new Set();
let baseSelection = new Set(); 
let pivotId = null; 
let availableProjects = []; 
let isProcessing = false;
let searchQuery = ''; 

// 定义支持的平台配置
const PLATFORM_CONFIG = {
  chatgpt: {
    name: 'ChatGPT',
    enabled: true,
    linkSelector: 'a[data-sidebar-item="true"]',
    urlPattern: /^\/c\/[a-z0-9-]{10,}$/i, 
    menuBtnSelector: 'button[data-testid*="-options"]',
    deleteBtnSelector: '[data-testid="delete-chat-menu-item"]',
    confirmBtnSelector: '[data-testid="delete-conversation-confirm-button"]',
    moveLabel: '移至项目',
    projectItemSelector: '[role="menuitem"]',
    // 登录标识：用户头像/菜单按钮
    loginIndicator: '[data-testid="user-menu-button"]'
  }
};

/**
 * HTML 转义工具
 */
const escapeHTML = (str) => {
  if (!str) return "";
  return str.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
};

/**
 * TOC 功能逻辑
 */
const initTOC = () => {
  if (document.getElementById('chat-toc-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'chat-toc-panel';
  panel.innerHTML = `
    <div class="toc-header">
      <span class="toc-header-title">会话目录</span>
      <button id="close-toc-btn" aria-label="关闭目录">✕</button>
    </div>
    <div id="toc-content-list" class="toc-list"></div>
    <div class="toc-footer">
      <button id="refresh-toc-btn">更新目录</button>
    </div>
  `;
  document.body.appendChild(panel);
  document.getElementById('close-toc-btn').onclick = toggleTOC;
  document.getElementById('refresh-toc-btn').onclick = refreshTOC;
};

const toggleTOC = () => {
  const panel = document.getElementById('chat-toc-panel');
  if (!panel) {
    initTOC();
    return toggleTOC();
  }
  isTOCSidebarOpen = !isTOCSidebarOpen;
  if (isTOCSidebarOpen) {
    panel.classList.add('open');
    refreshTOC();
  } else {
    panel.classList.remove('open');
  }
};

const refreshTOC = () => {
  const list = document.getElementById('toc-content-list');
  if (!list) return;
  
  const userMessages = document.querySelectorAll('div[data-message-author-role="user"]');
  if (userMessages.length === 0) {
    list.innerHTML = '<div class="toc-empty">未发现用户侧消息</div>';
    return;
  }

  list.innerHTML = Array.from(userMessages).map((msg, idx) => {
    const textEl = msg.querySelector('.whitespace-pre-wrap');
    const rawText = (textEl ? textEl.textContent : msg.textContent).trim().replace(/\n/g, ' ');
    const safeText = escapeHTML(rawText);

    return `
      <div class="toc-item" data-idx="${idx}" title="${safeText}">
        <div class="toc-item-inner">
          <span class="toc-num">${idx + 1}</span>
          <span class="toc-text">${safeText}</span>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.toc-item').forEach(item => {
    item.onclick = () => {
      const idx = parseInt(item.dataset.idx);
      const targetMsg = userMessages[idx];
      if (targetMsg) {
        targetMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const originalBg = targetMsg.style.background;
        targetMsg.style.transition = 'background 0.5s ease';
        targetMsg.style.background = 'rgba(55, 54, 91, 0.15)';
        setTimeout(() => targetMsg.style.background = originalBg, 2000);
      }
    };
  });
};

const injectTOCLauncher = () => {
  if (document.getElementById('chat-toc-launcher')) return;
  const btn = document.createElement('button');
  btn.id = 'chat-toc-launcher';
  btn.innerHTML = `目录`;
  btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleTOC(); };
  document.body.appendChild(btn);
};

/**
 * 自动化操作相关工具
 */
const hardClick = (el) => {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const opts = { 
    bubbles: true, cancelable: true, view: window, 
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 
  };
  el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse' }));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.focus();
  el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse' }));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
};

const waitForElement = (selector, timeout = 3000, textMatch = null) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const check = () => {
      const els = document.querySelectorAll(selector);
      let found = null;
      if (textMatch) {
        found = Array.from(els).find(el => el.innerText.includes(textMatch));
      } else {
        found = els[0];
      }
      if (found && found.offsetParent !== null) resolve(found);
      else if (Date.now() - startTime > timeout) resolve(null);
      else setTimeout(check, 100);
    };
    check();
  });
};

const waitForDisappear = (selector, timeout = 4000) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const check = () => {
      const el = document.querySelector(selector);
      if (!el || el.offsetParent === null) resolve(true);
      else if (Date.now() - startTime > timeout) resolve(false);
      else setTimeout(check, 200);
    };
    check();
  });
};

const getPlatform = () => {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
  return null;
};

const isUserLoggedIn = (platform) => {
  const config = PLATFORM_CONFIG[platform];
  if (!config || !config.loginIndicator) return true; // 默认返回真以防误判
  return !!document.querySelector(config.loginIndicator);
};

/**
 * 扫描历史
 */
const scanHistory = () => {
  const platform = getPlatform();
  if (!platform || !PLATFORM_CONFIG[platform]) return [];
  const config = PLATFORM_CONFIG[platform];
  
  const links = Array.from(document.querySelectorAll(config.linkSelector));
  const results = [];
  const seenIds = new Set();

  links.forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) return;
    const path = href.split('?')[0];
    if (!config.urlPattern.test(path)) return;
    if (href.includes('/new') || href === '/') return;
    const rawId = path.split('/').pop();
    if (seenIds.has(rawId)) return;
    seenIds.add(rawId);
    const titleEl = link.querySelector('.truncate, span[dir="auto"]');
    const title = titleEl ? titleEl.innerText : "Untitled Chat";
    results.push({ id: `id-${rawId}`, title, url: href });
  });
  return results;
};

/**
 * 自动化单次操作
 */
const deleteOne = async (item, config) => {
  const link = document.querySelector(`${config.linkSelector}[href="${item.url}"]`);
  if (!link) return false;
  const menuBtn = link.querySelector(config.menuBtnSelector);
  if (!menuBtn) return false;
  link.scrollIntoView({ block: 'center' });
  await new Promise(r => setTimeout(r, 400));
  hardClick(menuBtn);
  const deleteBtn = await waitForElement(config.deleteBtnSelector);
  if (!deleteBtn) return false;
  hardClick(deleteBtn);
  const confirmBtn = await waitForElement(config.confirmBtnSelector);
  if (!confirmBtn) return false;
  hardClick(confirmBtn);
  const isGone = await waitForDisappear(config.confirmBtnSelector);
  if (!isGone) return false;
  await new Promise(r => setTimeout(r, 1200));
  return true;
};

const moveOne = async (item, projectName, config) => {
  const link = document.querySelector(`${config.linkSelector}[href="${item.url}"]`);
  if (!link) return false;
  const menuBtn = link.querySelector(config.menuBtnSelector);
  if (!menuBtn) return false;
  link.scrollIntoView({ block: 'center' });
  await new Promise(r => setTimeout(r, 400));
  hardClick(menuBtn);
  const moveMenuItem = await waitForElement(config.projectItemSelector, 2000, config.moveLabel);
  if (!moveMenuItem) return false;
  hardClick(moveMenuItem);
  const targetProject = await waitForElement('[role="menu"] [role="menuitem"]', 2000, projectName);
  if (!targetProject) return false;
  hardClick(targetProject);
  await new Promise(r => setTimeout(r, 1500));
  return true;
};

/**
 * 渲染仪表盘逻辑
 */
const renderDashboard = () => {
  const container = document.getElementById('dashboard-items-grid');
  if (!container) return;
  
  const filteredItems = scannedItems.filter(item => 
    item.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (scannedItems.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>未发现对话</h3><p>请确保侧边栏已展开且包含历史记录</p></div>`;
  } else if (filteredItems.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>未找到匹配结果</h3></div>`;
  } else {
    container.innerHTML = filteredItems.map(item => `
      <div class="chat-card ${selectedIds.has(item.id) ? 'selected' : ''}" data-id="${item.id}">
        <div class="card-title">${item.title}</div>
        <div class="card-checkbox"></div>
      </div>
    `).join('');
  }
  
  container.querySelectorAll('.chat-card').forEach(card => {
    card.onclick = (e) => {
      e.preventDefault();
      const id = card.dataset.id;
      const currentIds = filteredItems.map(it => it.id);
      
      if (e.shiftKey && pivotId) {
        const startIndex = currentIds.indexOf(pivotId);
        const endIndex = currentIds.indexOf(id);
        if (startIndex !== -1 && endIndex !== -1) {
          const [min, max] = [Math.min(startIndex, endIndex), Math.max(startIndex, endIndex)];
          const rangeIds = currentIds.slice(min, max + 1);
          const shouldSelect = baseSelection.has(pivotId);
          const newSelection = new Set(baseSelection);
          rangeIds.forEach(rid => { if (shouldSelect) newSelection.add(rid); else newSelection.delete(rid); });
          selectedIds = newSelection;
        }
      } else {
        if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
        pivotId = id;
        baseSelection = new Set(selectedIds);
      }
      renderDashboard(); 
      updateFooter();
    };
  });
};

const updateFooter = () => {
  const lbl = document.getElementById('selected-count-label');
  const delBtn = document.getElementById('dash-delete-btn');
  const moveBtn = document.getElementById('dash-move-trigger');
  if (lbl) lbl.innerText = `${selectedIds.size} 项已选`;
  if (delBtn) delBtn.disabled = selectedIds.size === 0 || isProcessing;
  if (moveBtn) moveBtn.disabled = selectedIds.size === 0 || isProcessing;
};

const toggleDashboard = () => {
  const platform = getPlatform();
  if (!platform) return;
  let overlay = document.getElementById('history-manager-overlay');
  if (!overlay) {
    initOverlay();
    overlay = document.getElementById('history-manager-overlay');
  }
  isDashboardOpen = !isDashboardOpen;
  if (isDashboardOpen) {
    overlay.style.setProperty('display', 'flex', 'important');
    scannedItems = scanHistory();
    selectedIds.clear();
    renderDashboard();
    updateFooter();
  } else {
    overlay.style.display = 'none';
  }
};

const initOverlay = () => {
  if (document.getElementById('history-manager-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'history-manager-overlay';
  overlay.innerHTML = `
    <div class="dashboard-window">
      <div class="dashboard-header">
        <div class="header-info">
          <h2>多选管理对话</h2>
          <p>支持 Shift 连选（含反选）</p>
        </div>
        <button id="close-dash-btn">✕</button>
      </div>
      <div class="dashboard-search-container">
        <div class="search-input-wrapper">
          <input type="text" id="dash-search-input" placeholder="模糊搜索历史记录..." />
        </div>
      </div>
      <div id="dashboard-items-grid" class="dashboard-body"></div>
      <div class="dashboard-footer">
        <span id="selected-count-label">0 项已选</span>
        <div class="footer-actions">
          <button id="dash-refresh-btn" class="btn-secondary">刷新</button>
          <button id="dash-delete-btn" class="btn-primary danger" disabled>删除</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('close-dash-btn').onclick = toggleDashboard;
  document.getElementById('dash-refresh-btn').onclick = () => { scannedItems = scanHistory(); renderDashboard(); };
  document.getElementById('dash-search-input').oninput = (e) => { searchQuery = e.target.value; renderDashboard(); };
};

/**
 * 注入发射按钮
 */
const injectLauncher = () => {
  const platform = getPlatform();
  if (!platform) return;
  
  // 检查登录状态：只有已登录才注入
  if (!isUserLoggedIn(platform)) {
    const existing = document.getElementById('history-manager-launcher');
    if (existing) existing.remove();
    const existingToc = document.getElementById('chat-toc-launcher');
    if (existingToc) existingToc.remove();
    return;
  }

  if (document.getElementById('history-manager-launcher')) return;
  
  const sidebar = document.querySelector('nav') || document.querySelector('[role="navigation"]');
  if (!sidebar) return;

  const btn = document.createElement('button');
  btn.id = 'history-manager-launcher';
  btn.innerHTML = `<span>☑</span> 多选`;
  btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleDashboard(); };
  sidebar.appendChild(btn);
  
  injectTOCLauncher();
};

const observer = new MutationObserver(() => injectLauncher());
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(() => { injectLauncher(); initOverlay(); initTOC(); }, 2000);
