import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The engine tests spawn `node` per subcommand, so they are slower than the unit tests.
    testTimeout: 20_000
  },
  resolve: {
    alias: {
      '@lib': resolve(__dirname, 'plugin/lib'),
      '@mcp': resolve(__dirname, 'plugin/mcp')
    }
  }
})
