
import React from 'react';

const App: React.FC = () => {
  return (
    <div className="p-4 font-sans text-slate-800">
      <header className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">
          H
        </div>
        <h1 className="text-lg font-bold">History Multi-Manager</h1>
      </header>

      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
        <p className="text-sm text-slate-600 leading-relaxed">
          Open <strong>ChatGPT</strong> or <strong>Gemini</strong> to start managing your chats.
        </p>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="w-5 h-5 flex items-center justify-center bg-slate-100 rounded text-xs font-mono">1</span>
            <span>Toggle "Multi-Select Mode" in the sidebar.</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="w-5 h-5 flex items-center justify-center bg-slate-100 rounded text-xs font-mono">2</span>
            <span>Drag your mouse or click to select items.</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="w-5 h-5 flex items-center justify-center bg-slate-100 rounded text-xs font-mono">3</span>
            <span>Batch delete or organize with ease.</span>
          </div>
        </div>
      </div>

      <footer className="mt-6 pt-4 border-t border-slate-100 flex justify-between items-center text-[10px] text-slate-400">
        <span>v1.0.0</span>
        <a href="#" className="hover:text-indigo-600 transition-colors">Documentation</a>
      </footer>
    </div>
  );
};

export default App;
