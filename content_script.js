
/**
 * Global State
 */
let isDashboardOpen = false;
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
    projectItemSelector: '[role="menuitem"]'
  }
};

const getPlatform = () => {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
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
    const rawId = path.split('/').pop();
    if (seenIds.has(rawId)) return;
    seenIds.add(rawId);
    const titleEl = link.querySelector('.truncate, span[dir="auto"]');
    const title = titleEl ? titleEl.innerText : "Untitled Chat";
    results.push({ id: `id-${rawId}`, title, url: href });
  });
  return results;
};

const injectLauncher = () => {
  const platform = getPlatform();
  if (!platform) return;
  if (document.getElementById('history-manager-launcher')) return;
  const sidebar = document.querySelector('nav');
  if (!sidebar) return;
  const btn = document.createElement('button');
  btn.id = 'history-manager-launcher';
  btn.innerHTML = `<span>☑</span> 多选管理`;
  btn.onclick = (e) => { 
    e.preventDefault(); 
    e.stopPropagation(); 
    if (typeof toggleDashboard === 'function') toggleDashboard(); 
  };
  sidebar.prepend(btn);
};

// 监听 DOM 变化以重新注入按钮
const observer = new MutationObserver(() => injectLauncher());
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(injectLauncher, 1500);
