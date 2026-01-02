
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
    menuBtnSelector: 'button[data-testid$="-options"]',
    deleteKeywords: ['删除', 'delete', 'remove'],
    confirmKeywords: ['确认', 'confirm', '删除', 'delete'],
    modalSelector: '[role="dialog"], .modal-content'
  },
  gemini: {
    linkSelector: 'a[href*="/app/"]',
    menuBtnSelector: 'button[aria-haspopup="true"]',
    deleteKeywords: ['删除', 'delete', 'remove'],
    confirmKeywords: ['确认', 'confirm', '删除', 'delete'],
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
 * 等待元素出现
 */
const waitForElement = (selector, keywords = [], timeout = 4000) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const check = () => {
      const elements = Array.from(document.querySelectorAll(selector));
      const found = elements.find(el => {
        const text = (el.innerText || el.textContent || "").toLowerCase();
        return keywords.length === 0 || keywords.some(k => text.includes(k.toLowerCase()));
      });
      if (found) resolve(found);
      else if (Date.now() - startTime > timeout) resolve(null);
      else setTimeout(check, 100);
    };
    check();
  });
};

/**
 * 关键：等待元素消失（防止死循环）
 */
const waitForDisappear = (element, timeout = 3000) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const check = () => {
      if (!element || !document.body.contains(element) || element.offsetParent === null) {
        resolve(true);
      } else if (Date.now() - startTime > timeout) {
        resolve(false);
      } else {
        setTimeout(check, 100);
      }
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

    results.push({ id: `id-${rawId}`, title, url: href });
  });
  return results;
};

/**
 * 自动化单次删除
 */
const deleteOne = async (item, config) => {
  console.log(`[BatchManager] 正在处理: ${item.title}`);
  
  const allLinks = Array.from(document.querySelectorAll(config.linkSelector));
  const link = allLinks.find(l => l.getAttribute('href') === item.url);
  if (!link) return false;

  const row = link.closest('li') || link.closest('[role="listitem"]') || link.parentElement;
  row.scrollIntoView({ block: 'center' });
  await new Promise(r => setTimeout(r, 400));

  // 1. 点击菜单
  let menuBtn = row.querySelector(config.menuBtnSelector);
  if (!menuBtn) menuBtn = row.querySelector('button[aria-haspopup="menu"]');
  if (!menuBtn) return false;
  hardClick(menuBtn);

  // 2. 点击删除选项
  const deleteBtn = await waitForElement('[role="menuitem"], button', config.deleteKeywords);
  if (!deleteBtn) return false;
  hardClick(deleteBtn);

  // 3. 处理确认弹窗
  await new Promise(r => setTimeout(r, 500));
  const modal = await waitForElement(config.modalSelector, config.confirmKeywords);
  if (!modal) return false;

  const confirmBtn = Array.from(modal.querySelectorAll('button')).find(b => 
    config.confirmKeywords.some(k => b.innerText.toLowerCase().includes(k))
  );

  if (confirmBtn) {
    hardClick(confirmBtn);
    // 关键修复：等待弹窗彻底消失，才算完成
    const gone = await waitForDisappear(modal);
    console.log(gone ? "[BatchManager] 弹窗已消失" : "[BatchManager] 警告：弹窗未在预定时间内消失");
    await new Promise(r => setTimeout(r, 800));
    return true;
  }
  return false;
};

const runBatchDelete = async () => {
  const ids = Array.from(selectedIds);
  if (!confirm(`确定开始删除 ${ids.length} 项吗？\n删除过程中请保持窗口活跃。`)) return;

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
      }
    }
    // 每次操作后按 Esc 键清理残留菜单
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 600));
  }

  isProcessing = false;
  overlay.classList.remove('processing');
  alert('批量删除已完成！');
};

const renderDashboard = () => {
  const container = document.getElementById('dashboard-items-grid');
  if (!container) return;
  
  if (scannedItems.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>扫描完成，但没有找到对话</h3><p>请确保侧边栏已展开且加载了历史记录</p></div>`;
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
  if (lbl) lbl.innerText = `已选 ${selectedIds.size} 项`;
  const btn = document.getElementById('dash-delete-btn');
  if (btn) btn.disabled = selectedIds.size === 0 || isProcessing;
};

const toggleDashboard = () => {
  const overlay = document.getElementById('history-manager-overlay');
  if (!overlay) {
    initOverlay();
    return toggleDashboard();
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
  overlay.style.cssText = "display:none; position:fixed; top:0; left:0; width:100%; height:100%; z-index:999999; background:rgba(0,0,0,0.8); align-items:center; justify-content:center;";
  
  overlay.innerHTML = `
    <div class="dashboard-window" style="position:relative;">
      <div class="dashboard-header">
        <div class="header-info">
          <h2>批量助手 v1.0.2</h2>
          <p>请选择要删除的项目</p>
        </div>
        <button id="close-dash-btn" style="background:none; border:none; color:inherit; font-size:24px; cursor:pointer;">✕</button>
      </div>
      <div id="dashboard-items-grid" class="dashboard-body"></div>
      <div class="dashboard-footer">
        <span id="selected-count-label">0 项已选</span>
        <div class="footer-actions">
          <button id="dash-refresh-btn">重新扫描</button>
          <button id="dash-delete-btn" class="danger" disabled>开始批量删除</button>
        </div>
      </div>
      <div id="processing-mask" style="display:none; position:absolute; top:0; left:0; right:0; bottom:0; background:rgba(255,255,255,0.1); backdrop-filter:blur(2px); z-index:10; cursor:wait;"></div>
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

// 样式补丁
const style = document.createElement('style');
style.textContent = `
  .processing #processing-mask { display: block !important; }
  .processing #dashboard-items-grid { opacity: 0.5; pointer-events: none; }
`;
document.head.appendChild(style);

// 监听与初始启动
const observer = new MutationObserver(() => injectLauncher());
observer.observe(document.body, { childList: true, subtree: true });

setTimeout(() => {
  injectLauncher();
  initOverlay();
}, 1500);
