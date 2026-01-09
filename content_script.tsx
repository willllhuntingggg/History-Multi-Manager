
import { GoogleGenAI, Type } from "@google/genai";

/**
 * Types & Interfaces
 */
interface HistoryItem {
  id: string;
  element: HTMLElement;
  title: string;
}

/**
 * Global State
 */
let isMultiSelectActive = false;
let selectedItems = new Map<string, HistoryItem>();
let isDragging = false;
let startX = 0;
let startY = 0;
let dragBox: HTMLDivElement | null = null;
let toolbarContainer: HTMLDivElement | null = null;

/**
 * Selectors for different platforms
 */
const SELECTORS = {
  chatgpt: {
    item: 'li[data-testid^="history-item-"]',
    title: '.truncate',
    container: 'nav',
    menuButton: '[id^="radix-"]', // This is usually the ... button
    deleteButton: 'div[role="menuitem"]', // This is found in the popup menu
  },
  gemini: {
    item: 'div[role="listitem"]',
    title: '.conversation-title',
    container: 'nav',
    menuButton: 'button[aria-haspopup="true"]',
    deleteButton: 'li[role="menuitem"]'
  }
};

/**
 * Platform Detection
 */
const getPlatform = () => {
  const host = window.location.hostname;
  if (host.includes('chat.openai.com') || host.includes('chatgpt.com')) return 'chatgpt';
  if (host.includes('gemini.google.com')) return 'gemini';
  return null;
};

/**
 * Logic to toggle multi-select mode
 */
const toggleMultiSelectMode = () => {
  isMultiSelectActive = !isMultiSelectActive;
  
  if (!isMultiSelectActive) {
    clearSelection();
    removeToolbar();
    document.body.style.cursor = 'default';
  } else {
    injectToolbar();
    document.body.style.cursor = 'crosshair';
  }

  updateSelectionUI();
};

const clearSelection = () => {
  selectedItems.clear();
  updateSelectionUI();
};

const updateSelectionUI = () => {
  const platform = getPlatform();
  if (!platform) return;

  const items = document.querySelectorAll(SELECTORS[platform].item);
  items.forEach((item) => {
    const el = item as HTMLElement;
    const id = getElementId(el);
    if (selectedItems.has(id)) {
      el.classList.add('history-item-selecting');
    } else {
      el.classList.remove('history-item-selecting');
    }
  });

  if (toolbarContainer) {
    const countEl = toolbarContainer.querySelector('#selected-count');
    if (countEl) countEl.textContent = `${selectedItems.size} Selected`;
    
    const deleteBtn = toolbarContainer.querySelector('#batch-delete-btn') as HTMLButtonElement;
    if (deleteBtn) deleteBtn.disabled = selectedItems.size === 0;
  }
};

const getElementId = (el: HTMLElement) => {
  // Try to find a unique ID
  return el.getAttribute('data-testid') || el.innerText.substring(0, 20);
};

/**
 * Batch Deletion Logic
 * Warning: This interacts with the UI and is somewhat platform-fragile.
 * It simulates sequential clicks to trigger deletion.
 */
const startBatchDelete = async () => {
  const count = selectedItems.size;
  if (!confirm(`Are you sure you want to delete ${count} items?`)) return;

  const items = Array.from(selectedItems.values());
  for (const item of items) {
    try {
      // Platform specific deletion automation
      await deleteSingleItem(item.element);
      selectedItems.delete(item.id);
      updateSelectionUI();
      // Delay to allow UI to catch up
      await new Promise(r => setTimeout(r, 800));
    } catch (e) {
      console.error('Failed to delete item', item.title, e);
    }
  }
  
  alert('Batch operation completed.');
};

const deleteSingleItem = async (el: HTMLElement) => {
  const platform = getPlatform();
  if (!platform) return;

  // 1. Trigger the context menu
  const menuBtn = el.querySelector(SELECTORS[platform].menuButton) as HTMLElement;
  if (menuBtn) {
    menuBtn.click();
    await new Promise(r => setTimeout(r, 400));
    
    // 2. Find Delete button in menu
    const menuItems = document.querySelectorAll('div[role="menuitem"], li[role="menuitem"]');
    for (const m of Array.from(menuItems)) {
      const text = (m as HTMLElement).innerText.toLowerCase();
      if (text.includes('delete')) {
        (m as HTMLElement).click();
        await new Promise(r => setTimeout(r, 400));
        
        // 3. Confirm Delete (Modal)
        const buttons = document.querySelectorAll('button');
        for (const b of Array.from(buttons)) {
          if (b.innerText.toLowerCase().includes('delete')) {
            b.click();
            break;
          }
        }
        break;
      }
    }
  }
};

