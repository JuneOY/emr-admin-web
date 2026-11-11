import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import { projectRoot, rendererConfig } from './build/renderer'

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      // xlsx 只用于主进程导出处方库；安装包只打包 out，必须随主进程一起内联。
      externalizeDeps: { exclude: ['xlsx'] },
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
