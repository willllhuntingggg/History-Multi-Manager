
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
    // 精准匹配用户发现的 data-testid 结构
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
 * 强力模拟点击：模拟真实硬件交互流程
 */
const hardClick = (el) => {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY };

  // 按顺序触发所有关键事件
  el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.focus();
  el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse', isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
};

/**
 * 等待元素出现（带超时和文本匹配）
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

    const container = link.closest('li') || link.closest('[role="listitem"]') || link.parentElement;
    const titleEl = link.querySelector('.truncate, .conversation-title, .flex-1');
    let title = titleEl ? titleEl.innerText : (link.innerText || "Untitled Chat");
    title = title.split('\n')[0].trim();

    results.push({
      id: `id-${rawId}`,
      title: title || "Untitled Chat",
      url: href
    });
  });
  return results;
};

/**
 * 自动化删除单条记录
 */
const deleteOne = async (item, config) => {
  console.log(`[BatchManager] 正在删除: ${item.title}`);
  
  const allLinks = Array.from(document.querySelectorAll(config.linkSelector));
  const link = allLinks.find(l => l.getAttribute('href') === item.url);
  if (!link) return false;

  const row = link.closest('li') || link.closest('[role="listitem"]') || link.parentElement;
  row.scrollIntoView({ block: 'center' });
  await new Promise(r => setTimeout(r, 400));

  // 1. 模拟 Hover 让按钮出现
  row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));

  // 2. 点击“三个点”按钮
  let menuBtn = row.querySelector(config.menuBtnSelector);
  if (!menuBtn) menuBtn = row.querySelector('button'); // 兜底方案
  if (!menuBtn) return false;
  
  hardClick(menuBtn);

  // 3. 等待菜单项渲染并点击删除
  const deleteBtn = await waitForElement('[role="menuitem"], button, li', config.deleteKeywords);
  if (!deleteBtn) return false;
  hardClick(deleteBtn);

  // 4. 等待确认弹窗并点击确认
  const confirmBtn = await waitForElement('button', config.confirmKeywords);
  if (!confirmBtn) return false;
  hardClick(confirmBtn);

  // 5. 等待系统物理删除动作
  await new Promise(r => setTimeout(r, 2000));
  return true;
};

/**
 * 运行批量删除
 */
const runBatchDelete = async () => {
  const ids = Array.from(selectedIds);
  if (!confirm(`确定要自动删除这 ${ids.length} 个对话吗？\n\n期间请不要操作页面。`)) return;

  isProcessing = true;
  const platform = getPlatform();
  const config = PLATFORM_CONFIG[platform];
  const overlay = document.getElementById('history-manager-overlay');
  
  overlay.style.opacity = "0.3";
  overlay.style.pointerEvents = "none";

  for (const id of ids) {
    const item = scannedItems.find(it => it.id === id);
    if (item) {
      const ok = await deleteOne(item, config);
      if (ok) {
        selectedIds.delete(id);
        scannedItems = scannedItems.filter(it => it.id !== id);
        renderDashboard();
        updateFooter();
      }
    }
    // 每次尝试按 Esc 清理可能残留的 UI 状态
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
  }

  isProcessing = false;
  overlay.style.opacity = "1";
  overlay.style.pointerEvents = "auto";
  alert('批量删除任务完成！');
};

const updateFooter = () => {
  const lbl = document.getElementById('selected-count-label');
  if (lbl) lbl.innerText = `已选 ${selectedIds.size} 项`;
  const btn = document.getElementById('dash-delete-btn');
  if (btn) btn.disabled = selectedIds.size === 0 || isProcessing;
};

const renderDashboard = () => {
  const container = document.getElementById('dashboard-items-grid');
  if (!container) return;
  if (scannedItems.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>没有找到记录</h3></div>`;
    return;
  }
  container.innerHTML = scannedItems.map(item => `
    <div class="chat-card ${selectedIds.has(item.id) ? 'selected' : ''}" data-id="${item.id}">
      <div class="card-title">${item.title}</div>
      <div class="card-checkbox"></div>
    </div>
  `).join('');
  
  container.querySelectorAll('.chat-card').forEach(card => {
    card.onclick = () => {
      const id = card.dataset.id;
      if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
      card.classList.toggle('selected');
      updateFooter();
    };
  });
};

const toggleDashboard = () => {
  if (isProcessing) return;
  const overlay = document.getElementById('history-manager-overlay');
  if (!overlay) return;
  isDashboardOpen = !isDashboardOpen;
  overlay.style.display = isDashboardOpen ? 'flex' : 'none';
  if (isDashboardOpen) {
    scannedItems = scanHistory();
    selectedIds.clear();
    renderDashboard();
    updateFooter();
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
          <p>基于您的侧边栏数据</p>
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
  btn.innerHTML = `<span>⚡</span> 批量管理`;
  btn.onclick = toggleDashboard;
  nav.prepend(btn);
};

const observer = new MutationObserver(injectLauncher);
observer.observe(document.body, { childList: true, subtree: true });
initOverlay();
