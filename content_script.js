
/**
 * Global State
 */
let isMultiSelectActive = false;
let selectedItems = new Map();
let isDragging = false;
let startX = 0;
let startY = 0;
let dragBox = null;
let toolbarContainer = null;

const PLATFORM_CONFIG = {
  chatgpt: {
    // 适配 ChatGPT 列表条目
    item: 'li:has(a[href^="/c/"]), li[data-testid^="history-item-"]',
    container: 'nav',
    menuBtn: 'button[id^="radix-"], button[aria-haspopup="menu"]',
  },
  gemini: {
    // 适配 Gemini 列表条目
    item: 'div[role="listitem"], a.conversation-container',
    container: 'nav',
    menuBtn: 'button[aria-haspopup="true"]',
  }
};

const getPlatform = () => {
  const host = window.location.hostname;
  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
  if (host.includes('gemini.google.com')) return 'gemini';
  return null;
};

const toggleMultiSelectMode = () => {
  isMultiSelectActive = !isMultiSelectActive;
  
  const toggleBtn = document.getElementById('history-manager-toggle');
  if (toggleBtn) {
    toggleBtn.style.background = isMultiSelectActive ? '#4f46e5' : 'rgba(79, 70, 229, 0.1)';
    toggleBtn.style.color = isMultiSelectActive ? '#ffffff' : '#4f46e5';
    toggleBtn.querySelector('.status-text').textContent = isMultiSelectActive ? 'ON' : 'OFF';
  }

  // 为列表容器添加/移除模式类，以便通过 CSS 控制悬停效果
  const platform = getPlatform();
  const nav = document.querySelector(PLATFORM_CONFIG[platform]?.container || 'nav');
  if (nav) {
    if (isMultiSelectActive) nav.classList.add('manager-active');
    else nav.classList.remove('manager-active');
  }

  if (!isMultiSelectActive) {
    selectedItems.clear();
    removeToolbar();
    document.body.style.cursor = 'default';
  } else {
    injectToolbar();
    document.body.style.cursor = 'crosshair';
  }
  updateSelectionUI();
};

const updateSelectionUI = () => {
  const platform = getPlatform();
  if (!platform) return;

  const items = document.querySelectorAll(PLATFORM_CONFIG[platform].item);
  items.forEach((item) => {
    // 使用条目的文本内容或特定属性作为唯一标识
    const id = item.innerText.trim().substring(0, 100);
    if (selectedItems.has(id)) {
      item.classList.add('history-item-selecting');
    } else {
      item.classList.remove('history-item-selecting');
    }
  });

  if (toolbarContainer) {
    const countEl = toolbarContainer.querySelector('#selected-count');
    if (countEl) countEl.textContent = `${selectedItems.size} Selected`;
    const deleteBtn = toolbarContainer.querySelector('#batch-delete-btn');
    if (deleteBtn) {
      deleteBtn.disabled = selectedItems.size === 0;
      deleteBtn.style.opacity = selectedItems.size === 0 ? '0.5' : '1';
    }
  }
};

const injectToolbar = () => {
  if (toolbarContainer) return;
  toolbarContainer = document.createElement('div');
  toolbarContainer.className = 'batch-toolbar-container fixed bottom-8 left-1/2 -translate-x-1/2 z-[99999]';
  toolbarContainer.innerHTML = `
    <div style="background: #1e293b; color: white; border-radius: 16px; padding: 12px 24px; display: flex; align-items: center; gap: 24px; border: 1px solid #334155; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.5);">
      <div style="display: flex; flex-direction: column;">
        <span id="selected-count" style="font-weight: 700; font-size: 14px;">0 Selected</span>
        <span style="font-size: 11px; color: #94a3b8;">🖱️ Click or Drag list items to select</span>
      </div>
      <div style="width: 1px; height: 32px; background: #334155;"></div>
      <div style="display: flex; gap: 10px;">
        <button id="batch-delete-btn" disabled style="background: #ef4444; color: white; padding: 8px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; transition: all 0.2s;">Delete</button>
        <button id="cancel-batch-btn" style="background: #475569; color: white; padding: 8px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none;">Exit</button>
      </div>
    </div>
  `;
  document.body.appendChild(toolbarContainer);
  toolbarContainer.querySelector('#batch-delete-btn').addEventListener('click', startBatchDelete);
  toolbarContainer.querySelector('#cancel-batch-btn').addEventListener('click', toggleMultiSelectMode);
};

const removeToolbar = () => {
  if (toolbarContainer) {
    toolbarContainer.remove();
    toolbarContainer = null;
  }
};

