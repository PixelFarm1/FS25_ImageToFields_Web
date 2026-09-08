import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The pipeline lives in ../core and is shared verbatim with the CLI, so Vite
// needs permission to serve files from outside this app directory.
export default defineConfig({
  plugins: [react()],
  base: './',
  worker: { format: 'es' },
  server: { fs: { allow: ['..', '../..'] } },
})
