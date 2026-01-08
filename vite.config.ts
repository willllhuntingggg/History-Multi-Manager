
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // 定义多个入口点
      input: {
        popup: resolve(__dirname, 'index.html'),
        content_script: resolve(__dirname, 'content_script.tsx'),
      },
      output: {
        // 自定义输出文件名结构
        // 关键点：Content Script 不能带 hash，否则 manifest.json 无法预测文件名
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'content_script') {
            return 'content_script.js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
