import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' keeps asset paths relative so a production build can be opened
// directly or hosted anywhere without server config.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5180, open: false, strictPort: false },
})
