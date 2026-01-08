
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

const hardClick = (el) => {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
};

const getPlatform = () => {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
  return null;
};

const injectLauncher = () => {
  const platform = getPlatform();
  if (!platform) return;
  if (document.getElementById('history-manager-launcher')) return;
  const sidebar = document.querySelector('nav');
  if (!sidebar) return;
  const btn = document.createElement('button');
  btn.id = 'history-manager-launcher';
  btn.innerHTML = `<span>☑</span> 多选`;
  btn.onclick = (e) => { e.preventDefault(); toggleDashboard(); };
  sidebar.appendChild(btn);
};

const toggleDashboard = () => {
  alert("History Manager Dashboard Initiated");
};

const observer = new MutationObserver(() => injectLauncher());
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(injectLauncher, 2000);
