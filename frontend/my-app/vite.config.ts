import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
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
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');

          if (normalizedId.includes('/node_modules/')) {
            if (
              normalizedId.includes('@met4citizen/talkinghead') ||
              normalizedId.includes('/three/')
            ) {
              return 'operator-3d';
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

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv', '**/*.glb'],
})
