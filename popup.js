
const translations = {
  zh: {
    title: 'AI 对话历史管理',
    ready: '准备就绪',
    notSupported: '请在 ChatGPT 或 Gemini 页面使用',
    step1: '点击侧边栏悬浮的 <strong class="text-highlight">"☑ 多选管理"</strong>。',
    step2: '配合 <span class="kbd">Shift</span> 键可进行批量连选。',
    step3: '支持批量删除、关键词搜索 (Gemini 暂不支持移动项目)。',
    step4: '点击右侧悬浮 <strong class="text-highlight">"目录"</strong> 按钮，查看会话大纲。',
    howTo: '操作指南',
    openBtn: '打开 ChatGPT',
    openGeminiBtn: '打开 Gemini',
    langBtn: 'English',
    coffee: '如果这个插件帮到了你，可以请我喝杯咖啡 ☕'
  },
  en: {
    title: 'AI History Manager',
    ready: 'Ready to manage',
    notSupported: 'Please open ChatGPT or Gemini',
    step1: 'Click <strong class="text-highlight">"☑ Manager"</strong> on the sidebar.',
    step2: 'Use <span class="kbd">Shift</span> + Click for bulk selection.',
    step3: 'Batch Delete and Search (Move not supported on Gemini).',
    step4: 'Click floating <strong class="text-highlight">"TOC"</strong> button to view outline.',
    howTo: 'How to use',
    openBtn: 'Open ChatGPT',
    openGeminiBtn: 'Open Gemini',
    langBtn: '中文',
    coffee: 'If this extension saves you time, you can buy me a coffee ☕'
  }
};

let currentLang = 'en';
const COFFEE_URL = 'https://ko-fi.com/irvinghsu';

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
    openUrl('https://chatgpt.com');
  });
  
  // Add Gemini button listener if it exists (dynamically added)
  document.body.addEventListener('click', (e) => {
    if (e.target.id === 'open-gemini-btn' || e.target.closest('#open-gemini-btn')) {
      openUrl('https://gemini.google.com');
    }
  });

  // Check Current Tab
  checkTab();
});

function openUrl(url) {
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: url });
  } else {
      window.open(url, '_blank');
  }
}

function toggleLang() {
  currentLang = currentLang === 'zh' ? 'en' : 'zh';
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ lang: currentLang });
  }
  render();
  checkTab(); 
}

function checkTab() {
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        const isChatGPT = tab?.url?.includes('chatgpt.com') || tab?.url?.includes('chat.openai.com');
        const isGemini = tab?.url?.includes('gemini.google.com');
        updateStatus(isChatGPT || isGemini, isGemini ? 'Gemini' : 'ChatGPT');
      });
    } catch (e) {
      console.error(e);
      updateStatus(false);
    }
  } else {
    updateStatus(false); 
  }
}

function updateStatus(isSupported, platformName) {
  const container = document.getElementById('status-container');
  const t = translations[currentLang];
  
  if (isSupported) {
    container.className = 'status-box ready';
    container.innerHTML = `
      <div class="dot"></div>
      <p class="status-text">${t.ready}: ${platformName}</p>
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
  
  const stepsHTML = [t.step1, t.step2, t.step3, t.step4].map((step, idx) => `
    <div class="step-item">
      <div class="step-num">${idx + 1}</div>
      <p class="step-text">${step}</p>
    </div>
  `).join('');
  document.getElementById('steps-container').innerHTML = stepsHTML;

  const btnArea = document.querySelector('.action-area');
  btnArea.innerHTML = `
    <div style="display: flex; gap: 10px;">
      <button id="open-btn" class="primary-btn" style="flex: 1;">
        ${t.openBtn}
      </button>
      <button id="open-gemini-btn" class="primary-btn" style="flex: 1; background-color: #1e40af;">
        ${t.openGeminiBtn}
      </button>
    </div>
  `;

  // Render Coffee
  const coffeeContainer = document.getElementById('coffee-container');
  coffeeContainer.innerHTML = `<a href="#" class="coffee-link">${t.coffee}</a>`;
  coffeeContainer.querySelector('a').onclick = (e) => {
    e.preventDefault();
    openUrl(COFFEE_URL);
  };
}
