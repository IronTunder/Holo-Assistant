import { defineConfig, type Plugin } from 'vite'
import { existsSync, readFileSync } from 'node:fs'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const VOSK_BROWSER_VENDOR_PATH = '/vendor/vosk-browser.js'
const VOSK_BROWSER_SOURCE_PATH = path.resolve(__dirname, 'node_modules/vosk-browser/dist/vosk.js')
const HTTPS_CERT_PATH = path.resolve(__dirname, '../../certs/ditto.crt')
const HTTPS_KEY_PATH = path.resolve(__dirname, '../../certs/ditto.key')
const HTTPS_CONFIG = existsSync(HTTPS_CERT_PATH) && existsSync(HTTPS_KEY_PATH)
  ? {
      cert: readFileSync(HTTPS_CERT_PATH),
      key: readFileSync(HTTPS_KEY_PATH),
    }
  : undefined

const DEFAULT_BACKEND_TARGET = 'https://127.0.0.1:8000'

function resolveBackendTarget(): string {
  const configuredUrl = process.env.VITE_API_URL?.trim()

  if (!configuredUrl) {
    return DEFAULT_BACKEND_TARGET
  }

  try {
    return new URL(configuredUrl).origin
  } catch {
    return configuredUrl
  }
}

function voskBrowserVendorPlugin(): Plugin {
  return {
    name: 'ditto-vosk-browser-vendor',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(VOSK_BROWSER_VENDOR_PATH, (_request, response) => {
        response.setHeader('Content-Type', 'application/javascript')
        response.end(readFileSync(VOSK_BROWSER_SOURCE_PATH))
      })
    },
  }
}

function voskBrowserBuildAssetPlugin(): Plugin {
  return {
    name: 'ditto-vosk-browser-build-asset',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: VOSK_BROWSER_VENDOR_PATH.replace(/^\//, ''),
        source: readFileSync(VOSK_BROWSER_SOURCE_PATH),
      })
    },
  }
}

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    voskBrowserVendorPlugin(),
    voskBrowserBuildAssetPlugin(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['@met4citizen/talkinghead'],
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');

          if (normalizedId.includes('/node_modules/')) {
            if (
              normalizedId.includes('@met4citizen/talkinghead') ||
              normalizedId.includes('/three/')
            ) {
              return 'avatar-3d';
            }
          }

          if (normalizedId.includes('/src/features/admin/')) {
            return 'admin';
          }

          if (
            normalizedId.includes('/src/features/operator/') ||
            normalizedId.includes('/src/shared/api/ttsClient.ts')
          ) {
            return 'operator';
          }
        },
      },
    },
  },

  server: {
    https: HTTPS_CONFIG,
    proxy: {
      '/auth': {
        target: resolveBackendTarget(),
        changeOrigin: true,
        secure: false,
      },
      '/machines': {
        target: resolveBackendTarget(),
        changeOrigin: true,
        secure: false,
      },
      '/admin/': {
        target: resolveBackendTarget(),
        changeOrigin: true,
        secure: false,
      },
      '/api': {
        target: resolveBackendTarget(),
        changeOrigin: true,
        secure: false,
      },
      '/tts': {
        target: resolveBackendTarget(),
        changeOrigin: true,
        secure: false,
      },
      '/health': {
        target: resolveBackendTarget(),
        changeOrigin: true,
        secure: false,
      },
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv', '**/*.glb'],
})
