
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
    urlPattern: /^\/c\/[a-z0-9-]{10,}$/i, // 匹配 /c/ 后面跟着长 UUID 的链接
    menuBtnSelector: 'button[data-testid*="-options"]',
    deleteBtnSelector: '[data-testid="delete-chat-menu-item"]',
    confirmBtnSelector: '[data-testid="delete-conversation-confirm-button"]',
    modalSelector: '[role="dialog"]'
  },
  gemini: {
    linkSelector: 'a[href*="/app/"]',
    urlPattern: /^\/app\/[a-z0-9]{10,}$/i, // 匹配 Gemini 的对话 ID 格式
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
 * 扫描历史 - 增加了严格过滤
 */
const scanHistory = () => {
  const platform = getPlatform();
  if (!platform) return [];
  const config = PLATFORM_CONFIG[platform];
  
  // 获取侧边栏导航容器，缩小搜索范围
  const nav = document.querySelector('nav') || document.querySelector('[role="navigation"]') || document.body;
  const links = Array.from(nav.querySelectorAll(config.linkSelector));
  
  const results = [];
  const seenIds = new Set();

  links.forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) return;

    // 关键修复：使用正则校验 URL 路径
    // 排除 /c/new, /g/ (GPTs), /auth, /settings 等干扰
    const path = href.split('?')[0]; 
    if (!config.urlPattern.test(path)) return;
    
    // 提取纯净 ID
    const rawId = path.split('/').pop();
    if (seenIds.has(rawId)) return;
    seenIds.add(rawId);

    // 提取标题：优先取 span 或 .truncate
    const titleEl = link.querySelector('.truncate, span[dir="auto"], div.truncate');
    let title = titleEl ? titleEl.innerText : (link.innerText || "Untitled Chat");
    
    // 再次清洗标题（去除多余换行）
    title = title.split('\n')[0].trim();
    if (!title || title === "New chat") return;

    results.push({ id: `id-${rawId}`, title, url: href });
  });

  console.log(`[BatchManager] 过滤后扫描到 ${results.length} 个真实对话`);
  return results;
};

/**
 * 自动化单次删除
 */
const deleteOne = async (item, config) => {
  console.log(`[BatchManager] 正在处理: ${item.title}`);
  
  const link = document.querySelector(`a[href="${item.url}"]`);
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
    container.innerHTML = `
      <div class="empty-state">
        <div style="font-size:40px; margin-bottom:10px;">📭</div>
        <h3>未发现聊天记录</h3>
        <p>请确保侧边栏已展开，或尝试刷新页面。</p>
      </div>`;
  } else {
    container.innerHTML = scannedItems.map(item => `
      <div class="chat-card ${selectedIds.has(item.id) ? 'selected' : ''}" data-id="${item.id}">
        <div class="card-title" title="${item.title}">${item.title}</div>
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
    <div class="dashboard-window" style="width:90%; max-width:850px; height:80vh; background:#fff; border-radius:16px; display:flex; flex-direction:column; color:#333; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,0.5); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <div class="dashboard-header" style="padding:20px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h2 style="margin:0; font-size:18px;">批量管理助手</h2>
          <p style="margin:5px 0 0; font-size:12px; color:#666;">仅显示您的对话历史记录</p>
        </div>
        <button id="close-dash-btn" style="background:none; border:none; font-size:24px; cursor:pointer; color:#999;">✕</button>
      </div>
      <div id="dashboard-items-grid" class="dashboard-body" style="flex:1; padding:20px; overflow-y:auto; display:grid; grid-template-columns:repeat(auto-fill, minmax(160px, 1fr)); gap:12px; align-content:start;"></div>
      <div class="dashboard-footer" style="padding:15px 20px; background:#f9f9f9; border-top:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
        <span id="selected-count-label">0 项已选</span>
        <div class="footer-actions" style="display:flex; gap:10px;">
          <button id="dash-refresh-btn" style="padding:8px 15px; border-radius:6px; border:1px solid #ccc; background:#fff; cursor:pointer;">刷新列表</button>
          <button id="dash-delete-btn" class="danger" disabled style="padding:8px 20px; border-radius:6px; border:none; background:#ef4444; color:#fff; cursor:pointer; font-weight:bold;">执行批量删除</button>
        </div>
      </div>
      <div id="processing-mask" style="display:none; position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(255,255,255,0.7); z-index:100; align-items:center; justify-content:center; cursor:wait;">
         <div style="padding:30px; background:#fff; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.1); text-align:center;">
            <div class="spinner" style="width:30px; height:30px; border:3px solid #f3f3f3; border-top:3px solid #ef4444; border-radius:50%; animation: spin 1s linear infinite; margin: 0 auto 15px;"></div>
            <div style="font-weight:bold; color:#ef4444;">正在批量删除中...</div>
            <div style="font-size:12px; color:#666; margin-top:5px;">请勿关闭或操作页面</div>
         </div>
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
  @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  .processing #processing-mask { display: flex !important; }
  .chat-card { border:1px solid #e2e8f0; padding:15px; border-radius:10px; cursor:pointer; font-size:12px; transition:all 0.2s; position:relative; min-height:80px; display:flex; align-items:flex-start; background:#fff; overflow:hidden; }
  .chat-card:hover { border-color:#4f46e5; background:#f8fafc; transform: translateY(-2px); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
  .chat-card.selected { border-color:#4f46e5; background:#eff6ff; box-shadow:0 0 0 2px rgba(79,70,229,0.2); }
  .card-title { font-weight: 500; color: #1e293b; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .card-checkbox { position:absolute; bottom:10px; right:10px; width:18px; height:18px; border:2px solid #cbd5e1; border-radius:4px; background:#fff; display:flex; align-items:center; justify-content:center; }
  .selected .card-checkbox { background:#4f46e5; border-color:#4f46e5; }
  .selected .card-checkbox::after { content:'✓'; color:#fff; font-size:12px; font-weight:bold; }
  #dash-delete-btn:disabled { opacity:0.4; cursor:not-allowed; }
  .empty-state { grid-column: 1 / -1; padding: 100px 0; text-align: center; color: #94a3b8; }
`;
document.head.appendChild(style);
