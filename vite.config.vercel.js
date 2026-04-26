import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error',
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    'process.env.VITE_BASE44_APP_ID': JSON.stringify(process.env.VITE_BASE44_APP_ID),
    'process.env.VITE_BASE44_APP_BASE_URL': JSON.stringify(process.env.VITE_BASE44_APP_BASE_URL),
  },
})
