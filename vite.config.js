import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      // 測驗資料庫代理
      '/api-quiz': {
        target: 'https://script.google.com/macros/s/AKfycbyR7t58ExcpPfuuEY6wPz4ctdJg_V9fQ0klVnopEHYnYvn-DF-OzL8YxJTtKCI1h5nvCQ',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-quiz/, '')
      },
      // 即時問答資料庫代理
      '/api-poll': {
        target: 'https://script.google.com/macros/s/AKfycbysFb5yGkcDHXnb1-kQ-1fYFrweXFl16kkCRi_FaKMxiRkt679ayMJdfxxRdl52_-38cg',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-poll/, '')
      }
    }
  }
})