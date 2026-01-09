
/**
 * Global State
 */
let isDashboardOpen = false;
let isTOCSidebarOpen = false; // New state for TOC
let scannedItems = []; 
let selectedIds = new Set();
let baseSelection = new Set(); 
let pivotId = null; 
let availableProjects = []; 
let isProcessing = false;
let searchQuery = ''; 
let platformConfigEnabled = true;

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
 * TOC 功能逻辑
 */
const initTOC = () => {
  if (document.getElementById('chat-toc-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'chat-toc-panel';
  panel.innerHTML = `
    <div class="toc-header">
      <span class="toc-header-title">会话目录</span>
      <button id="close-toc-btn">✕</button>
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
  
  // 查找所有用户发送的消息
  const userMessages = document.querySelectorAll('div[data-message-author-role="user"]');
  if (userMessages.length === 0) {
    list.innerHTML = '<div class="toc-empty">未发现用户侧消息</div>';
    return;
  }

  list.innerHTML = Array.from(userMessages).map((msg, idx) => {
    // 提取文本，优先找 whitespace-pre-wrap
    const textEl = msg.querySelector('.whitespace-pre-wrap') || msg;
    const text = textEl.innerText.trim().replace(/\n/g, ' ');
    return `
      <div class="toc-item" data-idx="${idx}" title="${text}">
        <div class="toc-item-inner">
          <span class="toc-num">${idx + 1}</span>
          <span class="toc-text">${text}</span>
        </div>
      </div>
    `;
  }).join('');

  // 绑定滚动跳转事件
  list.querySelectorAll('.toc-item').forEach(item => {
    item.onclick = () => {
      const idx = item.dataset.idx;
      const targetMsg = userMessages[idx];
      targetMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // 添加一个短暂的高亮反馈
      const originalBg = targetMsg.style.background;
      targetMsg.style.transition = 'background 0.5s ease';
      targetMsg.style.background = 'rgba(55, 54, 91, 0.15)';
      setTimeout(() => targetMsg.style.background = originalBg, 1500);
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
 * 获取已有项目列表
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

  hardClick(moveMenuItem);
  await new Promise(r => setTimeout(r, 500));

  const subMenuItems = document.querySelectorAll('[role="menu"] a[role="menuitem"], [role="menu"] [role="menuitem"]');
  const projects = [];
  subMenuItems.forEach(el => {
    const title = el.querySelector('.truncate')?.innerText;
    if (title && title !== '新项目') {
      projects.push(title);
    }
  });

  availableProjects = [...new Set(projects)];
  
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  renderProjectDropdown();
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
 * 更新处理进度文本
 */
const updateProgress = (current, total) => {
  const el = document.getElementById('processing-progress-text');
  if (el) el.innerText = `正在处理第 ${current} / ${total} 项...`;
};

const runBatchDelete = async () => {
  const ids = Array.from(selectedIds);
  if (!confirm(`确定要执行删除吗？共 ${ids.length} 项。`)) return;

  isProcessing = true;
  const platform = getPlatform();
  const config = PLATFORM_CONFIG[platform];
  const overlay = document.getElementById('history-manager-overlay');
  overlay.classList.add('processing');

  const total = ids.length;
  let currentCount = 0;

  for (const id of ids) {
    currentCount++;
    updateProgress(currentCount, total);
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

  const total = ids.length;
  let currentCount = 0;

  for (const id of ids) {
    currentCount++;
    updateProgress(currentCount, total);
    const item = scannedItems.find(it => it.id === id);
    if (item) {
      const success = await moveOne(item, projectName, config);
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
  alert('迁移操作结束');
};

const renderDashboard = () => {
  const container = document.getElementById('dashboard-items-grid');
  if (!container) return;
  
  const filteredItems = scannedItems.filter(item => 
    item.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (scannedItems.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>未发现对话</h3><p>请确保侧边栏已展开且包含历史记录</p></div>`;
  } else if (filteredItems.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>未找到匹配结果</h3><p>尝试搜索其他关键词</p></div>`;
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
      e.stopPropagation();
      if (isProcessing) return;
      
      const id = card.dataset.id;
      const isShift = e.shiftKey;

      const currentIds = filteredItems.map(it => it.id);
      
      if (isShift && pivotId) {
        // Shift 范围选择逻辑：基于锚点和当前基准选择状态
        const startIndex = currentIds.indexOf(pivotId);
        const endIndex = currentIds.indexOf(id);
        
        if (startIndex !== -1 && endIndex !== -1) {
          const [min, max] = [Math.min(startIndex, endIndex), Math.max(startIndex, endIndex)];
          const rangeIds = currentIds.slice(min, max + 1);
          
          // 决定是增加还是减少：取决于 pivotId 在点击那一刻的状态
          const shouldSelect = baseSelection.has(pivotId);
          
          // 从基准状态开始重新计算当前所有选择
          const newSelection = new Set(baseSelection);
          rangeIds.forEach(rid => {
            if (shouldSelect) newSelection.add(rid);
            else newSelection.delete(rid);
          });
          
          selectedIds = newSelection;
        }
      } else {
        // 普通点击：切换状态并更新锚点
        if (selectedIds.has(id)) {
          selectedIds.delete(id);
        } else {
          selectedIds.add(id);
        }
        // 更新锚点和基准状态，确保下一次 Shift 操作基于此点击
        pivotId = id;
        baseSelection = new Set(selectedIds);
      }

      renderDashboard(); 
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
    list.innerHTML = availableProjects.map(p => `<div class="project-option-item" data-name="${p}">${p}</div>`).join('');
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
    baseSelection.clear();
    availableProjects = [];
    searchQuery = '';
    pivotId = null;
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
        <div class="header-info">
          <h2>多选管理对话</h2>
          <p>支持 Shift 连选（含反选/范围缩减）</p>
        </div>
        <button id="close-dash-btn">✕</button>
      </div>
      <div class="dashboard-search-container">
        <div class="search-input-wrapper">
          <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" id="dash-search-input" placeholder="模糊搜索历史记录..." />
        </div>
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
            <span id="processing-main-text">正在执行自动化操作...</span>
            <span id="processing-progress-text" style="font-size: 12px; opacity: 0.6; margin-top: -8px;"></span>
         </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('close-dash-btn').onclick = () => toggleDashboard();
  document.getElementById('dash-refresh-btn').onclick = () => { scannedItems = scanHistory(); renderDashboard(); };
  const searchInput = document.getElementById('dash-search-input');
  searchInput.oninput = (e) => { searchQuery = e.target.value; renderDashboard(); };
  const moveTrigger = document.getElementById('dash-move-trigger');
  const dropdown = document.getElementById('project-dropdown');
  moveTrigger.onclick = (e) => { e.stopPropagation(); dropdown.classList.toggle('open'); if (availableProjects.length === 0) fetchProjects(); };
  window.addEventListener('click', () => dropdown.classList.remove('open'));
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
  btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleDashboard(); };
  sidebar.appendChild(btn);
  
  // 注入目录呼出入口
  injectTOCLauncher();
};

const observer = new MutationObserver(() => injectLauncher());
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(() => { injectLauncher(); initOverlay(); initTOC(); }, 2000);

const style = document.createElement('style');
style.textContent = `.processing #processing-mask { display: flex !important; }`;
document.head.appendChild(style);
