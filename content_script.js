
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
    // 登录标识：用户头像菜单按钮或对话输入框
    loginIndicators: ['[data-testid="user-menu-button"]', '#prompt-textarea', 'nav']
  }
};

/**
 * 登录状态检测
 * 判断当前是否处于已登录的对话主界面
 */
const isLoggedIn = () => {
  const platform = getPlatform();
  if (!platform || !PLATFORM_CONFIG[platform]) return false;
  
  const config = PLATFORM_CONFIG[platform];
  // 检查是否有任何一个标识登录状态的元素存在
  return config.loginIndicators.some(selector => !!document.querySelector(selector));
};

/**
 * 清理已注入的 UI
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

const getPlatform = () => {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
  return null;
};

const toggleDashboard = () => {
  // 只有在已登录状态下才允许打开
  if (!isLoggedIn()) return;
  
  let overlay = document.getElementById('history-manager-overlay');
  if (!overlay) {
    initOverlay();
    overlay = document.getElementById('history-manager-overlay');
  }
  isDashboardOpen = !isDashboardOpen;
  if (isDashboardOpen) {
    overlay.style.setProperty('display', 'flex', 'important');
    // ... dashboard logic
  } else {
    overlay.style.display = 'none';
  }
};

const initOverlay = () => {
  if (document.getElementById('history-manager-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'history-manager-overlay';
  overlay.innerHTML = `<div class="dashboard-window">...Dashboard Content...</div>`;
  document.body.appendChild(overlay);
};

/**
 * 注入发射按钮
 */
const injectLauncher = () => {
  const platform = getPlatform();
  if (!platform) return;

  // 1. 检查登录状态
  if (!isLoggedIn()) {
    // 如果未登录但 UI 存在（可能由于 SPA 路由切换），则清理掉
    cleanupUI();
    return;
  }

  // 2. 检查 UI 是否已存在
  if (document.getElementById('history-manager-launcher')) return;
  
  // 3. 寻找注入目标（侧边栏导航栏）
  const sidebar = document.querySelector('nav') || document.querySelector('[role="navigation"]');
  if (!sidebar) return;

  const btn = document.createElement('button');
  btn.id = 'history-manager-launcher';
  btn.innerHTML = `<span>☑</span> 多选`;
  btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleDashboard(); };
  
  // 注入到导航栏末尾
  sidebar.appendChild(btn);
  
  // 注入目录呼出按钮
  injectTOCLauncher();
  initTOC();
};

/**
 * SPA 自动观察者
 */
const observer = new MutationObserver(() => injectLauncher());

// 观察 body 变化以应对 SPA 路由跳转
observer.observe(document.body, { childList: true, subtree: true });

// 初始执行一次
setTimeout(injectLauncher, 2000);
