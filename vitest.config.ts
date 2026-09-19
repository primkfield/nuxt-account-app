import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  define: { 'import.meta.client': 'true' },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'], restoreMocks: true },
})
