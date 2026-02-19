/**
 * Vitest Configuration
 *
 * Unit test configuration for Halo's main process services.
 * Tests run in Node.js environment with Electron APIs mocked.
 */

import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Test file patterns
    include: [
      'unit/**/*.test.ts',
      '../src/main/services/agent/__tests__/ask-user-question-flow.test.ts',
      '../src/main/services/agent/__tests__/message-flow.ask-user-question-status.test.ts',
      '../src/main/services/agent/__tests__/message-parser.visibility.test.ts',
      '../src/main/services/agent/__tests__/message-flow.final-content.test.ts',
      '../src/main/services/agent/__tests__/sdk-config.builder.strict-space.test.ts',
      '../src/main/services/agent/__tests__/renderer-comm.resource-guard.test.ts',
      '../src/main/services/agent/__tests__/skill-expander.space-only.test.ts',
      '../src/main/services/__tests__/toolkit.service.test.ts',
      '../src/main/services/__tests__/workflow.service.space-only.test.ts',
      '../src/main/services/__tests__/resource-copy-by-ref.test.ts',
      '../src/renderer/api/__tests__/transport.process.test.ts',
      '../src/renderer/api/__tests__/api.process.test.ts',
      '../src/renderer/components/chat/__tests__/message-list.thought-priority.test.ts',
      '../src/renderer/components/chat/__tests__/thought-process.visibility.test.ts',
      '../src/renderer/stores/__tests__/chat.store.ask-user-question.test.ts'
    ],

    // Root directory for tests
    root: __dirname,

    // Global test timeout (10 seconds)
    testTimeout: 10000,

    // Setup files to run before each test file
    setupFiles: ['./unit/setup.ts'],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['../src/main/services/**/*.ts'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.d.ts'
      ]
    },

    // Reporter configuration
    reporters: ['default'],

    // Fail fast on first error in CI
    bail: process.env.CI ? 1 : 0
  },

  resolve: {
    alias: {
      // Allow importing from src
      '@main': path.resolve(__dirname, '../src/main'),
      '@renderer': path.resolve(__dirname, '../src/renderer')
    }
  }
})
