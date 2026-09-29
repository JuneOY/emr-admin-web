import { defineConfig } from 'vite'
import { rendererConfig } from './build/renderer'

export default defineConfig(rendererConfig('dist'))
