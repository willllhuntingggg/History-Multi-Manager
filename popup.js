
const translations = {
  zh: {
    title: '对话历史管理',
    ready: '准备就绪：ChatGPT',
    notSupported: '请在 ChatGPT 页面使用',
    step1: '点击侧边栏 <strong class="text-highlight">"☑ 多选管理"</strong>。',
    step2: '配合 <span class="kbd">Shift</span> 键可进行批量连选。',
    step3: '支持批量删除、批量移动至项目、关键词搜索。',
    step4: '支持通过目录快速定位多轮会话提问位置。',
    howTo: '操作指南',
    openBtn: '进入 ChatGPT',
    langBtn: 'English'
  },
  en: {
    title: 'History Manager',
    ready: 'Ready for ChatGPT',
    notSupported: 'Please open ChatGPT to use',
    step1: 'Click <strong class="text-highlight">"☑ History Manager"</strong> in the sidebar.',
    step2: 'Use <span class="kbd">Shift</span> + Click for bulk selection.',
    step3: 'Batch Delete, Batch Move to Projects, and Search filters.',
    howTo: 'How to use',
    openBtn: 'Go to ChatGPT',
    langBtn: '中文'
  }
};

let currentLang = 'zh';

document.addEventListener('DOMContentLoaded', () => {
  // Initialize
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['lang'], (result) => {
      if (result && result.lang) {
        currentLang = result.lang;
      }
      render();
    });
  } else {
    render();
  }

  // Bind Events
  document.getElementById('lang-btn').addEventListener('click', toggleLang);
  document.getElementById('open-btn').addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: 'https://chatgpt.com' });
    } else {
        window.open('https://chatgpt.com', '_blank');
    }
  });

  // Check Current Tab
  checkTab();
});

function toggleLang() {
  currentLang = currentLang === 'zh' ? 'en' : 'zh';
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ lang: currentLang });
  }
  render();
  checkTab(); // Refresh status text in new language
}

function checkTab() {
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        const isSupported = tab?.url?.includes('chatgpt.com') || tab?.url?.includes('chat.openai.com');
        updateStatus(isSupported);
      });
    } catch (e) {
      console.error(e);
      updateStatus(false);
    }
  } else {
    updateStatus(false); // Fallback for testing outside extension
  }
}

function updateStatus(isSupported) {
  const container = document.getElementById('status-container');
  const t = translations[currentLang];
  
  if (isSupported) {
    container.className = 'status-box ready';
    container.innerHTML = `
      <div class="dot"></div>
      <p class="status-text">${t.ready}</p>
    `;
  } else {
    container.className = 'status-box not-supported';
    container.innerHTML = `
      <div class="dot"></div>
      <p class="status-text">${t.notSupported}</p>
    `;
  }
}

function render() {
  const t = translations[currentLang];
  
  document.getElementById('app-title').textContent = t.title;
  document.getElementById('lang-btn').textContent = t.langBtn;
  document.getElementById('howto-title').textContent = t.howTo;
  
  const stepsHTML = [t.step1, t.step2, t.step3].map((step, idx) => `
    <div class="step-item">
      <div class="step-num">${idx + 1}</div>
      <p class="step-text">${step}</p>
    </div>
  `).join('');
  document.getElementById('steps-container').innerHTML = stepsHTML;

  const btn = document.getElementById('open-btn');
  btn.innerHTML = `
    ${t.openBtn}
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
  `;
}
