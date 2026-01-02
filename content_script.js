
/**
 * Global State
 */
let isDashboardOpen = false;
let scannedItems = []; 
let selectedIds = new Set();
let isProcessing = false;

const PLATFORM_CONFIG = {
  chatgpt: {
    linkSelector: 'a[data-sidebar-item="true"]',
    urlPattern: /^\/c\/[a-z0-9-]{10,}$/i, 
    menuBtnSelector: 'button[data-testid*="-options"]',
    deleteBtnSelector: '[data-testid="delete-chat-menu-item"]',
    confirmBtnSelector: '[data-testid="delete-conversation-confirm-button"]',
    modalSelector: '[role="dialog"]'
  },
  gemini: {
    linkSelector: 'a[href*="/app/"]',
    urlPattern: /^\/app\/[a-z0-9]{10,}$/i,
    menuBtnSelector: 'button[aria-haspopup="true"]',
    deleteBtnSelector: '[role="menuitem"], .delete-button',
    confirmBtnSelector: 'button.delete-confirm, .confirm-button',
    modalSelector: '[role="dialog"]'
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
const waitForElement = (selector, timeout = 3000) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const check = () => {
      const el = document.querySelector(selector);
      if (el && el.offsetParent !== null) resolve(el);
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
  if (!platform) return [];
  const config = PLATFORM_CONFIG[platform];
  
  const links = Array.from(document.querySelectorAll(config.linkSelector));
  const results = [];
  const seenIds = Set.prototype.constructor === Set ? new Set() : []; // Simple check for older envs

  links.forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) return;

    const path = href.split('?')[0];
    if (!config.urlPattern.test(path)) return;
    
    if (href.includes('/new') || href === '/') return;
    
    const rawId = path.split('/').pop();
    if (seenIds instanceof Set && seenIds.has(rawId)) return;
    if (seenIds instanceof Set) seenIds.add(rawId);

    const titleEl = link.querySelector('.truncate, span[dir="auto"]');
    const title = titleEl ? titleEl.innerText : "Untitled Chat";

    results.push({ id: `id-${rawId}`, title, url: href });
  });
  return results;
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
  await new Promise(r => setTimeout(r, 300));
  hardClick(menuBtn);

  const deleteBtn = await waitForElement(config.deleteBtnSelector);
  if (!deleteBtn) return false;
  hardClick(deleteBtn);

  const confirmBtn = await waitForElement(config.confirmBtnSelector);
  if (!confirmBtn) return false;
  
  hardClick(confirmBtn);

  const isGone = await waitForDisappear(config.confirmBtnSelector);
  if (!isGone) return false;

  await new Promise(r => setTimeout(r, 1000));
  return true;
};

const runBatchDelete = async () => {
  const ids = Array.from(selectedIds);
  if (!confirm(`确定要执行批量删除吗？共 ${ids.length} 项。`)) return;

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
  alert('批量操作结束');
};

const renderDashboard = () => {
  const container = document.getElementById('dashboard-items-grid');
  if (!container) return;
  
  if (scannedItems.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>未发现对话</h3><p>请确保侧边栏已展开</p></div>`;
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

const updateFooter = () => {
  const lbl = document.getElementById('selected-count-label');
  const btn = document.getElementById('dash-delete-btn');
  if (lbl) lbl.innerText = `${selectedIds.size} 项已选`;
  if (btn) btn.disabled = selectedIds.size === 0 || isProcessing;
};

const toggleDashboard = () => {
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
          <h2>批量管理对话</h2>
          <p>选择您想要批量删除或整理的历史记录</p>
        </div>
        <button id="close-dash-btn">✕</button>
      </div>
      <div id="dashboard-items-grid" class="dashboard-body"></div>
      <div class="dashboard-footer">
        <span id="selected-count-label">0 项已选</span>
        <div class="footer-actions">
          <button id="dash-refresh-btn" class="btn-secondary">刷新列表</button>
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
  document.getElementById('dash-refresh-btn').onclick = () => { scannedItems = scanHistory(); renderDashboard(); };
  document.getElementById('dash-delete-btn').onclick = runBatchDelete;
};

const injectLauncher = () => {
  if (document.getElementById('history-manager-launcher')) return;
  const sidebar = document.querySelector('nav') || document.querySelector('[role="navigation"]');
  if (!sidebar) return;

  const btn = document.createElement('button');
  btn.id = 'history-manager-launcher';
  btn.innerHTML = `<span>⚡</span> 批量管理`;
  btn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleDashboard();
  };
  sidebar.appendChild(btn);
};

// 监听与初始启动
const observer = new MutationObserver(() => injectLauncher());
observer.observe(document.body, { childList: true, subtree: true });

setTimeout(() => {
  injectLauncher();
  initOverlay();
}, 2000);

// 保持基础功能逻辑样式，复杂UI通过 content_style.css 控制
const style = document.createElement('style');
style.textContent = `
  .processing #processing-mask { display: flex !important; }
`;
document.head.appendChild(style);
