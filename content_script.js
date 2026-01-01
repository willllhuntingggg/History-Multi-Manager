
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

// 平台配置：侧边栏定位
const PLATFORM_CONFIG = {
  chatgpt: {
    container: 'nav, [role="navigation"]',
    itemSelector: '#history a[href*="/c/"], nav a[href*="/c/"]',
    // 更多按钮 (...) 的相对路径
    menuBtnSelector: '.trailing-pair > div:nth-child(2), .trailing, [data-testid$="-options"]',
  },
  gemini: {
    container: 'nav',
    itemSelector: 'div[role="listitem"]:has(a[href*="/app/"])',
    menuBtnSelector: 'button[aria-haspopup="true"]',
  }
};

/**
 * 核心：真实点击模拟
 */
const simulateClick = (el) => {
  if (!el) return;
  const opts = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.click();
};

/**
 * 核心：按文本查找元素
 * @param {string} selector 基础选择器
 * @param {string[]} texts 包含的文本数组
 */
const findElementByText = (selector, texts) => {
  const elements = Array.from(document.querySelectorAll(selector));
  return elements.find(el => {
    const content = el.innerText || el.textContent || "";
    return texts.some(t => content.includes(t)) && el.offsetParent !== null;
  });
};

const getPlatform = () => {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
  if (host.includes('gemini.google.com')) return 'gemini';
  return null;
};

