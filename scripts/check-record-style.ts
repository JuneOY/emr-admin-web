import stylelint from 'stylelint'
import { RECORD_CSS } from '../shared/record-layout'

// PDF 使用连续打印样式，对字符串中的 CSS 也执行相同规则。
const result = await stylelint.lint({ code: RECORD_CSS, codeFilename: 'shared/record-style.css' })
const warnings = result.results.flatMap((file) => file.warnings)
if (warnings.length) {
  console.error(warnings.map((warning) => `${warning.line}: ${warning.text}`).join('\n'))
  process.exitCode = 1
} else console.log('固定 A4 纸张样式检查通过')
