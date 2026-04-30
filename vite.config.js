import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/0417-2/',
  plugins: [vue()],
  server: {
    proxy: {
      // 測驗資料庫代理
      '/api-quiz': {
        target: 'https://script.google.com/macros/s/AKfycbxLSLXbOQBjMii0WXi3YNbGLAFA6FxLwsBDhUrLlR942HecqgS19hM-nuDxFeULk9y3gg',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-quiz/, '')
      },
      // 即時問答資料庫代理
      '/api-poll': {
        target: 'https://script.google.com/macros/s/AKfycbxgCLOipsnuhxbQmxGi_Wl3ndHESVaxjQ4qc4BPgdWmSZPOlQWnrwdDTE5N34LMaBwGHA',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-poll/, '')
      }
    }
  }
})