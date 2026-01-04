
/**
 * Global State
 */
let isDashboardOpen = false;
let scannedItems = []; 
let selectedIds = new Set();
let pivotId = null; // Gmail 风格锚点 ID
let pivotState = true; // 锚点的状态（true 为选中，false 为取消）
let availableProjects = []; 
let isProcessing = false;
let searchQuery = ''; 

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
 * Project Fetching
 */
const fetchProjects = async () => {
  const platform = getPlatform();
  if (!platform || platform !== 'chatgpt') return;
  
  const testItem = scannedItems[0];
  if (!testItem) return;

  const config = PLATFORM_CONFIG[platform];
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
    if (text && text !== '新项目' && text !== '移至项目') projects.push(text);
  });

  availableProjects = [...new Set(projects)];
  renderProjectList();
  
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  setTimeout(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 200);
};

const renderProjectList = () => {
  const list = document.getElementById('available-projects-list');
  if (!list) return;
  if (availableProjects.length === 0) {
    list.innerHTML = `<div class="project-option disabled">未发现项目</div>`;
  } else {
    list.innerHTML = availableProjects.map(p => `<div class="project-option" data-name="${p}">${p}</div>`).join('');
    list.querySelectorAll('.project-option').forEach(opt => {
      opt.onclick = (e) => {
        e.stopPropagation();
        runBatchMove(opt.dataset.name);
      };
    });
  }
};

/**
 * UI Logic
 */
const renderDashboard = () => {
  const container = document.getElementById('dashboard-items-grid');
  if (!container) return;
  
  const filteredItems = scannedItems.filter(item => 
    item.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  container.innerHTML = filteredItems.length === 0 
    ? `<div class="empty-state"><h3>无结果</h3></div>`
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
          range.forEach(rid => {
            if (pivotState) selectedIds.add(rid);
            else selectedIds.delete(rid);
          });
        }
      } else {
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

const toggleDashboard = () => {
  let overlay = document.getElementById('history-manager-overlay');
  if (!overlay) { initOverlay(); overlay = document.getElementById('history-manager-overlay'); }
  
  isDashboardOpen = !isDashboardOpen;
  if (isDashboardOpen) {
    overlay.style.display = 'flex';
    scannedItems = scanHistory();
    selectedIds.clear();
    pivotId = null;
    searchQuery = '';
    const searchInput = document.getElementById('dash-search-input');
    if (searchInput) searchInput.value = '';
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
        <div class="search-box">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" id="dash-search-input" placeholder="搜索对话..." />
        </div>
        <div class="header-right">
          <button id="close-dash-btn" class="icon-btn" title="关闭">✕</button>
        </div>
      </div>
      <div id="dashboard-items-grid" class="dashboard-body"></div>
      <div class="dashboard-footer">
        <div class="footer-left">
           <span id="selected-count-label">0 项已选</span>
        </div>
        <div class="footer-actions">
          <button id="dash-refresh-btn" class="btn-secondary">刷新</button>
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
            <span id="processing-progress-text">处理中...</span>
         </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  
  document.getElementById('close-dash-btn').onclick = (e) => { e.stopPropagation(); toggleDashboard(); };
  document.getElementById('dash-refresh-btn').onclick = () => { scannedItems = scanHistory(); renderDashboard(); };
  document.getElementById('dash-search-input').oninput = (e) => { searchQuery = e.target.value; renderDashboard(); };
  document.getElementById('dash-delete-btn').onclick = runBatchDelete;
  
  const moveTrigger = document.getElementById('dash-move-trigger');
  const dropdown = document.getElementById('project-dropdown');
  moveTrigger.onclick = (e) => { 
    e.stopPropagation(); 
    dropdown.classList.toggle('open'); 
    if (dropdown.classList.contains('open') && availableProjects.length === 0) fetchProjects();
  };
  
  window.addEventListener('click', () => {
    if (dropdown.classList.contains('open')) dropdown.classList.remove('open');
  });
};

/**
 * Automations
 */
const runBatchDelete = async () => {
  const ids = Array.from(selectedIds);
  if (!confirm(`确定删除这 ${ids.length} 项对话吗？`)) return;
  isProcessing = true;
  document.getElementById('history-manager-overlay').classList.add('processing');
  
  const config = PLATFORM_CONFIG[getPlatform()];
  for (let i = 0; i < ids.length; i++) {
    document.getElementById('processing-progress-text').innerText = `正在删除: ${i + 1} / ${ids.length}`;
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
  const ids = Array.from(selectedIds);
  if (!confirm(`确定将选中的 ${ids.length} 项移至“${projectName}”吗？`)) return;
  isProcessing = true;
  document.getElementById('history-manager-overlay').classList.add('processing');
  document.getElementById('project-dropdown').classList.remove('open');
  
  const config = PLATFORM_CONFIG[getPlatform()];
  for (let i = 0; i < ids.length; i++) {
    document.getElementById('processing-progress-text').innerText = `正在移动: ${i + 1} / ${ids.length}`;
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
  btn.innerHTML = `<span>☑</span> 多选管理`;
  btn.onclick = (e) => { e.preventDefault(); toggleDashboard(); };
  sidebar.appendChild(btn);
};

const observer = new MutationObserver(() => injectLauncher());
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(injectLauncher, 1000);

const style = document.createElement('style');
style.textContent = `.processing #processing-mask { display: flex !important; }`;
document.head.appendChild(style);
