
/**
 * Global State
 */
let isDashboardOpen = false;
let scannedItems = []; 
let selectedIds = new Set();
let pivotId = null; // 锚点：最后一次手动点击的项
let pivotState = true; // 锚点最后的操作状态（true为勾选，false为取消）
let availableProjects = []; 
let isProcessing = false;
let searchQuery = ''; 
let isSearchExpanded = false;

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
    projectItemSelector: '[role="menuitem"]'
  },
  gemini: {
    name: 'Gemini',
    enabled: false, 
    linkSelector: 'a[href*="/app/"]',
    urlPattern: /^\/app\/[a-z0-9]{10,}$/i,
    menuBtnSelector: 'button[aria-haspopup="true"]',
    deleteBtnSelector: '[role="menuitem"], .delete-button',
    confirmBtnSelector: 'button.delete-confirm, .confirm-button'
  }
};

/**
 * Helpers
 */
const hardClick = (el) => {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
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
      let found = Array.from(els).find(el => textMatch ? el.innerText.includes(textMatch) : true);
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
  if (host.includes('gemini.google.com')) return 'gemini';
  return null;
};

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
    results.push({ id: `id-${rawId}`, title: titleEl ? titleEl.innerText : "Untitled Chat", url: href });
  });
  return results;
};

/**
 * Batch Actions
 */
const updateProgress = (current, total) => {
  const el = document.getElementById('processing-progress-text');
  if (el) el.innerText = `处理中: ${current} / ${total}`;
};

const runBatchDelete = async () => {
  const ids = Array.from(selectedIds);
  if (!confirm(`确定删除选中的 ${ids.length} 项对话吗？`)) return;

  isProcessing = true;
  const platform = getPlatform();
  const config = PLATFORM_CONFIG[platform];
  const overlay = document.getElementById('history-manager-overlay');
  overlay.classList.add('processing');

  let currentCount = 0;
  for (const id of ids) {
    currentCount++;
    updateProgress(currentCount, ids.length);
    const item = scannedItems.find(it => it.id === id);
    if (item) {
      const success = await deleteOne(item, config);
      if (success) {
        selectedIds.delete(id);
        scannedItems = scannedItems.filter(it => it.id !== id);
        renderDashboard();
      } else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }
  isProcessing = false;
  overlay.classList.remove('processing');
  alert('操作结束');
};

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

/**
 * Dashboard Rendering
 */
const renderDashboard = () => {
  const container = document.getElementById('dashboard-items-grid');
  if (!container) return;
  
  const filteredItems = scannedItems.filter(item => 
    item.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (scannedItems.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>未发现对话</h3></div>`;
  } else if (filteredItems.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>无匹配项</h3></div>`;
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
      if (isProcessing) return;
      const id = card.dataset.id;
      const isShift = e.shiftKey;
      const currentVisibleIds = filteredItems.map(it => it.id);

      if (isShift && pivotId) {
        // Gmail 风格：同步范围内所有项到锚点的状态
        const startIndex = currentVisibleIds.indexOf(pivotId);
        const endIndex = currentVisibleIds.indexOf(id);
        if (startIndex !== -1 && endIndex !== -1) {
          const [min, max] = [Math.min(startIndex, endIndex), Math.max(startIndex, endIndex)];
          const rangeIds = currentVisibleIds.slice(min, max + 1);
          rangeIds.forEach(rid => {
            if (pivotState) selectedIds.add(rid);
            else selectedIds.delete(rid);
          });
        }
      } else {
        // 普通点击：切换状态并设为新锚点
        if (selectedIds.has(id)) {
          selectedIds.delete(id);
          pivotState = false;
        } else {
          selectedIds.add(id);
          pivotState = true;
        }
        pivotId = id;
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

const toggleSearch = () => {
  isSearchExpanded = !isSearchExpanded;
  const container = document.querySelector('.search-bar-container');
  const input = document.getElementById('dash-search-input');
  if (isSearchExpanded) {
    container.classList.add('expanded');
    input.focus();
  } else {
    container.classList.remove('expanded');
    searchQuery = '';
    input.value = '';
    renderDashboard();
  }
};

const toggleDashboard = () => {
  const platform = getPlatform();
  if (!platform) return;
  let overlay = document.getElementById('history-manager-overlay');
  if (!overlay) { initOverlay(); overlay = document.getElementById('history-manager-overlay'); }
  
  isDashboardOpen = !isDashboardOpen;
  if (isDashboardOpen) {
    overlay.style.display = 'flex';
    scannedItems = scanHistory();
    selectedIds.clear();
    pivotId = null;
    searchQuery = '';
    isSearchExpanded = false;
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
          <h2>对话多选管理</h2>
        </div>
        <div class="header-actions">
          <div class="search-bar-container">
            <button id="search-toggle-btn" class="icon-btn" title="搜索">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </button>
            <input type="text" id="dash-search-input" placeholder="输入关键词..." />
          </div>
          <button id="close-dash-btn" class="icon-btn">✕</button>
        </div>
      </div>
      <div id="dashboard-items-grid" class="dashboard-body"></div>
      <div class="dashboard-footer">
        <span id="selected-count-label">0 项已选</span>
        <div class="footer-actions">
          <button id="dash-refresh-btn" class="btn-secondary">刷新列表</button>
          <div id="project-dropdown" class="dropdown-wrapper">
             <button id="dash-move-trigger" class="btn-secondary" disabled>移至项目 ▾</button>
             <div id="available-projects-list" class="dropdown-content"></div>
          </div>
          <button id="dash-delete-btn" class="btn-primary danger" disabled>批量删除</button>
        </div>
      </div>
      <div id="processing-mask">
         <div class="processing-card">
            <div class="spinner"></div>
            <span id="processing-progress-text">正在自动处理...</span>
         </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('close-dash-btn').onclick = () => toggleDashboard();
  document.getElementById('search-toggle-btn').onclick = () => toggleSearch();
  document.getElementById('dash-refresh-btn').onclick = () => { scannedItems = scanHistory(); renderDashboard(); };
  document.getElementById('dash-search-input').oninput = (e) => { searchQuery = e.target.value; renderDashboard(); };
  document.getElementById('dash-delete-btn').onclick = runBatchDelete;
  
  const moveTrigger = document.getElementById('dash-move-trigger');
  const dropdown = document.getElementById('project-dropdown');
  moveTrigger.onclick = (e) => { e.stopPropagation(); dropdown.classList.toggle('open'); };
  window.addEventListener('click', () => dropdown.classList.remove('open'));
};

const injectLauncher = () => {
  const platform = getPlatform();
  if (!platform || document.getElementById('history-manager-launcher')) return;
  const sidebar = document.querySelector('nav') || document.querySelector('[role="navigation"]');
  if (!sidebar) return;
  const btn = document.createElement('button');
  btn.id = 'history-manager-launcher';
  btn.innerHTML = `<span>☑</span> 多选`;
  btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleDashboard(); };
  sidebar.appendChild(btn);
};

const observer = new MutationObserver(() => injectLauncher());
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(injectLauncher, 1500);

const style = document.createElement('style');
style.textContent = `.processing #processing-mask { display: flex !important; }`;
document.head.appendChild(style);
