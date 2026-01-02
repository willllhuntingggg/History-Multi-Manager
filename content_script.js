
/**
 * Global State
 */
let isDashboardOpen = false;
let scannedItems = []; 
let selectedIds = new Set();
let isProcessing = false;

const PLATFORM_CONFIG = {
  chatgpt: {
    linkSelector: 'a[href*="/c/"]',
    menuBtnSelector: 'button[data-testid$="-options"], button[aria-haspopup="menu"]',
    deleteKeywords: ['删除', 'delete', 'remove'],
    confirmKeywords: ['确认', 'confirm', '删除', 'delete']
  },
  gemini: {
    linkSelector: 'a[href*="/app/"]',
    menuBtnSelector: 'button[aria-haspopup="true"]',
    deleteKeywords: ['删除', 'delete', 'remove'],
    confirmKeywords: ['确认', 'confirm', '删除', 'delete']
  }
};

/**
 * 强力模拟点击
 */
const hardClick = (el) => {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY };

  el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.focus();
  el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
};

/**
 * 等待元素
 */
const waitForElement = (selector, keywords = [], timeout = 5000) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const check = () => {
      const elements = Array.from(document.querySelectorAll(selector));
      const found = elements.find(el => {
        const text = (el.innerText || el.textContent || "").toLowerCase();
        const isVisible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        return isVisible && (keywords.length === 0 || keywords.some(k => text.includes(k.toLowerCase())));
      });

      if (found) resolve(found);
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
    if (!href || href.includes('/c/new')) return;

    const uuidMatch = href.match(/\/c\/([a-z0-9\-]+)/i) || href.match(/\/app\/([a-z0-9\-]+)/i);
    const rawId = uuidMatch ? uuidMatch[1] : href;

    if (seenIds.has(rawId)) return;
    seenIds.add(rawId);

    const titleEl = link.querySelector('.truncate, .conversation-title, .flex-1');
    let title = titleEl ? titleEl.innerText : (link.innerText || "Untitled Chat");
    title = title.split('\n')[0].trim();

    results.push({
      id: `id-${rawId}`,
      title: title || "Untitled Chat",
      url: href
    });
  });
  console.log(`[BatchManager] 扫描完成，共 ${results.length} 条记录`);
  return results;
};

/**
 * 自动化逻辑保持不变...
 */
const deleteOne = async (item, config) => {
  const allLinks = Array.from(document.querySelectorAll(config.linkSelector));
  const link = allLinks.find(l => l.getAttribute('href') === item.url);
  if (!link) return false;

  const row = link.closest('li') || link.closest('[role="listitem"]') || link.parentElement;
  row.scrollIntoView({ block: 'center' });
  await new Promise(r => setTimeout(r, 400));
  row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));

  let menuBtn = row.querySelector(config.menuBtnSelector);
  if (!menuBtn) menuBtn = row.querySelector('button');
  if (!menuBtn) return false;
  
  hardClick(menuBtn);
  const deleteBtn = await waitForElement('[role="menuitem"], button, li', config.deleteKeywords);
  if (!deleteBtn) return false;
  hardClick(deleteBtn);
  const confirmBtn = await waitForElement('button', config.confirmKeywords);
  if (!confirmBtn) return false;
  hardClick(confirmBtn);
  await new Promise(r => setTimeout(r, 2000));
  return true;
};

const runBatchDelete = async () => {
  const ids = Array.from(selectedIds);
  if (!confirm(`确定要自动删除这 ${ids.length} 个对话吗？`)) return;

  isProcessing = true;
  const platform = getPlatform();
  const config = PLATFORM_CONFIG[platform];
  const overlay = document.getElementById('history-manager-overlay');
  overlay.style.opacity = "0.3";

  for (const id of ids) {
    const item = scannedItems.find(it => it.id === id);
    if (item && await deleteOne(item, config)) {
      selectedIds.delete(id);
      scannedItems = scannedItems.filter(it => it.id !== id);
      renderDashboard();
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
  }

  isProcessing = false;
  overlay.style.opacity = "1";
  alert('批量删除任务完成！');
};

const renderDashboard = () => {
  const container = document.getElementById('dashboard-items-grid');
  if (!container) return;
  
  if (scannedItems.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>没有找到记录</h3><p>请确保侧边栏已加载</p></div>`;
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
      const id = card.dataset.id;
      if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
      card.classList.toggle('selected');
      const lbl = document.getElementById('selected-count-label');
      if (lbl) lbl.innerText = `已选 ${selectedIds.size} 项`;
      const btn = document.getElementById('dash-delete-btn');
      if (btn) btn.disabled = selectedIds.size === 0 || isProcessing;
    };
  });
};

/**
 * 核心修复：toggleDashboard 现在具备自我修复能力
 */
const toggleDashboard = () => {
  console.log('[BatchManager] 尝试切换面板状态...');
  if (isProcessing) return;

  let overlay = document.getElementById('history-manager-overlay');
  if (!overlay) {
    console.warn('[BatchManager] 遮罩层丢失，正在重新初始化...');
    initOverlay();
    overlay = document.getElementById('history-manager-overlay');
  }

  isDashboardOpen = !isDashboardOpen;
  if (isDashboardOpen) {
    overlay.style.display = 'flex';
    scannedItems = scanHistory();
    selectedIds.clear();
    renderDashboard();
    const btn = document.getElementById('dash-delete-btn');
    if (btn) btn.disabled = true;
    const lbl = document.getElementById('selected-count-label');
    if (lbl) lbl.innerText = `已选 0 项`;
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
          <h2>批量管理助手</h2>
          <p>请勾选需要删除的对话</p>
        </div>
        <button id="close-dash-btn" style="padding:10px">✕</button>
      </div>
      <div id="dashboard-items-grid" class="dashboard-body"></div>
      <div class="dashboard-footer">
        <span id="selected-count-label">0 项已选</span>
        <div class="footer-actions">
          <button id="dash-refresh-btn">重新扫描</button>
          <button id="dash-delete-btn" class="danger" disabled>开始批量删除</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  
  // 绑定事件
  document.getElementById('close-dash-btn').onclick = toggleDashboard;
  document.getElementById('dash-refresh-btn').onclick = () => { scannedItems = scanHistory(); renderDashboard(); };
  document.getElementById('dash-delete-btn').onclick = runBatchDelete;
  
  console.log('[BatchManager] 遮罩层初始化成功');
};

const injectLauncher = () => {
  if (document.getElementById('history-manager-launcher')) return;
  
  // 尝试多个可能的侧边栏容器
  const sidebar = document.querySelector('nav') || 
                  document.querySelector('[role="navigation"]') || 
                  document.querySelector('.flex-col.flex-1.overflow-y-auto');
                  
  if (!sidebar) return;

  const btn = document.createElement('button');
  btn.id = 'history-manager-launcher';
  btn.innerHTML = `<span>⚡</span> 批量管理历史`;
  btn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleDashboard();
  };
  
  sidebar.prepend(btn);
  console.log('[BatchManager] 启动按钮注入成功');
};

// 启动监听
const observer = new MutationObserver(() => {
  injectLauncher();
  if (!document.getElementById('history-manager-overlay')) {
    initOverlay();
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// 初始执行一次
setTimeout(() => {
  injectLauncher();
  initOverlay();
}, 1000);
