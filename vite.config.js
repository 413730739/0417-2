import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: '/0417-2/',   // ← 加上這行，填你的倉庫名稱
  server: {
    proxy: {
      // 將以 /api-quiz 開頭的請求轉發到 Google Apps Script，解決開發時的 CORS 問題
      '/api-quiz': {
        target: 'https://script.google.com/macros/s/AKfycbyR7t58ExcpPfuuEY6wPz4ctdJg_V9fQ0klVnopEHYnYvn-DF-OzL8YxJTtKCI1h5nvCQ',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-quiz/, '')
      }
    }
  }
})