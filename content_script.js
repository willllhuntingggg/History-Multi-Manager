
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
    menuBtnSelector: 'button[aria-haspopup="menu"], [data-testid$="-options"], button:has(svg.lucide-ellipsis)',
  },
  gemini: {
    linkSelector: 'a[href*="/app/"]',
    menuBtnSelector: 'button[aria-haspopup="true"]',
  }
};

/**
 * 辅助函数：等待元素出现
 */
const waitForElement = (selector, textKeywords = [], timeout = 3000) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const check = () => {
      const elements = Array.from(document.querySelectorAll(selector));
      const found = elements.find(el => {
        const txt = (el.innerText || el.textContent || "").toLowerCase();
        const isVisible = el.offsetParent !== null;
        return isVisible && (textKeywords.length === 0 || textKeywords.some(k => txt.includes(k.toLowerCase())));
      });

      if (found) resolve(found);
      else if (Date.now() - startTime > timeout) resolve(null);
      else requestAnimationFrame(check);
    };
    check();
  });
};

/**
 * 模拟真实点击
 */
const simulateClick = (el) => {
  if (!el) return;
  el.focus();
  const opts = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
};

const getPlatform = () => {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
  if (host.includes('gemini.google.com')) return 'gemini';
  return null;
};

/**
 * 扫描历史记录
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

    const container = link.closest('li') || link.closest('[role="listitem"]') || link.parentElement;
    const titleEl = link.querySelector('.truncate, .conversation-title, .flex-1');
    let title = titleEl ? titleEl.innerText : (link.innerText || "Untitled Chat");
    title = title.split('\n')[0].trim();

    results.push({
      id: `id-${rawId}`,
      title: title || "Untitled Chat",
      url: href,
      originalElement: container
    });
  });
  console.log(`[Manager] 扫描到 ${results.length} 条记录`);
  return results;
};

/**
 * 核心：删除单个会话的自动化流程
 */
const autoDeleteConversation = async (item, config) => {
  console.log(`[Manager] 开始处理: ${item.title}`);
  
  // 1. 重新定位 DOM 元素（防止页面变化）
  const allLinks = Array.from(document.querySelectorAll(config.linkSelector));
  const targetLink = allLinks.find(l => l.getAttribute('href') === item.url);
  if (!targetLink) return false;

  const row = targetLink.closest('li') || targetLink.closest('[role="listitem"]') || targetLink.parentElement;
  row.scrollIntoView({ block: 'center' });
  
  // 2. 触发 Hover
  row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));

  // 3. 点击“三个点”菜单
  let menuBtn = row.querySelector(config.menuBtnSelector) || row.querySelector('button');
  if (!menuBtn) return false;
  simulateClick(menuBtn);

  // 4. 等待弹出菜单中的“删除”按钮 (Search in global body)
  const deleteKeys = ['删除', 'delete', 'remove', 'clear'];
  const deleteMenuItem = await waitForElement('div[role="menuitem"], li[role="menuitem"], button', deleteKeys);
  
  if (!deleteMenuItem) {
    console.error("未找到删除菜单项");
    return false;
  }
  simulateClick(deleteMenuItem);

  // 5. 等待确认弹窗中的“确认”按钮
  const confirmKeys = ['确认', 'confirm', '删除', 'delete'];
  const confirmBtn = await waitForElement('button.btn-danger, button', confirmKeys);
  
  if (!confirmBtn) {
    console.error("未找到确认按钮");
    return false;
  }
  
  simulateClick(confirmBtn);
  
  // 6. 给后端一点响应时间
  await new Promise(r => setTimeout(r, 1500));
  return true;
};

const runBatchDelete = async () => {
  const idsToDelete = Array.from(selectedIds);
  if (!confirm(`确定要启动自动批量删除吗？\n将删除 ${idsToDelete.length} 条记录。\n\n运行期间请勿操作网页。`)) return;

  isProcessing = true;
  const platform = getPlatform();
  const config = PLATFORM_CONFIG[platform];
  const overlay = document.getElementById('history-manager-overlay');
  
  overlay.style.opacity = "0.3";
  overlay.style.pointerEvents = "none";

  for (let id of idsToDelete) {
    const item = scannedItems.find(it => it.id === id);
    if (!item) continue;

    const success = await autoDeleteConversation(item, config);
    if (success) {
      selectedIds.delete(id);
      scannedItems = scannedItems.filter(it => it.id !== id);
      renderDashboard();
      updateDashboardUI();
    }
    // 强制按 ESC 清理残留
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
  }

  overlay.style.opacity = "1";
  overlay.style.pointerEvents = "auto";
  isProcessing = false;
  updateDashboardUI();
  alert('批量操作已完成。');
};

/**
 * UI 渲染部分保持不变，仅修复样式关联
 */
const toggleDashboard = () => {
  if (isProcessing) return;
  const overlay = document.getElementById('history-manager-overlay');
  if (!overlay) return;
  isDashboardOpen = !isDashboardOpen;
  if (isDashboardOpen) {
    scannedItems = scanHistory();
    selectedIds.clear();
    renderDashboard();
    overlay.style.display = 'flex';
  } else {
    overlay.style.display = 'none';
    document.body.style.overflow = '';
  }
};

const renderDashboard = () => {
  const container = document.getElementById('dashboard-items-grid');
  if (!container) return;
  if (scannedItems.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>未找到记录</h3><p>请确保侧边栏已展开。</p></div>`;
    return;
  }
  container.innerHTML = scannedItems.map(item => `
    <div class="chat-card ${selectedIds.has(item.id) ? 'selected' : ''}" data-id="${item.id}">
      <div class="card-title" title="${item.title}">${item.title}</div>
      <div class="card-checkbox"></div>
    </div>
  `).join('');
  
  container.querySelectorAll('.chat-card').forEach(card => {
    card.onclick = (e) => {
      const id = card.getAttribute('data-id');
      if (selectedIds.has(id)) selectedIds.delete(id);
      else selectedIds.add(id);
      updateDashboardUI();
    };
  });
};

const updateDashboardUI = () => {
  const countLabel = document.getElementById('selected-count-label');
  if (countLabel) countLabel.innerText = `已选 ${selectedIds.size} 项`;
  const deleteBtn = document.getElementById('dash-delete-btn');
  if (deleteBtn) deleteBtn.disabled = selectedIds.size === 0 || isProcessing;
  
  document.querySelectorAll('.chat-card').forEach(card => {
    card.classList.toggle('selected', selectedIds.has(card.getAttribute('data-id')));
  });
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
          <p>请保持在历史记录可见的状态下运行。</p>
        </div>
        <button id="close-dash-btn">✕</button>
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
  document.getElementById('close-dash-btn').onclick = toggleDashboard;
  document.getElementById('dash-refresh-btn').onclick = () => { scannedItems = scanHistory(); renderDashboard(); };
  document.getElementById('dash-delete-btn').onclick = runBatchDelete;
};

const injectLauncher = () => {
  if (document.getElementById('history-manager-launcher')) return;
  const nav = document.querySelector('nav');
  if (!nav) return;

  const btn = document.createElement('button');
  btn.id = 'history-manager-launcher';
  btn.innerHTML = `<span>⚡</span> 批量管理历史`;
  btn.onclick = toggleDashboard;
  nav.prepend(btn);
};

const observer = new MutationObserver(() => { injectLauncher(); initOverlay(); });
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(() => { injectLauncher(); initOverlay(); }, 1500);
