
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

// Platform Configuration
const PLATFORM_CONFIG = {
  chatgpt: {
    name: 'ChatGPT',
    enabled: true,
    linkSelector: 'a[data-sidebar-item="true"]',
    urlPattern: /^\/c\/[a-z0-9-]{10,}$/i, 
    menuBtnSelector: 'button[data-testid*="-options"]',
    deleteBtnSelector: '[data-testid="delete-chat-menu-item"]',
    confirmBtnSelector: '[data-testid="delete-conversation-confirm-button"]',
    moveLabel: 'Move to',
    projectItemSelector: '[role="menuitem"]',
    loginIndicators: ['[data-testid="user-menu-button"]', '#prompt-textarea', 'nav']
  }
};

/**
 * Login status detection
 */
const isLoggedIn = () => {
  const platform = getPlatform();
  if (!platform || !PLATFORM_CONFIG[platform]) return false;
  const config = PLATFORM_CONFIG[platform];
  return config.loginIndicators.some(selector => !!document.querySelector(selector));
};

/**
 * Cleanup injected UI
 */
const cleanupUI = () => {
  document.getElementById('history-manager-launcher')?.remove();
  document.getElementById('chat-toc-launcher')?.remove();
  document.getElementById('chat-toc-panel')?.remove();
  document.getElementById('history-manager-overlay')?.remove();
  isDashboardOpen = false;
  isTOCSidebarOpen = false;
};

/**
 * HTML Escape Tool
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
 * TOC Panel Initialization
 */
