
/**
 * Global State
 */
let isDashboardOpen = false;
let scannedItems = []; 
let selectedIds = new Set();
let pivotId = null; 
let pivotStatus = true; 
let availableProjects = []; 
let isProcessing = false;
let searchQuery = ''; 
let currentLang = 'zh';

const I18N = {
  zh: {
    launcher: '多选管理',
    searchPlaceholder: '搜索对话历史...',
    selected: '项已选',
    refresh: '刷新',
    moveTo: '移至项目',
    batchDelete: '批量删除',
    processing: '正在处理...',
    deleting: '正在删除',
    moving: '正在移动',
    confirmDelete: '确定删除这 {n} 项对话吗？',
    confirmMove: '确定将选中的 {n} 项移至“{p}”吗？',
    noChats: '未发现对话',
    noProjects: '未发现项目',
    close: '关闭'
  },
  en: {
    launcher: 'History Manager',
    searchPlaceholder: 'Search history...',
    selected: 'selected',
    refresh: 'Refresh',
    moveTo: 'Move to Project',
    batchDelete: 'Delete Selected',
    processing: 'Processing...',
    deleting: 'Deleting',
    moving: 'Moving',
    confirmDelete: 'Delete these {n} chats?',
    confirmMove: 'Move {n} chats to "{p}"?',
    noChats: 'No chats found',
    noProjects: 'No projects found',
    close: 'Close'
  }
};

const PLATFORM_CONFIG = {
  chatgpt: {
    name: 'ChatGPT',
    linkSelector: 'a[data-sidebar-item="true"]',
    urlPattern: /^\/c\/[a-z0-9-]{10,}$/i, 
    menuBtnSelector: 'button[data-testid*="-options"]',
    deleteBtnSelector: '[data-testid="delete-chat-menu-item"]',
    confirmBtnSelector: '[data-testid="delete-conversation-confirm-button"]',
    moveLabel: '移至项目',
    projectItemSelector: '[role="menuitem"]'
  }
};

/**
 * Helpers
 */
const getT = () => I18N[currentLang] || I18N.zh;

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

const getPlatform = () => {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
  return null;
};

const scanHistory = () => {
  const platform = getPlatform();
  if (!platform) return [];
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
 * Project Logic
 */
const fetchProjects = async () => {
  if (getPlatform() !== 'chatgpt') return;
  const testItem = scannedItems[0];
  if (!testItem) return;
  const config = PLATFORM_CONFIG.chatgpt;
  const link = document.querySelector(`${config.linkSelector}[href="${testItem.url}"]`);
  if (!link) return;
  const menuBtn = link.querySelector(config.menuBtnSelector);
  if (!menuBtn) return;

  hardClick(menuBtn);
  const moveBtn = await waitForElement(config.projectItemSelector, 2000, config.moveLabel);
  if (!moveBtn) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return;
  }
  hardClick(moveBtn);
  await new Promise(r => setTimeout(r, 600));
  
  const items = document.querySelectorAll('[role="menu"] [role="menuitem"]');
  const projects = [];
  items.forEach(it => {
    const text = it.innerText.trim();
    if (text && !['新项目', '移至项目', 'New Project', 'Move to Project'].includes(text)) projects.push(text);
  });
  availableProjects = [...new Set(projects)];
  renderProjectList();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
};

const renderProjectList = () => {
  const list = document.getElementById('available-projects-list');
  if (!list) return;
  const t = getT();
  if (availableProjects.length === 0) {
    list.innerHTML = `<div class="project-option disabled">${t.noProjects}</div>`;
  } else {
    list.innerHTML = availableProjects.map(p => `<div class="project-option" data-name="${p}">${p}</div>`).join('');
    list.querySelectorAll('.project-option').forEach(opt => {
      opt.onclick = (e) => { e.stopPropagation(); runBatchMove(opt.dataset.name); };
    });
  }
};

/**
 * UI Rendering
 */
