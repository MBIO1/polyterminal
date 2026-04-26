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
      '@/lib/AuthContext': path.resolve(__dirname, './src/lib/AuthContext.vercel.jsx'),
    },
  },
  define: {
    'process.env.VITE_BASE44_APP_ID': JSON.stringify('c8d42feec2f84be1baa9f06400b2509f'),
    'process.env.VITE_BASE44_APP_BASE_URL': JSON.stringify('https://polytrade.base44.app'),
  },
})
