
import React, { useEffect, useState } from 'react';

declare const chrome: any;

const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<any | null>(null);
  const [lang, setLang] = useState<'zh' | 'en'>('zh');

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs: any[]) => {
        setCurrentTab(tabs[0] || null);
      });
      chrome.storage.local.get(['lang'], (result: any) => {
        if (result.lang) setLang(result.lang);
      });
    }
  }, []);

  const toggleLang = () => {
    const newLang = lang === 'zh' ? 'en' : 'zh';
    setLang(newLang);
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ lang: newLang });
    }
  };

  const isSupported = currentTab?.url?.includes('chatgpt.com') || 
                      currentTab?.url?.includes('chat.openai.com');

  const t = {
    zh: {
      title: '对话历史管理',
      ready: '准备就绪：ChatGPT',
      notSupported: '请在 ChatGPT 页面使用',
      step1: '点击侧边栏的 <strong class="text-indigo-600">"☑ 多选管理"</strong>。',
      step2: '像使用 Gmail 一样，配合 <kbd class="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] font-mono shadow-sm">Shift</kbd> 键进行多选。',
      step3: '一键批量搜索、删除或移动对话到项目。',
      howTo: '如何开始',
      openBtn: '打开 ChatGPT',
      langBtn: 'English'
    },
    en: {
      title: 'History Manager',
      ready: 'Ready for ChatGPT',
      notSupported: 'Please open ChatGPT to use',
      step1: 'Click <strong class="text-indigo-600">"☑ History Manager"</strong> in the sidebar.',
      step2: 'Use <kbd class="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] font-mono shadow-sm">Shift</kbd> + click to select items like Gmail.',
      step3: 'Batch Search, Delete, or Move chats in seconds.',
      howTo: 'How to use',
      openBtn: 'Go to ChatGPT',
      langBtn: '中文'
    }
  }[lang];

  return (
    <div className="p-0 font-sans text-slate-800 bg-white select-none w-[350px]">
      <header className="px-5 py-4 bg-indigo-600 text-white flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-white rounded flex items-center justify-center">
             <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
          </div>
          <h1 className="text-base font-bold tracking-tight">{t.title}</h1>
        </div>
        <button 
          onClick={toggleLang}
          className="text-[10px] bg-indigo-500 hover:bg-indigo-400 px-2 py-1 rounded-md font-bold transition-colors"
        >
          {t.langBtn}
        </button>
      </header>

      <main className="p-5 space-y-5">
        {isSupported ? (
          <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <p className="text-sm text-emerald-800 font-medium">{t.ready}</p>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-100 rounded-xl">
            <div className="w-2 h-2 rounded-full bg-amber-400"></div>
            <p className="text-sm text-amber-800 font-medium italic">{t.notSupported}</p>
          </div>
        )}

        <div className="space-y-4">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest px-1">{t.howTo}</h2>
          
          <div className="space-y-4">
            {[t.step1, t.step2, t.step3].map((step, idx) => (
              <div className="flex gap-3" key={idx}>
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-xs font-bold border border-indigo-100">{idx + 1}</div>
                <p className="text-[13px] text-slate-600 leading-snug" dangerouslySetInnerHTML={{ __html: step }}></p>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-2">
          <button 
            onClick={() => window.open('https://chatgpt.com')}
            className="w-full py-2.5 bg-slate-900 hover:bg-black text-white rounded-lg text-sm font-semibold transition-all shadow-sm active:scale-[0.98] flex items-center justify-center gap-2"
          >
            {t.openBtn}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
          </button>
        </div>
      </main>

      <footer className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-center items-center">
        <span className="text-[10px] text-slate-400 font-medium tracking-wide">V1.0.0</span>
      </footer>
    </div>
  );
};

export default App;
