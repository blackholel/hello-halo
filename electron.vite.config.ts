import { resolve } from 'path'
import { readFileSync, existsSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * Load environment variables from .env.local
 * These will be injected at build time via `define`
 */
function loadEnvLocal(): Record<string, string> {
  const envPath = resolve(__dirname, '.env.local')
  const env: Record<string, string> = {}

  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) continue

      const eqIndex = trimmed.indexOf('=')
      if (eqIndex > 0) {
        const key = trimmed.slice(0, eqIndex).trim()
        let value = trimmed.slice(eqIndex + 1).trim()
        // Remove surrounding quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        env[key] = value
      }
    }
  }

  return env
}

const envLocal = loadEnvLocal()

/**
 * Build-time injected analytics config
 * In open-source builds without .env.local, these will be empty strings (analytics disabled)
 */
const analyticsDefine = {
  '__HALO_GA_MEASUREMENT_ID__': JSON.stringify(envLocal.HALO_GA_MEASUREMENT_ID || ''),
  '__HALO_GA_API_SECRET__': JSON.stringify(envLocal.HALO_GA_API_SECRET || ''),
  '__HALO_BAIDU_SITE_ID__': JSON.stringify(envLocal.HALO_BAIDU_SITE_ID || ''),
}

/**
 * Get Vite dev server port from environment variable
 * Allows running multiple instances in parallel (e.g., different git worktrees)
 */
function getVitePort(): number {
  const envPort = process.env.VITE_PORT
  if (envPort) {
    const parsed = parseInt(envPort, 10)
    if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
      return parsed
    }
  }
  return 5173
}

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin()
    ],
    define: analyticsDefine,
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        },
        output: {
          format: 'es',
          entryFileNames: '[name].mjs'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        },
        output: {
          format: 'es',
          entryFileNames: '[name].mjs'
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    server: {
      port: getVitePort()
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay.html')
        }
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer')
      }
    }
  }
})
