import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import fs from 'fs'
import path from 'path'

// Check if certs exist (only needed for dev server)
const certsPath = path.resolve(__dirname, '../certs')
const hasDevCerts = fs.existsSync(path.join(certsPath, 'localhost.key'))

export default defineConfig({
  plugins: [react()],
  server: hasDevCerts ? {
    port: 43210,
    host: '0.0.0.0',
    https: {
      key: fs.readFileSync(path.join(certsPath, 'localhost.key')),
      cert: fs.readFileSync(path.join(certsPath, 'localhost.crt')),
    },
    proxy: {
      '/api': {
        target: 'http://localhost:43211',
        changeOrigin: true,
      },
    },
  } : {
    port: 43210,
    host: '0.0.0.0',
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
