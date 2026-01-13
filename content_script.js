
/**
 * Global State
 */
let isDashboardOpen = false;
let isTOCSidebarOpen = false; 
let scannedItems = []; 
let selectedIds = new Set();
let processedIds = new Set(); // Track moved/deleted items
let baseSelection = new Set(); 
let pivotId = null; 
let availableProjects = []; 
let isProcessing = false;
let isFetchingProjects = false; // New: Track fetching state
let searchQuery = ''; 
let currentUILang = 'en'; // Default to English

// Platform Configuration
const PLATFORM_CONFIG = {
  chatgpt: {
    name: 'ChatGPT',
    enabled: true,
    linkSelector: 'a[data-sidebar-item="true"]',
    urlPattern: /^\/c\/[a-z0-9-]{10,}$/i, 
    menuBtnSelector: 'button[data-testid*="-options"]',
    deleteBtnSelector: '[data-testid="delete-chat-menu-item"]',
    confirmBtnSelector: '[data-testid="delete-conversation-confirm-button"]',
    moveLabelEn: 'Move to',
    moveLabelZh: '移至',
    projectItemSelector: '[role="menuitem"]',
    loginIndicators: ['[data-testid="user-menu-button"]', '#prompt-textarea', 'nav']
  },
  gemini: {
    name: 'Gemini',
    enabled: true,
    // Custom logic for Gemini's non-standard list
    itemSelector: 'div[data-test-id="conversation"]', 
    titleSelector: '.conversation-title',
    // Extract ID from jslog attribute: jslog="...[&quot;c_123&quot;...]"
    getId: (el) => {
        const jslog = el.getAttribute('jslog');
        if (!jslog) return null;
        const match = jslog.match(/"(c_[a-z0-9]+)"/i) || jslog.match(/&quot;(c_[a-z0-9]+)&quot;/i);
        return match ? match[1] : null;
    },
    // The menu button is in a sibling container
    getMenuBtn: (el) => {
        // Based on HTML dump: .conversation is sibling to .conversation-actions-container
        // They are both children of .conversation-items-container
        const container = el.parentElement; 
        if (container) {
            const actionContainer = container.querySelector('.conversation-actions-container');
            if (actionContainer) {
                return actionContainer.querySelector('button[data-test-id="actions-menu-button"]');
            }
        }
        return null;
    },
    menuBtnSelector: 'button[data-test-id="actions-menu-button"]', // Fallback
    deleteBtnSelector: '[role="menuitem"]', // Requires text match
    confirmBtnSelector: 'button[data-test-id="confirm-button"]', // Specific selector for Gemini confirm button
    moveLabelEn: null, 
    moveLabelZh: null,
    projectItemSelector: null,
    loginIndicators: ['a[href*="accounts.google.com"]', '[aria-label*="Gemini"]', 'nav', 'infinite-scroller']
  }
};

/**
 * NEW: Platform Abstraction Layer
 * Isolates direct access to PLATFORM_CONFIG and getPlatform()
 */
const Platform = {
  get type() { return getPlatform(); },
  get config() { return PLATFORM_CONFIG[this.type]; },
  get isGemini() { return this.type === 'gemini'; },
  
  // Wrappers for operations that need config
  async deleteItem(item) { return await deleteOne(item, this.config); },
  async moveItem(item, project) { return await moveOne(item, project, this.config); }
};

