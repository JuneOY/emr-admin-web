import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import { projectRoot, rendererConfig } from './build/renderer'

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: {
          index: resolve(projectRoot, 'electron/main/index.ts'),
          'clinical-worker': resolve(projectRoot, 'electron/main/clinical-worker.ts')
        },
        output: { format: 'es', entryFileNames: '[name].js' }
      }
    }
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: resolve(projectRoot, 'electron/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.cjs', inlineDynamicImports: true }
      }
    }
  },
  renderer: rendererConfig('out/renderer')
})
