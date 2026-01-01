
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
    // 更多操作按钮通常在 a 标签同级的 div 中，或者是 a 的子元素
    menuBtnSelector: 'button[data-testid$="-options"], .trailing-pair button, [id^="radix-"]',
  },
  gemini: {
    linkSelector: 'a[href*="/app/"]',
    menuBtnSelector: 'button[aria-haspopup="true"]',
  }
};

/**
 * 强力真实点击模拟
 */
const hardClick = (el) => {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;

  const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY };
  
  const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
  events.forEach(evtType => {
    const e = evtType.startsWith('pointer') ? new PointerEvent(evtType, opts) : new MouseEvent(evtType, opts);
    e.stopPropagation();
    el.dispatchEvent(e);
  });
};

const findElementByText = (selector, texts) => {
  const elements = Array.from(document.querySelectorAll(selector));
  return elements.find(el => {
    const content = (el.innerText || el.textContent || "").toLowerCase().trim();
    return texts.some(t => content.includes(t.toLowerCase())) && el.offsetParent !== null;
  });
};

const getPlatform = () => {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
  if (host.includes('gemini.google.com')) return 'gemini';
  return null;
};

/**
 * 重构扫描逻辑：以链接为中心向外扩散
 */
const scanHistory = () => {
  const platform = getPlatform();
  if (!platform) return [];
  const config = PLATFORM_CONFIG[platform];
  
  // 查找所有对话链接
  const allLinks = Array.from(document.querySelectorAll(config.linkSelector));
  const results = [];
  const seenIds = new Set();

  allLinks.forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) return;

    // 提取 UUID。ChatGPT 格式通常是 /c/6914168f-7728...
    const uuidMatch = href.match(/\/c\/([a-z0-9\-]+)/i) || href.match(/\/app\/([a-z0-9\-]+)/i);
    const rawId = uuidMatch ? uuidMatch[1] : href;

    if (seenIds.has(rawId) || rawId === 'new') return;
    seenIds.add(rawId);

    // 向上寻找最接近的列表项容器 (li 或 role=listitem)
    const container = link.closest('li') || link.closest('[role="listitem"]') || link.parentElement;
    
    // 提取标题：优先找 .truncate，否则找链接内的文本
    const titleEl = container.querySelector('.truncate, .conversation-title') || link;
    const title = (titleEl.innerText || titleEl.textContent || "Untitled Chat").split('\n')[0].trim();

    results.push({
      id: `id-${rawId}`,
      title: title,
      url: href,
      originalElement: container
    });
  });

  console.log(`[Manager] 扫描完成，找到 ${results.length} 条记录`);
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
    container.innerHTML = `<div class="empty-state"><h3>未找到记录</h3><p>请确保侧边栏已展开且对话已加载。</p></div>`;
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
  const container = document.getElementById('dashboard-items-grid');
  if (!container) return;
  container.querySelectorAll('.chat-card').forEach(card => {
    card.classList.toggle('selected', selectedIds.has(card.getAttribute('data-id')));
  });
  document.getElementById('selected-count-label').innerText = `已选 ${selectedIds.size} 项`;
  document.getElementById('dash-delete-btn').disabled = selectedIds.size === 0 || isProcessing;
};

const runBatchDelete = async () => {
  const idsToDelete = Array.from(selectedIds);
  if (!confirm(`确定要执行批量删除操作吗？(${idsToDelete.length}项)`)) return;

  isProcessing = true;
  const platform = getPlatform();
  const config = PLATFORM_CONFIG[platform];
  const overlay = document.getElementById('history-manager-overlay');
  
  overlay.style.opacity = "0.2";
  overlay.style.pointerEvents = "none";

  for (let id of idsToDelete) {
    const item = scannedItems.find(it => it.id === id);
    if (!item || !document.body.contains(item.originalElement)) continue;

    console.log(`[Manager] 正在处理: ${item.title}`);
    try {
      const row = item.originalElement;
      row.scrollIntoView({ block: 'center' });
      row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await new Promise(r => setTimeout(r, 400));

      const menuBtn = row.querySelector(config.menuBtnSelector);
      if (menuBtn) {
        hardClick(menuBtn);
        await new Promise(r => setTimeout(r, 600));

        const deleteMenuItem = findElementByText('[role="menuitem"], .text-token-text-error, div, button', ['删除', 'Delete']);
        if (deleteMenuItem) {
          hardClick(deleteMenuItem);
          await new Promise(r => setTimeout(r, 600));

          const confirmBtn = findElementByText('button', ['删除', 'Delete', 'Confirm', '确认']);
          if (confirmBtn) {
            hardClick(confirmBtn);
            await new Promise(r => setTimeout(r, 2000));
            
            selectedIds.delete(id);
            scannedItems = scannedItems.filter(it => it.id !== id);
            renderDashboard();
            updateDashboardUI();
          } else {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          }
        } else {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }
      }
    } catch (err) {
      console.error("流程执行异常:", err);
    }
    await new Promise(r => setTimeout(r, 400));
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
          <h2>聊天记录管理</h2>
          <p>选中记录并点击右下角按钮执行批量操作。</p>
        </div>
        <button id="close-dash-btn">✕</button>
      </div>
      <div id="dashboard-items-grid" class="dashboard-body"></div>
      <div class="dashboard-footer">
        <span id="selected-count-label">0 项已选</span>
        <div class="footer-actions">
          <button id="dash-refresh-btn">重新扫描</button>
          <button id="dash-delete-btn" class="danger" disabled>确认批量删除</button>
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
  
  const btn = document.createElement('button');
  btn.id = 'history-manager-launcher';
  btn.style.cssText = `
    position: fixed; bottom: 20px; left: 20px; width: 140px; 
    z-index: 999999; background: #4f46e5; color: white; border: none;
    border-radius: 50px; padding: 10px 15px; font-weight: bold;
    box-shadow: 0 4px 15px rgba(0,0,0,0.4); cursor: pointer;
    font-family: sans-serif;
  `;
  btn.innerHTML = `⚡ 批量管理`;
  btn.onclick = toggleDashboard;
  document.body.appendChild(btn);
};

const observer = new MutationObserver(() => { injectLauncher(); initOverlay(); });
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(() => { injectLauncher(); initOverlay(); }, 1500);
