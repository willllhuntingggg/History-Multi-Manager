
/**
 * Global State
 */
let isDashboardOpen = false;
let scannedItems = []; 
let selectedIds = new Set();
let isDragging = false;
let startX = 0, startY = 0;
let dragBox = null;
let isProcessing = false;

const PLATFORM_CONFIG = {
  chatgpt: {
    linkSelector: 'a[href*="/c/"]',
    // 目标：找到侧边栏项目中的“三个点”操作按钮
    menuBtnSelector: 'button[aria-haspopup="menu"], [data-testid$="-options"], button:has(svg.lucide-ellipsis), .trailing-pair button',
  },
  gemini: {
    linkSelector: 'a[href*="/app/"]',
    menuBtnSelector: 'button[aria-haspopup="true"]',
  }
};

/**
 * 强力点击：模拟真实用户点击行为
 */
const hardClick = (el) => {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;

  const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY };
  
  // 模拟完整的交互链
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
    const ev = type.startsWith('pointer') 
      ? new PointerEvent(type, { ...opts, pointerId: 1, isPrimary: true })
      : new MouseEvent(type, opts);
    el.dispatchEvent(ev);
  });
};

/**
 * 在全局查找包含特定文字的可点击元素
 */
const findGlobalElementByText = (selector, texts) => {
  // 注意：菜单和弹窗通常直接挂在 body 下，不在 item 内部
  const elements = Array.from(document.querySelectorAll(selector));
  return elements.find(el => {
    const content = (el.innerText || el.textContent || "").toLowerCase();
    const isVisible = el.offsetParent !== null;
    return isVisible && texts.some(t => content.includes(t.toLowerCase()));
  });
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

  return results;
};

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
    card.onclick = () => {
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

/**
 * 核心批量删除逻辑
 */
const runBatchDelete = async () => {
  const idsToDelete = Array.from(selectedIds);
  if (!confirm(`确定要自动删除这 ${idsToDelete.length} 个对话吗？\n\n请在程序运行期间保持浏览器窗口置顶，不要操作鼠标。`)) return;

  isProcessing = true;
  const platform = getPlatform();
  const config = PLATFORM_CONFIG[platform];
  const overlay = document.getElementById('history-manager-overlay');
  
  // 保持弹窗显示但变淡，方便观察后台进度
  overlay.style.opacity = "0.3";
  overlay.style.pointerEvents = "none";

  for (let id of idsToDelete) {
    const item = scannedItems.find(it => it.id === id);
    if (!item) continue;

    // 重新在 DOM 中定位元素（防止页面刷新导致引用失效）
    const allLinks = Array.from(document.querySelectorAll(config.linkSelector));
    const targetLink = allLinks.find(l => l.getAttribute('href') === item.url);
    if (!targetLink) {
        console.warn(`跳过已不存在的项目: ${item.title}`);
        continue;
    }
    const row = targetLink.closest('li') || targetLink.closest('[role="listitem"]') || targetLink.parentElement;

    try {
      // 1. 滚动并悬停 (Hover)
      row.scrollIntoView({ block: 'center' });
      row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await new Promise(r => setTimeout(r, 600));

      // 2. 找到并点击“三个点”菜单按钮
      let menuBtn = row.querySelector(config.menuBtnSelector);
      if (!menuBtn) {
          // 备选方案：找 row 里面唯一的那个按钮
          menuBtn = row.querySelector('button');
      }
      
      if (menuBtn) {
        hardClick(menuBtn);
        await new Promise(r => setTimeout(r, 1000)); // 等待菜单弹出

        // 3. 在全局（Body）寻找“删除”按钮
        const deleteMenuItem = findGlobalElementByText('div[role="menuitem"], li[role="menuitem"], button, span', ['删除', 'Delete']);
        if (deleteMenuItem) {
          hardClick(deleteMenuItem);
          await new Promise(r => setTimeout(r, 1000)); // 等待确认弹窗

          // 4. 在全局寻找“确认删除”按钮
          const confirmBtn = findGlobalElementByText('button', ['确认', 'Confirm', '删除', 'Delete']);
          if (confirmBtn) {
            hardClick(confirmBtn);
            // 5. 等待系统删除动画和同步
            await new Promise(r => setTimeout(r, 2500)); 
            
            selectedIds.delete(id);
            scannedItems = scannedItems.filter(it => it.id !== id);
            renderDashboard();
            updateDashboardUI();
          }
        }
      }
      // 尝试清理可能卡住的菜单或弹窗
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } catch (err) {
      console.error("自动化执行出错:", err);
    }
  }

  overlay.style.opacity = "1";
  overlay.style.pointerEvents = "auto";
  isProcessing = false;
  updateDashboardUI();
  alert('批量删除任务执行完毕。');
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
          <p>选中对话，点击下方按钮开始自动化删除流程。</p>
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
