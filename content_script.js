
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
    container: 'nav',
    // 选中包含链接的 li 容器，而不是 a 标签本身
    itemSelector: 'nav li:has(a[href*="/c/"]), #history li:has(a[href*="/c/"])',
    linkSelector: 'a[href*="/c/"]',
    menuBtnSelector: 'button[data-testid$="-options"], .trailing-pair button, [id^="radix-"]',
  },
  gemini: {
    container: 'nav',
    itemSelector: 'div[role="listitem"]:has(a[href*="/app/"])',
    linkSelector: 'a[href*="/app/"]',
    menuBtnSelector: 'button[aria-haspopup="true"]',
  }
};

/**
 * 强力真实点击模拟
 * 增加 stopPropagation 防止事件向上冒泡到 a 标签导致页面跳转
 */
const hardClick = (el) => {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;

  const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY };
  
  // 核心：手动触发一系列事件并尝试拦截冒泡
  const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
  events.forEach(evtType => {
    const e = evtType.startsWith('pointer') ? new PointerEvent(evtType, opts) : new MouseEvent(evtType, opts);
    // 强制停止冒泡，防止触发父级 a 标签的跳转
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

const scanHistory = () => {
  const platform = getPlatform();
  if (!platform) return [];
  const config = PLATFORM_CONFIG[platform];
  
  // 兼容不支持 :has 的情况
  let items = Array.from(document.querySelectorAll(config.itemSelector));
  if (items.length === 0) {
    // 备用方案：找到 a 标签然后往上找 li
    items = Array.from(document.querySelectorAll(config.linkSelector))
      .map(a => a.closest('li') || a.parentElement)
      .filter(el => el);
  }

  const results = [];
  items.forEach((el) => {
    const link = el.querySelector(config.linkSelector);
    if (!link) return;
    
    const title = el.innerText.split('\n')[0].trim() || "Untitled Chat";
    const url = link.getAttribute('href');
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
    container.innerHTML = `<div class="empty-state"><h3>未找到记录</h3><p>请确保侧边栏已展开。</p></div>`;
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
 * 核心批量删除：严格执行物理点击流
 */
const runBatchDelete = async () => {
  const idsToDelete = Array.from(selectedIds);
  if (!confirm(`确定要执行批量删除操作吗？(${idsToDelete.length}项)`)) return;

  isProcessing = true;
  const platform = getPlatform();
  const config = PLATFORM_CONFIG[platform];
  const overlay = document.getElementById('history-manager-overlay');
  
  // 面板半透明化，防止遮挡底层可能的 UI 反馈
  overlay.style.opacity = "0.2";
  overlay.style.pointerEvents = "none";

  for (let id of idsToDelete) {
    const item = scannedItems.find(it => it.id === id);
    if (!item || !document.body.contains(item.originalElement)) continue;

    console.log(`[Manager] 准备删除: ${item.title}`);
    try {
      const container = item.originalElement;
      
      // 1. 滚动到中心并触发 Hover (ChatGPT 的按钮是悬浮可见的)
      container.scrollIntoView({ block: 'center' });
      container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      container.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      
      // 等待按钮渲染
      await new Promise(r => setTimeout(r, 400));

      // 2. 找到并点击 "更多" 按钮 (...)
      const menuBtn = container.querySelector(config.menuBtnSelector);
      if (menuBtn) {
        console.log("-> 点击更多按钮");
        hardClick(menuBtn);
        
        // 等待菜单弹出
        await new Promise(r => setTimeout(r, 600));

        // 3. 全局搜索并点击 "删除" 菜单项
        const deleteMenuItem = findElementByText('[role="menuitem"], .text-token-text-error, div, button', ['删除', 'Delete']);
        if (deleteMenuItem) {
          console.log("-> 点击菜单删除项");
          hardClick(deleteMenuItem);

          // 等待确认弹窗
          await new Promise(r => setTimeout(r, 600));

          // 4. 全局搜索并点击确认对话框中的 "删除" 按钮
          const confirmBtn = findElementByText('button', ['删除', 'Delete', 'Confirm', '确认']);
          if (confirmBtn) {
            console.log("-> 点击二次确认按钮");
            hardClick(confirmBtn);
            
            // 每一个删除动作后增加较长的缓冲时间，防止 ChatGPT 频率限制或 UI 刷新冲突
            await new Promise(r => setTimeout(r, 1800));
            
            selectedIds.delete(id);
            scannedItems = scannedItems.filter(it => it.id !== id);
            renderDashboard();
            updateDashboardUI();
          } else {
            console.warn("未能找到确认按钮，尝试关闭弹窗");
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          }
        } else {
          console.warn("未能找到删除菜单项");
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }
      } else {
        console.error("未能找到更多(...)按钮，请检查记录是否可见");
      }
    } catch (err) {
      console.error("流程执行异常:", err);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  overlay.style.opacity = "1";
  overlay.style.pointerEvents = "auto";
  isProcessing = false;
  updateDashboardUI();
  alert('批量操作已结束。');
};

const initOverlay = () => {
  if (document.getElementById('history-manager-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'history-manager-overlay';
  overlay.innerHTML = `
    <div class="dashboard-window">
      <div class="dashboard-header">
        <div class="header-info">
          <h2>聊天记录批量管理</h2>
          <p>操作进行时请勿切换页面或关闭侧边栏。</p>
        </div>
        <button id="close-dash-btn">✕</button>
      </div>
      <div id="dashboard-items-grid" class="dashboard-body"></div>
      <div class="dashboard-footer">
        <span id="selected-count-label">0 项已选</span>
        <div class="footer-actions">
          <button id="dash-refresh-btn">重新扫描</button>
          <button id="dash-delete-btn" class="danger" disabled>确认删除</button>
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
    z-index: 99999; background: #4f46e5; color: white; border: none;
    border-radius: 50px; padding: 10px 15px; font-weight: bold;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3); cursor: pointer;
  `;
  btn.innerHTML = `⚡ 批量管理`;
  btn.onclick = toggleDashboard;
  document.body.appendChild(btn);
};

const observer = new MutationObserver(() => { injectLauncher(); initOverlay(); });
observer.observe(document.body, { childList: true, subtree: true });
setTimeout(() => { injectLauncher(); initOverlay(); }, 1500);
