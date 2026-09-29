import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import type { UserConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import ElementPlus from 'unplugin-element-plus/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { readFileSync } from 'node:fs'

export const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const version = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')).version

export function rendererConfig(outDir: string): UserConfig {
  return {
    root: projectRoot,
    cacheDir: resolve(
      projectRoot,
      outDir === 'dist' ? 'node_modules/.vite-web' : 'node_modules/.vite-electron'
    ),
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __INTLIFY_JIT_COMPILATION__: true,
      __VUE_I18N_LEGACY_API__: false
    },
    resolve: {
      alias: {
        '@': resolve(projectRoot, 'src'),
        '@shared': resolve(projectRoot, 'shared'),
        '@views': resolve(projectRoot, 'src/views'),
        '@imgs': resolve(projectRoot, 'src/assets/images'),
        '@icons': resolve(projectRoot, 'src/assets/icons'),
        '@utils': resolve(projectRoot, 'src/utils'),
        '@stores': resolve(projectRoot, 'src/store'),
        '@styles': resolve(projectRoot, 'src/assets/styles')
      }
    },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    // 提前处理自动导入的组件样式，避免首次打开页面时重新预构建并中断路由加载。
    optimizeDeps: {
      include: [
        'element-plus/es',
        'element-plus/es/components/**/style/css',
        '@element-plus/icons-vue'
      ]
    },
    build: {
      outDir: resolve(projectRoot, outDir),
      emptyOutDir: true,
      target: 'es2022',
      minify: 'esbuild',
      rollupOptions: { input: resolve(projectRoot, 'index.html') }
    },
    plugins: [
      vue(),
      tailwindcss(),
      AutoImport({
        imports: ['vue', 'vue-router', 'pinia', '@vueuse/core'],
        dts: 'src/types/import/auto-imports.d.ts',
        resolvers: [ElementPlusResolver()],
        eslintrc: { enabled: true, filepath: './.auto-import.json', globalsPropValue: true }
      }),
      Components({
        dts: 'src/types/import/components.d.ts',
        resolvers: [ElementPlusResolver()]
      }),
      ElementPlus({ useSource: false })
    ],
    css: {
      preprocessorOptions: {
        scss: {
          additionalData:
            '@use "@styles/core/el-light.scss" as *; @use "@styles/core/mixin.scss" as *;'
        }
      }
    }
  }
}
