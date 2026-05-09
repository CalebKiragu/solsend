import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    watch: { usePolling: true }
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // Polyfill Node.js built-ins for browser
      buffer: 'buffer',
    },
  },
  define: {
    // Required by @solana/web3.js and @coral-xyz/anchor
    'global': 'globalThis',
    'process.env': '{}',
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
    include: ['buffer'],
  },
}) 