const uiTranslations = {
  en: {
    launcher_btn: 'Manager',
    toc_launcher: 'TOC',
    toc_title: 'Conversation TOC',
    toc_refresh: 'Refresh TOC',
    toc_empty: 'No user messages found',
    dash_title: 'Batch Manage Chats',
    dash_subtitle: 'Support Shift-selection (Range/Invert)',
    dash_search_placeholder: 'Search history...',
    dash_selected_count: 'items selected',
    dash_btn_refresh: 'Refresh',
    dash_btn_move: 'Move to Project',
    dash_btn_delete: 'Run Delete',
    dash_processing_main: 'Executing automated operations...',
    dash_empty_none: 'No conversations found',
    dash_empty_sidebar: 'Make sure the sidebar is expanded.',
    dash_empty_search: 'No matches found',
    confirm_delete: 'Are you sure you want to delete {count} chats?',
    confirm_move: 'Move {count} chats to "{project}"?',
    alert_delete_done: 'Batch delete finished.',
    alert_move_done: 'Batch migration finished.',
    alert_select_first: 'Please select at least one chat to fetch projects.',
    msg_processing: 'Processing {current} / {total}...',
    project_none: 'No projects (Click to refresh)',
    project_loading: 'Loading projects...',
    project_fetch_hint: 'Click to fetch project list',
    delete_text: ['Delete', '删除'],
    not_supported_gemini: 'Not supported on Gemini'
  },
  zh: {
    launcher_btn: '多选管理',
    toc_launcher: '目录',
    toc_title: '会话目录',
    toc_refresh: '更新目录',
    toc_empty: '未发现用户侧消息',
    dash_title: '多选管理对话',
    dash_subtitle: '支持 Shift 连选（含反选/范围缩减）',
    dash_search_placeholder: '模糊搜索历史记录...',
    dash_selected_count: '项已选',
    dash_btn_refresh: '刷新列表',
    dash_btn_move: '移至项目',
    dash_btn_delete: '执行删除',
    dash_processing_main: '正在执行自动化操作...',
    dash_empty_none: '未发现对话',
    dash_empty_sidebar: '请确保侧边栏已展开且包含历史记录',
    dash_empty_search: '未找到匹配结果',
    confirm_delete: '确定要执行删除吗？共 {count} 项。',
    confirm_move: '确定将选中的 {count} 项对话移至项目“{project}”吗？',
    alert_delete_done: '操作结束',
    alert_move_done: '迁移操作结束',
    alert_select_first: '请先选择至少一个对话以获取项目列表',
    msg_processing: '正在处理第 {current} / {total} 项...',
    project_none: '无可用项目 (点击刷新)',
    project_loading: '正在加载项目列表...',
    project_fetch_hint: '点击获取项目列表',
    delete_text: ['删除', 'Delete'],
    not_supported_gemini: 'Gemini 暂不支持此功能'
  }
};

const t = (key) => uiTranslations[currentUILang][key] || key;

/**
 * Language Sync
 */
const syncLanguage = () => {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['lang'], (result) => {
      if (result.lang && (result.lang === 'en' || result.lang === 'zh')) {
        const oldLang = currentUILang;
        currentUILang = result.lang;
        if (oldLang !== currentUILang) {
          refreshUILabel();
        }
      }
    });
  }
};

const refreshUILabel = () => {
  const launcher = document.getElementById('history-manager-launcher');
  if (launcher) launcher.innerHTML = `<span>☑</span> ${t('launcher_btn')}`;

  const tocLauncher = document.getElementById('chat-toc-launcher');
  if (tocLauncher) tocLauncher.innerHTML = t('toc_launcher');

  const tocPanel = document.getElementById('chat-toc-panel');
  if (tocPanel) {
    tocPanel.querySelector('.toc-header-title').innerText = t('toc_title');
    tocPanel.querySelector('#refresh-toc-btn').innerText = t('toc_refresh');
  }

  const overlay = document.getElementById('history-manager-overlay');
  if (overlay) {
    overlay.querySelector('.header-info h2').innerText = t('dash_title');
    overlay.querySelector('.header-info p').innerText = t('dash_subtitle');
    overlay.querySelector('#dash-search-input').placeholder = t('dash_search_placeholder');
    overlay.querySelector('#dash-refresh-btn').innerText = t('dash_btn_refresh');
    overlay.querySelector('#dash-move-trigger').innerHTML = `${t('dash_btn_move')} ▾`;
    overlay.querySelector('#dash-delete-btn').innerText = t('dash_btn_delete');
    overlay.querySelector('#processing-main-text').innerText = t('dash_processing_main');
    updateFooter();
    renderDashboard();
    renderProjectDropdown();
  }
};

/**
 * Login status detection
 */
const isLoggedIn = () => {
  // Use Platform abstraction
  const config = Platform.config;
  if (!config) return false;
  return config.loginIndicators.some(selector => !!document.querySelector(selector));
};

/**
 * Cleanup injected UI
 */
const cleanupUI = () => {
  document.getElementById('history-manager-launcher')?.remove();
  document.getElementById('chat-toc-launcher')?.remove();
  document.getElementById('chat-toc-panel')?.remove();
  document.getElementById('history-manager-overlay')?.remove();
  isDashboardOpen = false;
  isTOCSidebarOpen = false;
};

/**
 * HTML Escape Tool
 */