const scanHistory = () => {
  const platform = getPlatform();
  if (!platform) return [];
  const config = PLATFORM_CONFIG[platform];
  const items = Array.from(document.querySelectorAll(config.itemSelector));
  const results = [];

  items.forEach((el) => {
    const title = el.innerText.split('\n')[0].trim() || "Untitled";
    const url = el.getAttribute('href');
    if (!url) return;
    const id = `id-${url.split('/').pop()}`;
    if (!results.some(r => r.id === id)) {
      results.push({ id, title, url, originalElement: el });
    }
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
    document.body.style.overflow = 'hidden';
  } else {
    overlay.style.display = 'none';
    document.body.style.overflow = '';
  }
};

const renderDashboard = () => {
  const container = document.getElementById('dashboard-items-grid');
  if (!container) return;
  if (scannedItems.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>未找到聊天记录</h3><p>请确保侧边栏已展开并滚动加载。</p></div>`;
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
      const id = card.getAttribute('data-id');
      if (selectedIds.has(id)) selectedIds.delete(id);
      else selectedIds.add(id);
      updateDashboardUI();
    };
  });
};

const updateDashboardUI = () => {
  const container = document.getElementById('dashboard-items-grid');
  if (!container) return;
  container.querySelectorAll('.chat-card').forEach(card => {
    card.classList.toggle('selected', selectedIds.has(card.getAttribute('data-id')));
  });
  document.getElementById('selected-count-label').innerText = `已选 ${selectedIds.size} 项`;
  document.getElementById('dash-delete-btn').disabled = selectedIds.size === 0 || isProcessing;
};

/**
 * 批量删除逻辑 - 严格遵循用户步骤
 */
const runBatchDelete = async () => {
  const idsToDelete = Array.from(selectedIds);
  if (!confirm(`确定要删除这 ${idsToDelete.length} 条记录吗？`)) return;

  isProcessing = true;
  const platform = getPlatform();
  const config = PLATFORM_CONFIG[platform];
  const overlay = document.getElementById('history-manager-overlay');
  
  // 暂时隐藏面板以便观察底层操作或防止阻挡
  overlay.style.opacity = "0.2";
  overlay.style.pointerEvents = "none";

  for (let id of idsToDelete) {
    const item = scannedItems.find(it => it.id === id);
    if (!item) continue;

    console.log(`正在处理: ${item.title}`);
    try {
      const row = item.originalElement;
      
      // 步骤1: 滚动到视野并点击 ... 按钮
      row.scrollIntoView({ block: 'center' });
      row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));

      const menuBtn = row.querySelector(config.menuBtnSelector);
      if (menuBtn) {
        simulateClick(menuBtn);
        
        // 步骤2: 等待 500ms (等待菜单弹出)
        await new Promise(r => setTimeout(r, 600));

        // 步骤3: 找到并点击文本为 '删除' 或 'Delete' 的菜单项
        // 优先尝试 [role="menuitem"]，如果没有则全网页搜索
        const deleteItem = findElementByText('[role="menuitem"], div, button', ['删除', 'Delete']);
        if (deleteItem) {
          simulateClick(deleteItem);

          // 步骤4: 等待 500ms (等待确认框)
          await new Promise(r => setTimeout(r, 600));

          // 步骤5: 点击包含 '删除' 或 'Delete' 的确认按钮
          const confirmBtn = findElementByText('button', ['删除', 'Delete', 'Confirm']);
          if (confirmBtn) {
            simulateClick(confirmBtn);
            // 等待系统处理删除
            await new Promise(r => setTimeout(r, 1200));
            
            // 成功后更新本地状态
            selectedIds.delete(id);
            scannedItems = scannedItems.filter(it => it.id !== id);
            renderDashboard();
            updateDashboardUI();
          } else {
            console.warn("找不到确认按钮");
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
          }
        } else {
          console.warn("找不到删除菜单项");
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        }
      } else {
        console.warn("找不到更多按钮(...)");
      }
    } catch (err) {
      console.error("处理出错:", err);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  overlay.style.opacity = "1";
  overlay.style.pointerEvents = "auto";
  isProcessing = false;
  updateDashboardUI();
  alert('批量删除任务已结束。');
};

const initOverlay = () => {
  if (document.getElementById('history-manager-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'history-manager-overlay';
  overlay.innerHTML = `
    <div class="dashboard-window">
      <div class="dashboard-header">
        <div class="header-info">
          <h2>历史记录批量管理</h2>
          <p>划选或点击卡片，然后执行批量删除。</p>
        </div>
        <button id="close-dash-btn">✕</button>
      </div>
      <div id="dashboard-items-grid" class="dashboard-body"></div>
      <div class="dashboard-footer">
        <span id="selected-count-label">0 Selected</span>
        <div class="footer-actions">
          <button id="dash-refresh-btn">刷新列表</button>
          <button id="dash-delete-btn" class="danger" disabled>批量删除</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('close-dash-btn').onclick = toggleDashboard;
  document.getElementById('dash-refresh-btn').onclick = () => { scannedItems = scanHistory(); renderDashboard(); };
  document.getElementById('dash-delete-btn').onclick = runBatchDelete;

  const grid = document.getElementById('dashboard-items-grid');
  grid.onmousedown = (e) => {
    if (isProcessing || e.target.closest('.chat-card')) return;
    isDragging = true; startX = e.clientX; startY = e.clientY;
    dragBox = document.createElement('div');
    dragBox.className = 'dashboard-drag-box';
    document.body.appendChild(dragBox);
  };
  window.onmousemove = (e) => {
    if (!isDragging || !dragBox) return;
    const l = Math.min(startX, e.clientX), t = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);
    dragBox.style.left = `${l}px`; dragBox.style.top = `${t}px`;
    dragBox.style.width = `${w}px`; dragBox.style.height = `${h}px`;
    grid.querySelectorAll('.chat-card').forEach(card => {
      const r = card.getBoundingClientRect();
      if (!(r.right < l || r.left > l+w || r.bottom < t || r.top > t+h)) selectedIds.add(card.getAttribute('data-id'));
    });
    updateDashboardUI();
  };
  window.onmouseup = () => { isDragging = false; dragBox?.remove(); dragBox = null; };
};

const injectLauncher = () => {
  const platform = getPlatform();
  if (!platform || document.getElementById('history-manager-launcher')) return;
  const nav = document.querySelector(PLATFORM_CONFIG[platform].container);
  if (nav) {
    const btn = document.createElement('button');
    btn.id = 'history-manager-launcher';
    btn.innerHTML = `<span>⚡ 批量管理</span>`;
    btn.onclick = toggleDashboard;
    nav.prepend(btn);
  }
};

const observer = new MutationObserver(() => { injectLauncher(); initOverlay(); });
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(() => { injectLauncher(); initOverlay(); }, 1500);