/**
 * UI Injection
 */
const injectToolbar = () => {
  if (toolbarContainer) return;

  toolbarContainer = document.createElement('div');
  toolbarContainer.className = 'batch-toolbar-container fixed bottom-8 left-1/2 -translate-x-1/2 z-[10000]';
  
  toolbarContainer.innerHTML = `
    <div class="bg-slate-900/95 backdrop-blur-md text-white rounded-full px-6 py-3 shadow-2xl flex items-center gap-6 border border-slate-700/50">
      <div class="flex flex-col">
        <span id="selected-count" class="text-sm font-bold">0 Selected</span>
        <span class="text-[10px] text-slate-400">Multi-Select Active</span>
      </div>
      
      <div class="w-px h-8 bg-slate-700"></div>
      
      <div class="flex items-center gap-3">
        <button id="batch-ai-btn" class="text-sm px-4 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 transition-colors flex items-center gap-2">
           <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
           Group by Gemini
        </button>
        
        <button id="batch-delete-btn" disabled class="text-sm px-4 py-1.5 rounded-full bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          Delete Selected
        </button>
        
        <button id="cancel-batch-btn" class="text-sm px-4 py-1.5 rounded-full bg-slate-700 hover:bg-slate-600 transition-colors">
          Exit
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(toolbarContainer);

  toolbarContainer.querySelector('#batch-delete-btn')?.addEventListener('click', startBatchDelete);
  toolbarContainer.querySelector('#cancel-batch-btn')?.addEventListener('click', toggleMultiSelectMode);
  toolbarContainer.querySelector('#batch-ai-btn')?.addEventListener('click', () => {
    alert('This would use Gemini API to analyze titles and suggest folders/categories for your selected chats.');
  });
};

const removeToolbar = () => {
  if (toolbarContainer) {
    toolbarContainer.remove();
    toolbarContainer = null;
  }
};

/**
 * Drag to select logic
 */
const initDragEvents = () => {
  window.addEventListener('mousedown', (e) => {
    if (!isMultiSelectActive) return;
    if (toolbarContainer?.contains(e.target as Node)) return;

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

    // Check intersection with items
    const platform = getPlatform();
    if (!platform) return;

    const items = document.querySelectorAll(SELECTORS[platform].item);
    items.forEach((item) => {
      const el = item as HTMLElement;
      const rect = el.getBoundingClientRect();
      const id = getElementId(el);

      const intersects = !(
        rect.right < left ||
        rect.left > left + width ||
        rect.bottom < top ||
        rect.top > top + height
      );

      if (intersects) {
        if (!selectedItems.has(id)) {
          selectedItems.set(id, {
            id,
            element: el,
            title: (el.querySelector(SELECTORS[platform].title) as HTMLElement)?.innerText || 'Untitled'
          });
        }
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

  // Single click selection
  window.addEventListener('click', (e) => {
    if (!isMultiSelectActive) return;
    
    const platform = getPlatform();
    if (!platform) return;

    const itemEl = (e.target as HTMLElement).closest(SELECTORS[platform].item) as HTMLElement;
    if (itemEl) {
      const id = getElementId(itemEl);
      if (selectedItems.has(id)) {
        selectedItems.delete(id);
      } else {
        selectedItems.set(id, {
          id,
          element: itemEl,
          title: (itemEl.querySelector(SELECTORS[platform].title) as HTMLElement)?.innerText || 'Untitled'
        });
      }
      e.stopPropagation();
      e.preventDefault();
      updateSelectionUI();
    }
  }, true);
};

/**
 * Entry: Watch for changes and inject "Toggle Mode" button
 */
const injectModeButton = () => {
  const platform = getPlatform();
  if (!platform) return;

  const existing = document.getElementById('history-manager-toggle');
  if (existing) return;

  const btn = document.createElement('button');
  btn.id = 'history-manager-toggle';
  btn.className = 'w-full mb-4 px-3 py-2 text-xs font-semibold bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 rounded-lg transition-all border border-indigo-600/30 flex items-center justify-between group';
  btn.innerHTML = `
    <span>History Manager</span>
    <span class="opacity-0 group-hover:opacity-100 transition-opacity bg-indigo-600 text-white px-1.5 rounded uppercase text-[8px]">Open</span>
  `;

  btn.onclick = toggleMultiSelectMode;

  const nav = document.querySelector(SELECTORS[platform].container);
  if (nav) {
    nav.prepend(btn);
  }
};

// Monitor DOM for navigation changes or new sidebar items
const observer = new MutationObserver(() => {
  injectModeButton();
});

observer.observe(document.body, { childList: true, subtree: true });

// Initialize
initDragEvents();
console.log('Chat History Multi-Manager Active.');
