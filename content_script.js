
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
 * 等待元素消失 (关键：防止循环弹出确认框)
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
  const seenIds = new Set();

  links.forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) return;

    // 修复：仅匹配符合对话路径规则的链接，排除 /explore, /g/ 等菜单项
    const path = href.split('?')[0];
    if (!config.urlPattern.test(path)) return;
    
    if (href.includes('/new') || href === '/') return;
    
    // 提取ID
    const rawId = path.split('/').pop();
    if (seenIds.has(rawId)) return;
    seenIds.add(rawId);

    const titleEl = link.querySelector('.truncate, span[dir="auto"]');
    const title = titleEl ? titleEl.innerText : "Untitled Chat";

    results.push({ id: `id-${rawId}`, title, url: href });
  });
  console.log(`[BatchManager] 扫描到 ${results.length} 个真实对话`);
  return results;
};

/**
 * 自动化单次删除
 */
const deleteOne = async (item, config) => {
  console.log(`[BatchManager] 开始删除: ${item.title}`);
  
  // 1. 寻找列表项
  const link = document.querySelector(`${config.linkSelector}[href="${item.url}"]`);
  if (!link) {
    console.warn(`[BatchManager] 未找到链接: ${item.url}`);
    return false;
  }

  // 2. 找到菜单按钮并点击
  const menuBtn = link.querySelector(config.menuBtnSelector);
  if (!menuBtn) {
    console.warn(`[BatchManager] 未找到菜单按钮`);
    return false;
  }
  
  link.scrollIntoView({ block: 'center' });
  await new Promise(r => setTimeout(r, 300));
  hardClick(menuBtn);

  // 3. 等待并点击删除菜单项
  const deleteBtn = await waitForElement(config.deleteBtnSelector);
  if (!deleteBtn) {
    console.warn(`[BatchManager] 未找到删除选项`);
    return false;
  }
  hardClick(deleteBtn);

  // 4. 等待并点击确认按钮
  const confirmBtn = await waitForElement(config.confirmBtnSelector);
  if (!confirmBtn) {
    console.warn(`[BatchManager] 未找到确认按钮`);
    return false;
  }
  
  hardClick(confirmBtn);

  // 5. 核心：等待确认弹窗彻底从 DOM 消失
  console.log(`[BatchManager] 等待弹窗消失...`);
  const isGone = await waitForDisappear(config.confirmBtnSelector);
  
  if (!isGone) {
    console.error(`[BatchManager] 确认弹窗超时未关闭，停止后续操作以免陷入死循环`);
    return false;
  }

  await new Promise(r => setTimeout(r, 1000));
  return true;
};

const runBatchDelete = async () => {
  const ids = Array.from(selectedIds);
  if (!confirm(`确定要执行批量删除吗？共 ${ids.length} 项。\n操作期间请勿刷新页面。`)) return;

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
        // 如果失败，可以尝试发送 ESC 键关闭可能卡住的菜单
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
    card.onclick = () => {
      if (isProcessing) return;
      const id = card.dataset.id;
      if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
      card.classList.toggle('selected');
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
  overlay.style.cssText = "display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; z-index:99999999; background:rgba(0,0,0,0.85); align-items:center; justify-content:center; backdrop-filter:blur(5px);";
  
  overlay.innerHTML = `
    <div class="dashboard-window" style="width:90%; max-width:850px; height:80vh; background:#fff; border-radius:16px; display:flex; flex-direction:column; color:#333; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <div class="dashboard-header" style="padding:20px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h2 style="margin:0; font-size:18px;">批量管理助手</h2>
          <p style="margin:5px 0 0; font-size:12px; color:#666;">精准控制您的历史记录</p>
        </div>
        <button id="close-dash-btn" style="background:none; border:none; font-size:24px; cursor:pointer;">✕</button>
      </div>
      <div id="dashboard-items-grid" class="dashboard-body" style="flex:1; padding:20px; overflow-y:auto; display:grid; grid-template-columns:repeat(auto-fill, minmax(160px, 1fr)); gap:12px; align-content:start;"></div>
      <div class="dashboard-footer" style="padding:15px 20px; background:#f9f9f9; border-top:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
        <span id="selected-count-label">0 项已选</span>
        <div class="footer-actions" style="display:flex; gap:10px;">
          <button id="dash-refresh-btn" style="padding:8px 15px; border-radius:6px; border:1px solid #ccc; background:#fff; cursor:pointer;">刷新扫描</button>
          <button id="dash-delete-btn" class="danger" disabled style="padding:8px 20px; border-radius:6px; border:none; background:#ef4444; color:#fff; cursor:pointer; font-weight:bold;">执行批量删除</button>
        </div>
      </div>
      <div id="processing-mask" style="display:none; position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(255,255,255,0.6); z-index:100; align-items:center; justify-content:center; cursor:wait;">
         <div style="padding:20px; background:#fff; border-radius:8px; box-shadow:0 5px 15px rgba(0,0,0,0.2); font-weight:bold;">正在自动化操作，请勿关闭...</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('close-dash-btn').onclick = toggleDashboard;
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
  sidebar.prepend(btn);
};

// 监听与初始启动
const observer = new MutationObserver(() => injectLauncher());
observer.observe(document.body, { childList: true, subtree: true });

setTimeout(() => {
  injectLauncher();
  initOverlay();
}, 2000);

// 全局样式
const style = document.createElement('style');
style.textContent = `
  .processing #processing-mask { display: flex !important; }
  .chat-card { border:1px solid #ddd; padding:12px; border-radius:8px; cursor:pointer; font-size:12px; transition:all 0.2s; position:relative; min-height:60px; display:flex; align-items:center; background:#fff; }
  .chat-card:hover { border-color:#4f46e5; background:#f5f3ff; }
  .chat-card.selected { border-color:#4f46e5; background:#eef2ff; box-shadow:0 0 0 2px rgba(79,70,229,0.2); }
  .chat-card.selected::after { content:'✓'; position:absolute; top:5px; right:8px; color:#4f46e5; font-weight:bold; font-size:14px; }
  #dash-delete-btn:disabled { opacity:0.4; cursor:not-allowed; }
`;
document.head.appendChild(style);