const initTOC = () => {
  if (document.getElementById('chat-toc-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'chat-toc-panel';
  panel.innerHTML = `
    <div class="toc-header">
      <span class="toc-header-title">Conversation TOC</span>
      <button id="close-toc-btn" aria-label="Close">✕</button>
    </div>
    <div id="toc-content-list" class="toc-list"></div>
    <div class="toc-footer">
      <button id="refresh-toc-btn">Refresh TOC</button>
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
    list.innerHTML = '<div class="toc-empty">No user messages found</div>';
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
  btn.innerHTML = `TOC`;
  btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleTOC(); };
  document.body.appendChild(btn);
};

/**
 * Automation Tools
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
  return null;
};

/**
 * History Scanner
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
 * Fetch Project List
 */
const fetchProjects = async () => {
  if (selectedIds.size === 0) {
    alert('Please select at least one chat to fetch projects.');
    return;
  }
  const platform = getPlatform();
  const config = PLATFORM_CONFIG[platform];
  const firstId = Array.from(selectedIds)[0];
  const item = scannedItems.find(it => it.id === firstId);
  if (!item) return;

  const link = document.querySelector(`${config.linkSelector}[href="${item.url}"]`);
  if (!link) return;
  const menuBtn = link.querySelector(config.menuBtnSelector);
  if (!menuBtn) return;

  hardClick(menuBtn);
  const moveMenuItem = await waitForElement(config.projectItemSelector, 3000, config.moveLabel);
  if (!moveMenuItem) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return;
  }
  hardClick(moveMenuItem);
  await new Promise(r => setTimeout(r, 500));

  const subMenuItems = document.querySelectorAll('[role="menu"] a[role="menuitem"], [role="menu"] [role="menuitem"]');
  const projects = [];
  subMenuItems.forEach(el => {
    const title = el.querySelector('.truncate')?.innerText;
    if (title && title !== 'New Project') projects.push(title);
  });
  availableProjects = [...new Set(projects)];
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  renderProjectDropdown();
};

/**
 * Batch Operations
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
  return await waitForDisappear(config.confirmBtnSelector);
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

const updateProgress = (current, total) => {
  const el = document.getElementById('processing-progress-text');
  if (el) el.innerText = `Processing ${current} / ${total}...`;
};

const runBatchDelete = async () => {
  const ids = Array.from(selectedIds);
  if (!confirm(`Are you sure you want to delete ${ids.length} chats?`)) return;
  isProcessing = true;
  const platform = getPlatform();
  const config = PLATFORM_CONFIG[platform];
  const overlay = document.getElementById('history-manager-overlay');
  overlay.classList.add('processing');

  for (let i = 0; i < ids.length; i++) {
    updateProgress(i + 1, ids.length);
    const item = scannedItems.find(it => it.id === ids[i]);
    if (item && await deleteOne(item, config)) {
      selectedIds.delete(ids[i]);
      scannedItems = scannedItems.filter(it => it.id !== ids[i]);
      renderDashboard();
    }
  }
  isProcessing = false;
  overlay.classList.remove('processing');
  alert('Batch delete finished.');
};

const runBatchMove = async (projectName) => {
  const ids = Array.from(selectedIds);
  if (!confirm(`Move ${ids.length} chats to "${projectName}"?`)) return;
  isProcessing = true;
  const platform = getPlatform();
  const config = PLATFORM_CONFIG[platform];
  const overlay = document.getElementById('history-manager-overlay');
  overlay.classList.add('processing');

  for (let i = 0; i < ids.length; i++) {
    updateProgress(i + 1, ids.length);
    const item = scannedItems.find(it => it.id === ids[i]);
    if (item && await moveOne(item, projectName, config)) {
      selectedIds.delete(ids[i]);
      renderDashboard();
    }
  }
  isProcessing = false;
  overlay.classList.remove('processing');
  alert('Batch migration finished.');
};

/**
 * Dashboard Rendering
 */
const renderDashboard = () => {
  const container = document.getElementById('dashboard-items-grid');
  if (!container) return;
  const filteredItems = scannedItems.filter(item => item.title.toLowerCase().includes(searchQuery.toLowerCase()));
  if (scannedItems.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>No conversations found</h3><p>Make sure the sidebar is expanded.</p></div>`;
  } else if (filteredItems.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>No matches found</h3></div>`;
  } else {
    container.innerHTML = filteredItems.map(item => `
      <div class="chat-card ${selectedIds.has(item.id) ? 'selected' : ''}" data-id="${item.id}">
        <div class="card-title">${escapeHTML(item.title)}</div>
        <div class="card-checkbox"></div>
      </div>
    `).join('');
  }
  
  container.querySelectorAll('.chat-card').forEach(card => {
    card.onclick = (e) => {
      if (isProcessing) return;
      const id = card.dataset.id;
      if (e.shiftKey && pivotId) {
        const currentIds = filteredItems.map(it => it.id);
        const [min, max] = [Math.min(currentIds.indexOf(pivotId), currentIds.indexOf(id)), Math.max(currentIds.indexOf(pivotId), currentIds.indexOf(id))];
        const range = currentIds.slice(min, max + 1);
        const shouldSel = baseSelection.has(pivotId);
        range.forEach(rid => shouldSel ? selectedIds.add(rid) : selectedIds.delete(rid));
      } else {
        selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id);
        pivotId = id;
        baseSelection = new Set(selectedIds);
      }
      renderDashboard(); updateFooter();
    };
  });
};

const renderProjectDropdown = () => {
  const list = document.getElementById('available-projects-list');
  if (!list) return;
  list.innerHTML = availableProjects.length ? availableProjects.map(p => `<div class="project-option-item" data-name="${p}">${p}</div>`).join('') : `<div class="project-option-item disabled">No projects (Click to refresh)</div>`;
  list.querySelectorAll('.project-option-item:not(.disabled)').forEach(item => {
    item.onclick = () => { runBatchMove(item.dataset.name); document.getElementById('project-dropdown').classList.remove('open'); };
  });
};

const updateFooter = () => {
  const lbl = document.getElementById('selected-count-label');
  const delBtn = document.getElementById('dash-delete-btn');
  const moveBtn = document.getElementById('dash-move-trigger');
  if (lbl) lbl.innerText = `${selectedIds.size} items selected`;
  if (delBtn) delBtn.disabled = selectedIds.size === 0 || isProcessing;
  if (moveBtn) moveBtn.disabled = selectedIds.size === 0 || isProcessing;
};

const toggleDashboard = () => {
  if (!isLoggedIn()) return;
  let overlay = document.getElementById('history-manager-overlay');
  if (!overlay) { initOverlay(); overlay = document.getElementById('history-manager-overlay'); }
  isDashboardOpen = !isDashboardOpen;
  if (isDashboardOpen) {
    overlay.style.setProperty('display', 'flex', 'important');
    scannedItems = scanHistory();
    selectedIds.clear(); renderDashboard(); updateFooter();
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
          <h2>Batch Manage Chats</h2>
          <p>Support Shift-selection (Range/Invert)</p>
        </div>
        <button id="close-dash-btn">✕</button>
      </div>
      <div class="dashboard-search-container">
        <div class="search-input-wrapper">
          <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" id="dash-search-input" placeholder="Search history..." />
        </div>
      </div>
      <div id="dashboard-items-grid" class="dashboard-body"></div>
      <div class="dashboard-footer">
        <span id="selected-count-label">0 items selected</span>
        <div class="footer-actions">
          <button id="dash-refresh-btn" class="btn-secondary">Refresh</button>
          <div id="project-dropdown" class="dropdown-wrapper">
             <button id="dash-move-trigger" class="btn-secondary" disabled>Move to Project ▾</button>
             <div id="available-projects-list" class="dropdown-content"></div>
          </div>
          <button id="dash-delete-btn" class="btn-primary danger" disabled>Run Delete</button>
        </div>
      </div>
      <div id="processing-mask"><div class="processing-card"><div class="spinner"></div><span>Executing automated operations...</span><span id="processing-progress-text"></span></div></div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('close-dash-btn').onclick = toggleDashboard;
  document.getElementById('dash-refresh-btn').onclick = () => { scannedItems = scanHistory(); renderDashboard(); };
  document.getElementById('dash-search-input').oninput = (e) => { searchQuery = e.target.value; renderDashboard(); };
  const moveTrigger = document.getElementById('dash-move-trigger');
  const dropdown = document.getElementById('project-dropdown');
  moveTrigger.onclick = (e) => { e.stopPropagation(); dropdown.classList.toggle('open'); if (!availableProjects.length) fetchProjects(); };
  window.addEventListener('click', () => dropdown.classList.remove('open'));
  document.getElementById('dash-delete-btn').onclick = runBatchDelete;
};

/**
 * Injection
 */
const injectLauncher = () => {
  const platform = getPlatform();
  if (!platform) return;
  if (!isLoggedIn()) { cleanupUI(); return; }
  if (document.getElementById('history-manager-launcher')) return;
  const sidebar = document.querySelector('nav') || document.querySelector('[role="navigation"]');
  if (!sidebar) return;

  const btn = document.createElement('button');
  btn.id = 'history-manager-launcher';
  btn.innerHTML = `<span>☑</span> Multi-Select`;
  btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleDashboard(); };
  sidebar.appendChild(btn);
  injectTOCLauncher();
  initTOC();
};

const observer = new MutationObserver(() => injectLauncher());
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(injectLauncher, 2000);

const style = document.createElement('style');
style.textContent = `.processing #processing-mask { display: flex !important; }`;
document.head.appendChild(style);
