import type { App } from 'vue'
import { setupRippleDirective } from './business/ripple'

export function setupGlobDirectives(app: App) {
  setupRippleDirective(app)
}
