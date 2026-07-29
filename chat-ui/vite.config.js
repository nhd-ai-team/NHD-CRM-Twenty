import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/chat/',
  server: {
    port: 3003,
    host: true,
    allowedHosts: ['crm.chinanhd.com', 'localhost'],
    // base '/chat/' 会被前缀，这里只写 '/__vite_hmr'，最终为 '/chat/__vite_hmr'（nginx 已代理该路径）。
    hmr: { path: '/__vite_hmr' },
  },
})
