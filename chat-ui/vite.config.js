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
    hmr: { path: '/chat/__vite_hmr' },
  },
})
