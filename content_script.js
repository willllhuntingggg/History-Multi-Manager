
/**
 * Global State
 */
let isDashboardOpen = false;
let scannedItems = []; 
let selectedIds = new Set();
let availableProjects = []; // 存储扫描到的项目名称
let isProcessing = false;

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
 * 强力模拟点击
 */
const hardClick = (el) => {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const opts = { 
    bubbles: true, 
    cancelable: true, 
    view: window, 
    clientX: rect.left + rect.width / 2, 
    clientY: rect.top + rect.height / 2 
  };
  el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse' }));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.focus();
  el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse' }));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
};

/**
 * 精准等待元素出现
 */
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

/**
 * 等待元素消失
 */
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
 * 获取已有项目列表（通过模拟打开第一个选中项的菜单）
 */
const fetchProjects = async () => {
  if (selectedIds.size === 0) {
    alert('请先选择至少一个对话以获取项目列表');
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

  // 模拟 hover/点击 进入子菜单
  hardClick(moveMenuItem);
  await new Promise(r => setTimeout(r, 500));

  // 获取子菜单中的所有项目链接
  const subMenuItems = document.querySelectorAll('[role="menu"] a[role="menuitem"], [role="menu"] [role="menuitem"]');
  const projects = [];
  subMenuItems.forEach(el => {
    const title = el.querySelector('.truncate')?.innerText;
    if (title && title !== '新项目') {
      projects.push(title);
    }
  });

  availableProjects = [...new Set(projects)];
  
  // 关闭菜单
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  renderProjectDropdown();
};

/**
 * 自动化单次删除
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

/**
 * 自动化单次移动
 */
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

  // 等待子菜单并寻找目标项目
  const targetProject = await waitForElement('[role="menu"] [role="menuitem"]', 2000, projectName);
  if (!targetProject) return false;

  hardClick(targetProject);
  await new Promise(r => setTimeout(r, 1500)); // 等待移动完成
  return true;
};

const runBatchDelete = async () => {
  const ids = Array.from(selectedIds);
  if (!confirm(`确定要执行删除吗？共 ${ids.length} 项。`)) return;

  isProcessing = true;
  const platform = getPlatform();
  const config = PLATFORM_CONFIG[platform];
  const overlay = document.getElementById('history-manager-overlay');
  overlay.classList.add('processing');

  for (const id of ids) {
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

const runBatchMove = async (projectName) => {
  const ids = Array.from(selectedIds);
  if (!confirm(`确定将选中的 ${ids.length} 项对话移至项目“${projectName}”吗？`)) return;

  isProcessing = true;
  const platform = getPlatform();
  const config = PLATFORM_CONFIG[platform];
  const overlay = document.getElementById('history-manager-overlay');
  overlay.classList.add('processing');

  for (const id of ids) {
    const item = scannedItems.find(it => it.id === id);
    if (item) {
      const success = await moveOne(item, projectName, config);
      if (success) {
        selectedIds.delete(id);
        // 关键修复：迁移成功后，将项从扫描列表中移除，确保 UI 实时更新
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
  alert('迁移操作结束');
};

const renderDashboard = () => {
  const container = document.getElementById('dashboard-items-grid');
  if (!container) return;
  
  if (scannedItems.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>未发现对话</h3><p>请确保侧边栏已展开且包含历史记录</p></div>`;
  } else {
    container.innerHTML = scannedItems.map(item => `
      <div class="chat-card ${selectedIds.has(item.id) ? 'selected' : ''}" data-id="${item.id}">
        <div class="card-title">${item.title}</div>
        <div class="card-checkbox"></div>
      </div>
    `).join('');
  }
  
  container.querySelectorAll('.chat-card').forEach(card => {
    card.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isProcessing) return;
      const id = card.dataset.id;
      if (selectedIds.has(id)) {
        selectedIds.delete(id);
        card.classList.remove('selected');
      } else {
        selectedIds.add(id);
        card.classList.add('selected');
      }
      updateFooter();
    };
  });
};

const renderProjectDropdown = () => {
  const list = document.getElementById('available-projects-list');
  if (!list) return;
  
  if (availableProjects.length === 0) {
    list.innerHTML = `<div class="project-option-item disabled">无可用项目 (点击刷新)</div>`;
  } else {
    list.innerHTML = availableProjects.map(p => `
      <div class="project-option-item" data-name="${p}">${p}</div>
    `).join('');
  }

  list.querySelectorAll('.project-option-item:not(.disabled)').forEach(item => {
    item.onclick = () => {
      const projectName = item.dataset.name;
      runBatchMove(projectName);
      document.getElementById('project-dropdown').classList.remove('open');
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
  if (!platform || !PLATFORM_CONFIG[platform].enabled) return;

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
    availableProjects = [];
    renderDashboard();
    updateFooter();
  } else {
    overlay.style.setProperty('display', 'none', 'important');
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
          <p>选择您想要删除或整理的历史记录</p>
        </div>
        <button id="close-dash-btn">✕</button>
      </div>
      <div id="dashboard-items-grid" class="dashboard-body"></div>
      <div class="dashboard-footer">
        <span id="selected-count-label">0 项已选</span>
        <div class="footer-actions">
          <button id="dash-refresh-btn" class="btn-secondary">刷新列表</button>
          
          <div id="project-dropdown" class="dropdown-wrapper">
             <button id="dash-move-trigger" class="btn-secondary" disabled>移至项目 ▾</button>
             <div id="available-projects-list" class="dropdown-content">
                <div class="project-option-item disabled">点击获取项目列表</div>
             </div>
          </div>

          <button id="dash-delete-btn" class="btn-primary danger" disabled>执行删除</button>
        </div>
      </div>
      <div id="processing-mask">
         <div class="processing-card">
            <div class="spinner"></div>
            <span>正在执行自动化操作，请勿关闭窗口...</span>
         </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('close-dash-btn').onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleDashboard();
  };
  
  document.getElementById('dash-refresh-btn').onclick = () => { 
    scannedItems = scanHistory(); 
    renderDashboard(); 
  };

  const moveTrigger = document.getElementById('dash-move-trigger');
  const dropdown = document.getElementById('project-dropdown');
  
  moveTrigger.onclick = (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
    if (availableProjects.length === 0) {
      fetchProjects();
    }
  };

  window.addEventListener('click', () => {
    dropdown.classList.remove('open');
  });

  document.getElementById('dash-delete-btn').onclick = runBatchDelete;
};

const injectLauncher = () => {
  const platform = getPlatform();
  if (!platform || !PLATFORM_CONFIG[platform].enabled) return;
  
  if (document.getElementById('history-manager-launcher')) return;
  
  const sidebar = document.querySelector('nav') || document.querySelector('[role="navigation"]');
  if (!sidebar) return;

  const btn = document.createElement('button');
  btn.id = 'history-manager-launcher';
  btn.innerHTML = `<span>☑</span> 多选`;
  btn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleDashboard();
  };
  sidebar.appendChild(btn);
};

const observer = new MutationObserver(() => injectLauncher());
observer.observe(document.body, { childList: true, subtree: true });

setTimeout(() => {
  injectLauncher();
  initOverlay();
}, 2000);

const style = document.createElement('style');
style.textContent = `
  .processing #processing-mask { display: flex !important; }
`;
document.head.appendChild(style);
