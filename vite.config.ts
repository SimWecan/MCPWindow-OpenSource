import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: true,
    port: 7100,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/react') || id.includes('/node_modules/scheduler/')) return 'react-vendor'
          if (id.includes('/node_modules/zustand/') || id.includes('/node_modules/dayjs/')) return 'state-vendor'
        },
      },
    },
  },
})
