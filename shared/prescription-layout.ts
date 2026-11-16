export const PRESCRIPTION_COLUMNS = 4
export const PRESCRIPTION_ITEM_GAP = '    '

export type PrescriptionBlock = { kind: 'text'; text: string } | { kind: 'items'; items: string[] }
export type PrescriptionRun = PrescriptionBlock & { start: number; end: number }
export interface PrescriptionSelection {
  start: number
  end: number
}

export function prescriptionItemRows(items: string[]): string[][] {
  const rows: string[][] = []
  for (let index = 0; index < items.length; index += PRESCRIPTION_COLUMNS)
    rows.push(items.slice(index, index + PRESCRIPTION_COLUMNS))
  return rows
}

// 兼容旧引用处方的双空格字段；自由文字及用法、备注保持原有段落。
export function prescriptionBlocks(value: string): PrescriptionBlock[] {
  return prescriptionRuns(value).map((block) =>
    block.kind === 'text'
      ? { kind: 'text', text: block.text }
      : { kind: 'items', items: block.items }
  )
}

export function prescriptionRuns(value: string): PrescriptionRun[] {
  const blocks: PrescriptionRun[] = []
  let items: string[] = [],
    lines: string[] = [],
    description = false,
    offset = 0,
    itemStart = 0,
    itemEnd = 0,
    textStart = 0,
    textEnd = 0
  const flushItems = () => {
    if (items.length) blocks.push({ kind: 'items', items, start: itemStart, end: itemEnd })
    items = []
  }
  const flushText = () => {
    if (lines.length)
      blocks.push({ kind: 'text', text: lines.join('\n'), start: textStart, end: textEnd })
    lines = []
  }
  for (const line of value.split('\n')) {
    if (!line.trim()) description = false
    if (/^\s*(用法|备注)\s*[:：]/.test(line)) description = true
    const entries = line.split(PRESCRIPTION_ITEM_GAP)
    const drugLine =
      entries.length > 1 ? entries.every((entry) => entry.trim().length > 0) : /\S {2}\S/.test(line)
    if (!description && drugLine) {
      flushText()
      if (!items.length) itemStart = offset
      itemEnd = offset + line.length
      items.push(...entries)
    } else {
      flushItems()
      if (!lines.length) textStart = offset
      textEnd = offset + line.length
      lines.push(line)
    }
    offset += line.length + 1
  }
  flushItems()
  flushText()
  return blocks
}

export function formatPrescriptionText(value: string): string {
  const formatted = prescriptionBlocks(value)
    .map((block) =>
      block.kind === 'text'
        ? block.text
        : prescriptionItemRows(block.items)
            .map((row) => row.join(PRESCRIPTION_ITEM_GAP))
            .join('\n')
    )
    .join('\n')
  // 旧内容已接近容量上限时保留原文，不能因显示排版使病历无法保存。
  return formatted.length <= 20000 ? formatted : value
}

// 排版只调整药品间空白，按原字符位置映射选区，避免失焦换行后插入错位。
export function formatPrescriptionEdit(value: string, selection: PrescriptionSelection) {
  const formatted = formatPrescriptionText(value)
  const mapOffset = (position: number) => {
    const offset = Math.max(0, Math.min(position, value.length))
    let source = 0,
      target = 0
    while (source < offset) {
      if (/\s/.test(value[source])) {
        const start = source,
          targetStart = target
        while (source < value.length && /\s/.test(value[source])) source++
        while (target < formatted.length && /\s/.test(formatted[target])) target++
        if (offset < source) return targetStart + Math.min(offset - start, target - targetStart)
      } else {
        source++
        target++
      }
    }
    return target
  }
  return {
    text: formatted,
    selection: { start: mapOffset(selection.start), end: mapOffset(selection.end) }
  }
}
