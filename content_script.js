
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
    item: 'li[data-testid^="history-item-"]',
    title: 'div.flex-1.truncate',
    container: 'nav',
    menuBtn: 'button[id^="radix-"]',
    deleteBtnText: 'delete'
  },
  gemini: {
    item: 'div[role="listitem"]',
    title: '.conversation-title',
    container: 'nav',
    menuBtn: 'button[aria-haspopup="true"]',
    deleteBtnText: 'delete'
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
    const id = item.innerText.trim().substring(0, 50);
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
    if (deleteBtn) deleteBtn.disabled = selectedItems.size === 0;
  }
};

const injectToolbar = () => {
  if (toolbarContainer) return;
  toolbarContainer = document.createElement('div');
  toolbarContainer.className = 'batch-toolbar-container fixed bottom-8 left-1/2 -translate-x-1/2 z-[99999]';
  toolbarContainer.innerHTML = `
    <div style="background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(8px); color: white; border-radius: 999px; padding: 12px 24px; display: flex; align-items: center; gap: 24px; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1);">
      <div style="display: flex; flex-direction: column;">
        <span id="selected-count" style="font-weight: 700; font-size: 14px;">0 Selected</span>
        <span style="font-size: 10px; color: #94a3b8;">Multi-Select Mode</span>
      </div>
      <div style="width: 1px; height: 32px; background: rgba(255,255,255,0.1);"></div>
      <div style="display: flex; gap: 12px;">
        <button id="batch-delete-btn" disabled style="background: #ef4444; color: white; padding: 6px 16px; border-radius: 999px; font-size: 13px; font-weight: 600; cursor: pointer; border: none;">Delete</button>
        <button id="cancel-batch-btn" style="background: #475569; color: white; padding: 6px 16px; border-radius: 999px; font-size: 13px; font-weight: 600; cursor: pointer; border: none;">Exit</button>
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
  if (!confirm(`Delete ${count} selected chats? This cannot be undone.`)) return;

  const platform = getPlatform();
  const items = Array.from(selectedItems.values());
  
  for (const item of items) {
    try {
      const menuBtn = item.querySelector(PLATFORM_CONFIG[platform].menuBtn);
      if (menuBtn) {
        menuBtn.click();
        await new Promise(r => setTimeout(r, 500));
        
        const menuItems = document.querySelectorAll('[role="menuitem"], li[role="menuitem"]');
        for (const m of Array.from(menuItems)) {
          if (m.innerText.toLowerCase().includes('delete')) {
            m.click();
            await new Promise(r => setTimeout(r, 500));
            const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.toLowerCase().includes('delete'));
            if (confirmBtn) confirmBtn.click();
            break;
          }
        }
      }
      selectedItems.delete(item.innerText.trim().substring(0, 50));
      updateSelectionUI();
      await new Promise(r => setTimeout(r, 600));
    } catch (e) {
      console.error('Delete failed for item', e);
    }
  }
};

const initDragEvents = () => {
  window.addEventListener('mousedown', (e) => {
    if (!isMultiSelectActive || toolbarContainer?.contains(e.target)) return;
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
    const left = Math.min(startX, e.clientX);
    const top = Math.min(startY, e.clientY);
    const width = Math.abs(e.clientX - startX);
    const height = Math.abs(e.clientY - startY);

    dragBox.style.left = `${left}px`;
    dragBox.style.top = `${top}px`;
    dragBox.style.width = `${width}px`;
    dragBox.style.height = `${height}px`;

    const platform = getPlatform();
    if (!platform) return;

    document.querySelectorAll(PLATFORM_CONFIG[platform].item).forEach(el => {
      const rect = el.getBoundingClientRect();
      const intersects = !(rect.right < left || rect.left > left + width || rect.bottom < top || rect.top > top + height);
      if (intersects) {
        const id = el.innerText.trim().substring(0, 50);
        selectedItems.set(id, el);
      }
    });
    updateSelectionUI();
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
    if (dragBox) { dragBox.remove(); dragBox = null; }
  });

  window.addEventListener('click', (e) => {
    if (!isMultiSelectActive) return;
    const platform = getPlatform();
    if (!platform) return;
    const itemEl = e.target.closest(PLATFORM_CONFIG[platform].item);
    if (itemEl) {
      const id = itemEl.innerText.trim().substring(0, 50);
      if (selectedItems.has(id)) selectedItems.delete(id);
      else selectedItems.set(id, itemEl);
      e.preventDefault(); e.stopPropagation();
      updateSelectionUI();
    }
  }, true);
};

const injectModeButton = () => {
  const platform = getPlatform();
  if (!platform) return;
  if (document.getElementById('history-manager-toggle')) return;

  const btn = document.createElement('button');
  btn.id = 'history-manager-toggle';
  btn.style.cssText = `
    width: 100%; margin: 10px 0; padding: 10px; border-radius: 8px; border: 1px solid rgba(79, 70, 229, 0.3);
    background: rgba(79, 70, 229, 0.1); color: #4f46e5; font-size: 12px; font-weight: 700; cursor: pointer;
    display: flex; justify-content: space-between; transition: all 0.2s;
  `;
  btn.innerHTML = `<span>History Manager</span><span class="status-text" style="background: rgba(0,0,0,0.1); padding: 2px 6px; border-radius: 4px;">OFF</span>`;
  btn.onclick = toggleMultiSelectMode;

  const container = document.querySelector(PLATFORM_CONFIG[platform].container);
  if (container) container.prepend(btn);
};

const observer = new MutationObserver(injectModeButton);
observer.observe(document.body, { childList: true, subtree: true });

initDragEvents();