const startBatchDelete = async () => {
  const count = selectedItems.size;
  if (!confirm(`Confirm batch deletion of ${count} chats? This simulation will attempt to click the UI menus.`)) return;

  const platform = getPlatform();
  const items = Array.from(selectedItems.values());
  
  for (const item of items) {
    try {
      // 这里的逻辑依赖于平台 UI，如果 UI 变动可能失效，但作为插件演示是核心流程
      const menuBtn = item.querySelector(PLATFORM_CONFIG[platform].menuBtn);
      if (menuBtn) {
        menuBtn.click();
        await new Promise(r => setTimeout(r, 600));
        
        const menuItems = document.querySelectorAll('[role="menuitem"], li[role="menuitem"], .flex.items-center.gap-2.p-3');
        for (const m of Array.from(menuItems)) {
          if (m.innerText.toLowerCase().includes('delete')) {
            m.click();
            await new Promise(r => setTimeout(r, 600));
            const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.toLowerCase().includes('delete'));
            if (confirmBtn) confirmBtn.click();
            break;
          }
        }
      }
      const id = item.innerText.trim().substring(0, 100);
      selectedItems.delete(id);
      updateSelectionUI();
      await new Promise(r => setTimeout(r, 800));
    } catch (e) {
      console.error('Delete process failed for an item', e);
    }
  }
};

const initDragEvents = () => {
  window.addEventListener('mousedown', (e) => {
    if (!isMultiSelectActive) return;
    // 如果点击的是工具栏或按钮，不触发拖拽
    if (toolbarContainer?.contains(e.target) || document.getElementById('history-manager-toggle')?.contains(e.target)) return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    if (!dragBox) {
      dragBox = document.createElement('div');
      dragBox.id = 'multi-select-drag-box';
      document.body.appendChild(dragBox);
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging || !dragBox) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    dragBox.style.left = `${left}px`;
    dragBox.style.top = `${top}px`;
    dragBox.style.width = `${width}px`;
    dragBox.style.height = `${height}px`;

    const platform = getPlatform();
    if (!platform) return;

    const items = document.querySelectorAll(PLATFORM_CONFIG[platform].item);
    items.forEach((item) => {
      const rect = item.getBoundingClientRect();
      const intersects = !(
        rect.right < left ||
        rect.left > left + width ||
        rect.bottom < top ||
        rect.top > top + height
      );

      if (intersects) {
        const id = item.innerText.trim().substring(0, 100);
        selectedItems.set(id, item);
      }
    });
    updateSelectionUI();
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
    if (dragBox) {
      dragBox.remove();
      dragBox = null;
    }
  });

  // 处理单击选择
  window.addEventListener('click', (e) => {
    if (!isMultiSelectActive) return;
    
    const platform = getPlatform();
    if (!platform) return;

    // 检查是否点击了历史记录条目
    const itemEl = e.target.closest(PLATFORM_CONFIG[platform].item);
    if (itemEl) {
      const id = itemEl.innerText.trim().substring(0, 100);
      if (selectedItems.has(id)) {
        selectedItems.delete(id);
      } else {
        selectedItems.set(id, itemEl);
      }
      e.preventDefault();
      e.stopPropagation();
      updateSelectionUI();
    }
  }, true); // 使用捕获模式，确保在页面原生跳转逻辑前拦截
};

const injectModeButton = () => {
  const platform = getPlatform();
  if (!platform) return;
  if (document.getElementById('history-manager-toggle')) return;

  const btn = document.createElement('button');
  btn.id = 'history-manager-toggle';
  btn.style.cssText = `
    width: calc(100% - 16px); margin: 8px; padding: 12px; border-radius: 12px; border: 1px solid rgba(79, 70, 229, 0.4);
    background: rgba(79, 70, 229, 0.1); color: #4f46e5; font-size: 13px; font-weight: 700; cursor: pointer;
    display: flex; justify-content: space-between; align-items: center; transition: all 0.2s; z-index: 1000;
  `;
  btn.innerHTML = `
    <span style="display: flex; align-items: center; gap: 8px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4m-2 6v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2h9" /></svg>
      Multi-Select
    </span>
    <span class="status-text" style="background: rgba(0,0,0,0.1); padding: 2px 8px; border-radius: 6px; font-size: 11px;">OFF</span>
  `;
  btn.onclick = toggleMultiSelectMode;

  const container = document.querySelector(PLATFORM_CONFIG[platform].container);
  if (container) {
    container.prepend(btn);
  }
};

// 监听 DOM 变化以便重新注入按钮
const observer = new MutationObserver(injectModeButton);
observer.observe(document.body, { childList: true, subtree: true });

// 初始化
initDragEvents();
console.log('Chat History Multi-Manager: Content Script Loaded.');