const renderDashboard = () => {
  const container = document.getElementById('dashboard-items-grid');
  if (!container) return;
  const t = getT();
  const filteredItems = scannedItems.filter(item => 
    item.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  container.innerHTML = filteredItems.length === 0 
    ? `<div class="empty-state"><h3>${t.noChats}</h3></div>`
    : filteredItems.map(item => `
      <div class="chat-card ${selectedIds.has(item.id) ? 'selected' : ''}" data-id="${item.id}">
        <div class="card-title">${item.title}</div>
        <div class="card-checkbox"></div>
      </div>
    `).join('');
  
  container.querySelectorAll('.chat-card').forEach(card => {
    card.onclick = (e) => {
      if (isProcessing) return;
      const id = card.dataset.id;
      const isShift = e.shiftKey;
      const currentVisibleIds = filteredItems.map(it => it.id);
      if (isShift && pivotId) {
        const startIdx = currentVisibleIds.indexOf(pivotId);
        const endIdx = currentVisibleIds.indexOf(id);
        if (startIdx !== -1 && endIdx !== -1) {
          const [min, max] = [Math.min(startIdx, endIdx), Math.max(startIdx, endIdx)];
          const range = currentVisibleIds.slice(min, max + 1);
          range.forEach(rid => pivotStatus ? selectedIds.add(rid) : selectedIds.delete(rid));
        }
      } else {
        if (selectedIds.has(id)) { selectedIds.delete(id); pivotStatus = false; }
        else { selectedIds.add(id); pivotStatus = true; }
        pivotId = id;
      }
      renderDashboard(); 
      updateFooter();
    };
  });
};

const updateFooter = () => {
  const t = getT();
  const lbl = document.getElementById('selected-count-label');
  const delBtn = document.getElementById('dash-delete-btn');
  const moveBtn = document.getElementById('dash-move-trigger');
  if (lbl) lbl.innerText = `${selectedIds.size} ${t.selected}`;
  if (delBtn) delBtn.disabled = selectedIds.size === 0 || isProcessing;
  if (moveBtn) moveBtn.disabled = selectedIds.size === 0 || isProcessing;
};

const syncLangUI = () => {
  const t = getT();
  const launcher = document.getElementById('history-manager-launcher');
  if (launcher) launcher.innerHTML = `<span>☑</span> ${t.launcher}`;
  const input = document.getElementById('dash-search-input');
  if (input) input.placeholder = t.searchPlaceholder;
  const refresh = document.getElementById('dash-refresh-btn');
  if (refresh) refresh.innerText = t.refresh;
  const move = document.getElementById('dash-move-trigger');
  if (move) move.innerText = `${t.moveTo} ▾`;
  const del = document.getElementById('dash-delete-btn');
  if (del) del.innerText = t.batchDelete;
  const close = document.getElementById('close-dash-btn');
  if (close) close.title = t.close;
  renderDashboard();
  updateFooter();
};

const toggleDashboard = () => {
  let overlay = document.getElementById('history-manager-overlay');
  if (!overlay) { initOverlay(); overlay = document.getElementById('history-manager-overlay'); }
  isDashboardOpen = !isDashboardOpen;
  if (isDashboardOpen) {
    overlay.style.setProperty('display', 'flex', 'important');
    scannedItems = scanHistory();
    selectedIds.clear();
    pivotId = null;
    searchQuery = '';
    const input = document.getElementById('dash-search-input');
    if (input) input.value = '';
    syncLangUI();
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
        <div class="search-box">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" id="dash-search-input" />
        </div>
        <div class="header-right">
           <button id="close-dash-btn" class="icon-btn">✕</button>
        </div>
      </div>
      <div id="dashboard-items-grid" class="dashboard-body"></div>
      <div class="dashboard-footer">
        <div class="footer-left"><span id="selected-count-label"></span></div>
        <div class="footer-actions">
          <button id="dash-refresh-btn" class="btn-secondary"></button>
          <div id="project-dropdown" class="dropdown-wrapper">
             <button id="dash-move-trigger" class="btn-secondary" disabled></button>
             <div id="available-projects-list" class="dropdown-content"></div>
          </div>
          <button id="dash-delete-btn" class="btn-primary danger" disabled></button>
        </div>
      </div>
      <div id="processing-mask">
         <div class="processing-card"><div class="spinner"></div><span id="processing-progress-text"></span></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('close-dash-btn').onclick = toggleDashboard;
  document.getElementById('dash-refresh-btn').onclick = () => { scannedItems = scanHistory(); renderDashboard(); };
  document.getElementById('dash-search-input').oninput = (e) => { searchQuery = e.target.value; renderDashboard(); };
  document.getElementById('dash-delete-btn').onclick = runBatchDelete;
  const moveTrigger = document.getElementById('dash-move-trigger');
  const dropdown = document.getElementById('project-dropdown');
  moveTrigger.onclick = (e) => { e.stopPropagation(); dropdown.classList.toggle('open'); if (availableProjects.length === 0) fetchProjects(); };
  window.addEventListener('click', () => dropdown.classList.remove('open'));
};

/**
 * Actions
 */
const runBatchDelete = async () => {
  const t = getT();
  const ids = Array.from(selectedIds);
  if (!confirm(t.confirmDelete.replace('{n}', ids.length))) return;
  isProcessing = true;
  document.getElementById('history-manager-overlay').classList.add('processing');
  const config = PLATFORM_CONFIG.chatgpt;
  for (let i = 0; i < ids.length; i++) {
    document.getElementById('processing-progress-text').innerText = `${t.deleting}: ${i + 1} / ${ids.length}`;
    const item = scannedItems.find(it => it.id === ids[i]);
    if (item) await deleteOne(item, config);
    selectedIds.delete(ids[i]);
    scannedItems = scannedItems.filter(it => it.id !== ids[i]);
    renderDashboard();
    updateFooter();
  }
  isProcessing = false;
  document.getElementById('history-manager-overlay').classList.remove('processing');
};

const deleteOne = async (item, config) => {
  const link = document.querySelector(`${config.linkSelector}[href="${item.url}"]`);
  if (!link) return;
  link.scrollIntoView({ block: 'center' });
  await new Promise(r => setTimeout(r, 400));
  const menuBtn = link.querySelector(config.menuBtnSelector);
  if (!menuBtn) return;
  hardClick(menuBtn);
  const del = await waitForElement(config.deleteBtnSelector);
  if (del) {
    hardClick(del);
    const confirm = await waitForElement(config.confirmBtnSelector);
    if (confirm) hardClick(confirm);
    await new Promise(r => setTimeout(r, 1200));
  }
};

const runBatchMove = async (projectName) => {
  const t = getT();
  const ids = Array.from(selectedIds);
  if (!confirm(t.confirmMove.replace('{n}', ids.length).replace('{p}', projectName))) return;
  isProcessing = true;
  document.getElementById('history-manager-overlay').classList.add('processing');
  document.getElementById('project-dropdown').classList.remove('open');
  const config = PLATFORM_CONFIG.chatgpt;
  for (let i = 0; i < ids.length; i++) {
    document.getElementById('processing-progress-text').innerText = `${t.moving}: ${i + 1} / ${ids.length}`;
    const item = scannedItems.find(it => it.id === ids[i]);
    if (item) await moveOne(item, projectName, config);
    selectedIds.delete(ids[i]);
    renderDashboard();
    updateFooter();
  }
  isProcessing = false;
  document.getElementById('history-manager-overlay').classList.remove('processing');
};

const moveOne = async (item, projectName, config) => {
  const link = document.querySelector(`${config.linkSelector}[href="${item.url}"]`);
  if (!link) return;
  link.scrollIntoView({ block: 'center' });
  await new Promise(r => setTimeout(r, 400));
  const menuBtn = link.querySelector(config.menuBtnSelector);
  if (!menuBtn) return;
  hardClick(menuBtn);
  const moveBtn = await waitForElement(config.projectItemSelector, 2000, config.moveLabel);
  if (moveBtn) {
    hardClick(moveBtn);
    const target = await waitForElement('[role="menu"] [role="menuitem"]', 2000, projectName);
    if (target) hardClick(target);
    await new Promise(r => setTimeout(r, 1500));
  }
};

const injectLauncher = () => {
  if (document.getElementById('history-manager-launcher')) return;
  const sidebar = document.querySelector('nav') || document.querySelector('[role="navigation"]');
  if (!sidebar) return;
  const btn = document.createElement('button');
  btn.id = 'history-manager-launcher';
  btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleDashboard(); };
  sidebar.prepend(btn);
  syncLangUI();
};

/**
 * Storage & Initialization
 */
if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.local.get(['lang'], (res) => {
    if (res.lang) currentLang = res.lang;
    syncLangUI();
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.lang) {
      currentLang = changes.lang.newValue;
      syncLangUI();
    }
  });
}

const observer = new MutationObserver(() => injectLauncher());
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(injectLauncher, 1000);