const escapeHTML = (str) => {
  if (!str) return "";
  return str.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[m]);
};

/**
 * TOC Panel Initialization
 */
const initTOC = () => {
  if (document.getElementById('chat-toc-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'chat-toc-panel';
  panel.innerHTML = `
    <div class="toc-header">
      <span class="toc-header-title">${t('toc_title')}</span>
      <button id="close-toc-btn" aria-label="Close">✕</button>
    </div>
    <div id="toc-content-list" class="toc-list"></div>
    <div class="toc-footer">
      <button id="refresh-toc-btn">${t('toc_refresh')}</button>
    </div>
  `;
  document.body.appendChild(panel);
  document.getElementById('close-toc-btn').onclick = toggleTOC;
  document.getElementById('refresh-toc-btn').onclick = refreshTOC;
};

const toggleTOC = () => {
  const panel = document.getElementById('chat-toc-panel');
  if (!panel) {
    initTOC();
    return toggleTOC();
  }
  isTOCSidebarOpen = !isTOCSidebarOpen;
  if (isTOCSidebarOpen) {
    panel.classList.add('open');
    refreshTOC();
  } else {
    panel.classList.remove('open');
  }
};

const refreshTOC = () => {
  const list = document.getElementById('toc-content-list');
  if (!list) return;
  
  // Try finding user messages (ChatGPT vs Gemini)
  // ChatGPT: div[data-message-author-role="user"]
  // Gemini: .user-query-container or similar? Gemini DOM is dynamic.
  // We'll try a few broad selectors.
  
  let userMessages = document.querySelectorAll('div[data-message-author-role="user"]');
  if (userMessages.length === 0) {
    // Fallback for Gemini or others: Look for blocks that might be user queries
    // Gemini often wraps user text in a specific class structure. 
    // This is experimental for Gemini.
    userMessages = document.querySelectorAll('.user-query-text, .query-text'); 
  }

  if (userMessages.length === 0) {
    list.innerHTML = `<div class="toc-empty">${t('toc_empty')}</div>`;
    return;
  }

  list.innerHTML = Array.from(userMessages).map((msg, idx) => {
    // Try to find the text content container
    const textEl = msg.querySelector('.whitespace-pre-wrap') || msg;
    const rawText = textEl.textContent.trim().replace(/\n/g, ' ');
    const safeText = escapeHTML(rawText);

    return `
      <div class="toc-item" data-idx="${idx}" title="${safeText}">
        <div class="toc-item-inner">
          <span class="toc-num">${idx + 1}</span>
          <span class="toc-text">${safeText}</span>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.toc-item').forEach(item => {
    item.onclick = () => {
      const idx = parseInt(item.dataset.idx);
      const targetMsg = userMessages[idx];
      if (targetMsg) {
        targetMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        const originalBg = targetMsg.style.background;
        targetMsg.style.transition = 'background 0.5s ease';
        targetMsg.style.background = 'rgba(55, 54, 91, 0.15)';
        setTimeout(() => targetMsg.style.background = originalBg, 2000);

        setTimeout(() => {
          targetMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 600);
      }
    };
  });
};

const injectTOCLauncher = () => {
  if (document.getElementById('chat-toc-launcher')) return;
  const btn = document.createElement('button');
  btn.id = 'chat-toc-launcher';
  btn.innerHTML = t('toc_launcher');
  btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleTOC(); };
  document.body.appendChild(btn);
};

/**
 * Automation Tools
 */
const hardClick = (el) => {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse' }));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.focus();
  el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse' }));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.dispatchEvent(new MouseEvent('click', opts));
};

const waitForElement = (selector, timeout = 3000, textMatch = null) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const check = () => {
      const els = document.querySelectorAll(selector);
      let found = null;
      if (textMatch) {
        if (Array.isArray(textMatch)) {
          found = Array.from(els).find(el => textMatch.some(tm => el.innerText.includes(tm) || el.getAttribute('aria-label')?.includes(tm)));
        } else {
          found = Array.from(els).find(el => el.innerText.includes(textMatch) || el.getAttribute('aria-label')?.includes(textMatch));
        }
      } else {
        found = els[0];
      }
      if (found && found.offsetParent !== null) resolve(found);
      else if (Date.now() - startTime > timeout) resolve(null);
      else setTimeout(check, 100);
    };
    check();
  });
};

const waitForDisappear = (selector, timeout = 4000) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const check = () => {
      const el = document.querySelector(selector);
      if (!el || el.offsetParent === null) resolve(true);
      else if (Date.now() - startTime > timeout) resolve(false);
      else setTimeout(check, 200);
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
 * History Scanner
 */
const scanHistory = () => {
  // Use Platform abstraction
  const config = Platform.config;
  if (!config) return [];
  
  const results = [];
  const seenIds = new Set();

  if (config.itemSelector && config.getId) {
    // Strategy for platforms like Gemini (divs + jslog ID)
    const items = Array.from(document.querySelectorAll(config.itemSelector));
    items.forEach(el => {
        const id = config.getId(el);
        if (!id || seenIds.has(id)) return;
        seenIds.add(id);
        
        let title = "Untitled Chat";
        const titleEl = el.querySelector(config.titleSelector);
        if (titleEl) title = titleEl.innerText;
        
        results.push({ id: id, title, url: null, isGemini: true });
    });
  } else {
    // Strategy for platforms like ChatGPT (Anchor links + HREF)
    const links = Array.from(document.querySelectorAll(config.linkSelector));
    links.forEach((link) => {
        const href = link.getAttribute('href');
        if (!href) return;
        const path = href.split('?')[0];
        if (!config.urlPattern.test(path)) return;
        if (href.includes('/new') || href === '/') return;
        const rawId = path.split('/').pop();
        if (seenIds.has(rawId)) return;
        seenIds.add(rawId);
        
        const titleEl = link.querySelector('.truncate, span[dir="auto"]');
        const title = titleEl ? titleEl.innerText : "Untitled Chat";
        results.push({ id: `id-${rawId}`, title, url: href, isGemini: false });
    });
  }

  return results;
};

/**
 * Fetch Project List
 */
const fetchProjects = async (silent = false) => {
  if (isFetchingProjects) return;

  // Use Platform abstraction
  const config = Platform.config;
  
  if (!config.projectItemSelector) {
    if (!silent) alert(t('not_supported_gemini'));
    return;
  }

  let item = null;
  if (selectedIds.size > 0) {
    const firstId = Array.from(selectedIds)[0];
    item = scannedItems.find(it => it.id === firstId);
  } else if (silent && scannedItems.length > 0) {
    item = scannedItems[0];
  }

  if (!item) {
    if (!silent) alert(t('alert_select_first'));
    return;
  }

  isFetchingProjects = true;
  renderProjectDropdown(); // Show loading state

  try {
    const link = document.querySelector(`${config.linkSelector}[href="${item.url}"]`);
    if (!link) throw new Error("Chat link not found");
    
    let menuBtn = link.querySelector(config.menuBtnSelector);
    if (!menuBtn && config.findMenuBtnOutside) {
        menuBtn = link.parentElement.querySelector(config.menuBtnSelector);
        if (!menuBtn) menuBtn = link.parentElement?.parentElement?.querySelector(config.menuBtnSelector);
    }
    if (!menuBtn) throw new Error("Menu button not found");

    link.scrollIntoView({ block: 'center' });
    hardClick(menuBtn);
    
    // Try English label first, then Chinese
    let moveMenuItem = await waitForElement(config.projectItemSelector, 2000, config.moveLabelEn);
    if (!moveMenuItem) {
      moveMenuItem = await waitForElement(config.projectItemSelector, 1000, config.moveLabelZh);
    }

    if (!moveMenuItem) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      throw new Error("Move menu item not found");
    }
    hardClick(moveMenuItem);
    await new Promise(r => setTimeout(r, 500));

    const subMenuItems = document.querySelectorAll('[role="menu"] a[role="menuitem"], [role="menu"] [role="menuitem"]');
    const projects = [];
    subMenuItems.forEach(el => {
      const title = el.querySelector('.truncate')?.innerText;
      if (title && !title.includes('Project') && title !== 'New project' && title !== '新项目') projects.push(title);
    });
    availableProjects = [...new Set(projects)];
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    // Double escape to ensure submenus are closed
    await new Promise(r => setTimeout(r, 100));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  } catch (e) {
    console.warn("Fetch projects failed:", e);
    // Silent mode: suppress alert
    if (!silent) alert(t('alert_select_first'));
  } finally {
    isFetchingProjects = false;
    renderProjectDropdown();
  }
};

/**
 * Batch Operations
 */
const deleteOne = async (item, config) => {
  let element;
  let menuBtn;

  if (item.isGemini && config.getMenuBtn) {
      // Logic for Gemini
      // Re-find the element using ID pattern in jslog or attribute
      const items = Array.from(document.querySelectorAll(config.itemSelector));
      element = items.find(el => {
         const id = config.getId(el);
         return id === item.id;
      });
      
      if (!element) return false;
      element.scrollIntoView({ block: 'center' });
      element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await new Promise(r => setTimeout(r, 400));
      
      menuBtn = config.getMenuBtn(element);

  } else {
      // Logic for ChatGPT
      element = document.querySelector(`${config.linkSelector}[href="${item.url}"]`);
      if (!element) return false;
      
      menuBtn = element.querySelector(config.menuBtnSelector);
      if (!menuBtn && config.findMenuBtnOutside) {
          const parent = element.parentElement;
          if (parent) {
              menuBtn = parent.querySelector(config.menuBtnSelector);
              if (!menuBtn && parent.parentElement) {
                   menuBtn = parent.parentElement.querySelector(config.menuBtnSelector);
              }
          }
      }
      element.scrollIntoView({ block: 'center' });
      await new Promise(r => setTimeout(r, 400));
  }

  if (!menuBtn) return false;

  hardClick(menuBtn);
  
  // Wait for delete menu item.
  let deleteBtn = await waitForElement(config.deleteBtnSelector, 2000, t('delete_text'));
  
  if (!deleteBtn) {
      document.body.click();
      return false;
  }
  
  hardClick(deleteBtn);
  
  // Increased wait time for confirm button animation
  const confirmBtn = await waitForElement(config.confirmBtnSelector, 5000, t('delete_text'));
  
  if (!confirmBtn) {
       document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
       return false;
  }
  
  // Add small delay to ensure dialog is ready for interaction
  await new Promise(r => setTimeout(r, 300));
  hardClick(confirmBtn);
  await new Promise(r => setTimeout(r, 1000));
  return true;
};

const moveOne = async (item, projectName, config) => {
  if (!config.projectItemSelector) return false;

  const link = document.querySelector(`${config.linkSelector}[href="${item.url}"]`);
  if (!link) return false;
  
  const menuBtn = link.querySelector(config.menuBtnSelector);
  if (!menuBtn) return false;
  
  link.scrollIntoView({ block: 'center' });
  await new Promise(r => setTimeout(r, 400));
  hardClick(menuBtn);
  
  let moveMenuItem = await waitForElement(config.projectItemSelector, 2000, config.moveLabelEn);
  if (!moveMenuItem) {
    moveMenuItem = await waitForElement(config.projectItemSelector, 1000, config.moveLabelZh);
  }
  if (!moveMenuItem) return false;
  hardClick(moveMenuItem);
  
  const targetProject = await waitForElement('[role="menu"] [role="menuitem"]', 2000, projectName);
  if (!targetProject) return false;
  hardClick(targetProject);
  await new Promise(r => setTimeout(r, 1500));
  return true;
};

const updateProgress = (current, total) => {
  const el = document.getElementById('processing-progress-text');
  if (el) el.innerText = t('msg_processing').replace('{current}', current).replace('{total}', total);
};

const runBatchDelete = async () => {
  const ids = Array.from(selectedIds);
  if (!confirm(t('confirm_delete').replace('{count}', ids.length))) return;
  isProcessing = true;
  const overlay = document.getElementById('history-manager-overlay');
  overlay.classList.add('processing');

  for (let i = 0; i < ids.length; i++) {
    updateProgress(i + 1, ids.length);
    const item = scannedItems.find(it => it.id === ids[i]);
    // Use Platform.deleteItem instead of direct config/deleteOne calls
    if (item && await Platform.deleteItem(item)) {
      processedIds.add(ids[i]); 
      selectedIds.delete(ids[i]);
      scannedItems = scannedItems.filter(it => it.id !== ids[i]);
      renderDashboard();
    }
  }
  isProcessing = false;
  overlay.classList.remove('processing');
  alert(t('alert_delete_done'));
};

const runBatchMove = async (projectName) => {
  const ids = Array.from(selectedIds);
  if (!confirm(t('confirm_move').replace('{count}', ids.length).replace('{project}', projectName))) return;
  isProcessing = true;
  const overlay = document.getElementById('history-manager-overlay');
  overlay.classList.add('processing');

  for (let i = 0; i < ids.length; i++) {
    updateProgress(i + 1, ids.length);
    const item = scannedItems.find(it => it.id === ids[i]);
    // Use Platform.moveItem instead of direct config/moveOne calls
    if (item && await Platform.moveItem(item, projectName)) {
      processedIds.add(ids[i]); 
      selectedIds.delete(ids[i]);
      scannedItems = scannedItems.filter(it => it.id !== ids[i]);
      renderDashboard();
    }
  }
  isProcessing = false;
  overlay.classList.remove('processing');
  alert(t('alert_move_done'));
};

/**
 * Dashboard Rendering
 */
const renderDashboard = () => {
  const container = document.getElementById('dashboard-items-grid');
  if (!container) return;
  const filteredItems = scannedItems.filter(item => item.title.toLowerCase().includes(searchQuery.toLowerCase()));
  if (scannedItems.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>${t('dash_empty_none')}</h3><p>${t('dash_empty_sidebar')}</p></div>`;
  } else if (filteredItems.length === 0) {
    container.innerHTML = `<div class="empty-state"><h3>${t('dash_empty_search')}</h3></div>`;
  } else {
    container.innerHTML = filteredItems.map(item => `
      <div class="chat-card ${selectedIds.has(item.id) ? 'selected' : ''}" data-id="${item.id}">
        <div class="card-title">${escapeHTML(item.title)}</div>
        <div class="card-checkbox"></div>
      </div>
    `).join('');
  }
  
  container.querySelectorAll('.chat-card').forEach(card => {
    card.onclick = (e) => {
      if (isProcessing) return;
      const id = card.dataset.id;
      if (e.shiftKey && pivotId) {
        const currentIds = filteredItems.map(it => it.id);
        const [min, max] = [Math.min(currentIds.indexOf(pivotId), currentIds.indexOf(id)), Math.max(currentIds.indexOf(pivotId), currentIds.indexOf(id))];
        const range = currentIds.slice(min, max + 1);
        const shouldSel = baseSelection.has(pivotId);
        range.forEach(rid => shouldSel ? selectedIds.add(rid) : selectedIds.delete(rid));
      } else {
        selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id);
        pivotId = id;
        baseSelection = new Set(selectedIds);
      }
      renderDashboard(); updateFooter();
    };
  });
};

const renderProjectDropdown = () => {
  const list = document.getElementById('available-projects-list');
  if (!list) return;

  if (isFetchingProjects) {
    list.innerHTML = `<div class="project-option-item disabled">${t('project_loading')}</div>`;
    return;
  }

  list.innerHTML = availableProjects.length ? availableProjects.map(p => `<div class="project-option-item" data-name="${p}">${p}</div>`).join('') : `<div class="project-option-item disabled">${availableProjects.length === 0 ? t('project_fetch_hint') : t('project_none')}</div>`;
  list.querySelectorAll('.project-option-item:not(.disabled)').forEach(item => {
    item.onclick = () => { runBatchMove(item.dataset.name); document.getElementById('project-dropdown').classList.remove('open'); };
  });
};

const updateFooter = () => {
  const lbl = document.getElementById('selected-count-label');
  const delBtn = document.getElementById('dash-delete-btn');
  const moveBtn = document.getElementById('dash-move-trigger');
  // Use Platform abstraction
  const config = Platform.config;

  if (lbl) lbl.innerText = `${selectedIds.size} ${t('dash_selected_count')}`;
  if (delBtn) delBtn.disabled = selectedIds.size === 0 || isProcessing;
  
  if (moveBtn) {
    moveBtn.disabled = selectedIds.size === 0 || isProcessing;
    if (config && !config.projectItemSelector) {
        moveBtn.style.display = 'none'; // Hide move button if not supported
    } else {
        moveBtn.style.display = 'block';
    }
  }
};

const toggleDashboard = () => {
  if (!isLoggedIn()) return;
  let overlay = document.getElementById('history-manager-overlay');
  if (!overlay) { initOverlay(); overlay = document.getElementById('history-manager-overlay'); }
  isDashboardOpen = !isDashboardOpen;
  if (isDashboardOpen) {
    overlay.style.setProperty('display', 'flex', 'important');
    // Filter out already processed (moved/deleted) items when re-scanning
    scannedItems = scanHistory().filter(item => !processedIds.has(item.id));
    selectedIds.clear(); renderDashboard(); updateFooter();

    // Optimistic fetch if we have no projects yet
    if (availableProjects.length === 0 && Platform.config.projectItemSelector && !isFetchingProjects) {
        fetchProjects(true); // Silent background fetch
    }
  } else {
    overlay.style.display = 'none';
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
          <h2>${t('dash_title')}</h2>
          <p>${t('dash_subtitle')}</p>
        </div>
        <button id="close-dash-btn">✕</button>
      </div>
      <div class="dashboard-search-container">
        <div class="search-input-wrapper">
          <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" id="dash-search-input" placeholder="${t('dash_search_placeholder')}" />
        </div>
      </div>
      <div id="dashboard-items-grid" class="dashboard-body"></div>
      <div class="dashboard-footer">
        <span id="selected-count-label">0 ${t('dash_selected_count')}</span>
        <div class="footer-actions">
          <button id="dash-refresh-btn" class="btn-secondary">${t('dash_btn_refresh')}</button>
          <div id="project-dropdown" class="dropdown-wrapper">
             <button id="dash-move-trigger" class="btn-secondary" disabled>${t('dash_btn_move')} ▾</button>
             <div id="available-projects-list" class="dropdown-content"></div>
          </div>
          <button id="dash-delete-btn" class="btn-primary danger" disabled>${t('dash_btn_delete')}</button>
        </div>
      </div>
      <div id="processing-mask"><div class="processing-card"><div class="spinner"></div><span id="processing-main-text">${t('dash_processing_main')}</span><span id="processing-progress-text"></span></div></div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('close-dash-btn').onclick = toggleDashboard;
  document.getElementById('dash-refresh-btn').onclick = () => { scannedItems = scanHistory(); renderDashboard(); };
  document.getElementById('dash-search-input').oninput = (e) => { searchQuery = e.target.value; renderDashboard(); };
  
  const moveTrigger = document.getElementById('dash-move-trigger');
  const dropdown = document.getElementById('project-dropdown');
  moveTrigger.onclick = (e) => { 
    e.stopPropagation(); 
    dropdown.classList.toggle('open'); 
    if (!availableProjects.length && !isFetchingProjects) fetchProjects(); 
  };
  
  // Close dropdown on outside click, but ignore simulated clicks from this script (isTrusted=false)
  window.addEventListener('click', (e) => {
    if (!e.isTrusted) return; 
    dropdown.classList.remove('open');
  });

  document.getElementById('dash-delete-btn').onclick = runBatchDelete;
};

/**
 * Injection
 */
const injectLauncher = () => {
  // Use Platform abstraction
  if (!Platform.type) return;
  if (!isLoggedIn()) { cleanupUI(); return; }
  if (document.getElementById('history-manager-launcher')) return;

  const btn = document.createElement('button');
  btn.id = 'history-manager-launcher';
  btn.innerHTML = `<span>☑</span> ${t('launcher_btn')}`;
  btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleDashboard(); };
  
  if (Platform.isGemini) {
      // Find the "Settings & help" button
      const targetBtn = document.querySelector('side-nav-action-button[data-test-id="settings-and-help-button"]');
      if (targetBtn && targetBtn.parentElement) {
          const parentList = targetBtn.parentElement;
          
          // Change layout to horizontal
          parentList.style.display = 'flex';
          parentList.style.flexDirection = 'row';
          parentList.style.alignItems = 'center';
          
          // Let Settings button be flexible but not hog all space
          targetBtn.style.flex = '1'; 
          targetBtn.style.width = 'auto'; 
          
          parentList.appendChild(btn);
          btn.classList.add('gemini-launcher-inline');
      } else {
          // If not found yet, return and wait for next mutation
          return;
      }
  } else {
      // Standard ChatGPT injection
      const sidebar = document.querySelector('nav') || document.querySelector('[role="navigation"]');
      if (sidebar) sidebar.appendChild(btn);
  }
  
  injectTOCLauncher();
  initTOC();
};

const observer = new MutationObserver(() => injectLauncher());
observer.observe(document.body, { childList: true, subtree: true });

// Listen for storage changes to sync language immediately
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.lang) {
      syncLanguage();
    }
  });
}

// Initial Sync
syncLanguage();
setTimeout(injectLauncher, 2000);

const style = document.createElement('style');
style.textContent = `.processing #processing-mask { display: flex !important; }`;
document.head.appendChild(style);
