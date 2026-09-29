import { ageValue, maritalStatusValue, type RecordBody, type Visit } from './clinical'
import type { Attachment } from './attachments'

export interface RecordImage {
  attachment: Attachment
  source: string
}

export type RecordField = keyof RecordBody
export const MAX_RECORD_PAGES = 100
export const RECORD_FIELDS: RecordField[] = ['narrative', 'mechanism', 'diagnosis', 'prescription']
export const FIELD_LABELS: Record<RecordField, string> = {
  narrative: '病情记录',
  mechanism: '病机要点',
  diagnosis: '中医诊断',
  prescription: '处方'
}

// 仅作容量上限检查，使用保守行宽和行数估算，不切割正文。
export function estimateRecordPages(body: RecordBody): number {
  let lines = 12
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' })
  for (const field of RECORD_FIELDS) {
    let used = 0
    lines++
    for (const { segment } of segmenter.segment(body[field])) {
      if (segment === '\n') {
        lines++
        used = 0
        continue
      }
      const width = segment === '\t' ? 2.4 : /^[\x20-\x7e]$/.test(segment) ? 0.65 : 1
      if (used + width > 44) {
        lines++
        used = 0
      }
      used += width
    }
  }
  return Math.ceil(lines / 32)
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!
  )
}

// 打印独立恢复原病历单的表格和横线样式；保留自然续页，不能按固定纸页裁切正文。
export const RECORD_CSS = `
@page {
  size: a4 portrait;
  margin: 14mm 14mm 18mm;
}

html,
body {
  width: 182mm;
  padding: 0;
  margin: 0;
  font: 16px/8mm SimSun, 'Songti SC', serif;
  color: #000;
  background: white;
}

* {
  box-sizing: border-box;
}

.record-header {
  margin-bottom: 2mm;
  break-inside: avoid;
  break-after: avoid;
}

.record-title {
  margin: 0 0 3mm;
  font-family: SimHei, 'Songti SC', serif;
  font-size: 26px;
  font-weight: normal;
  line-height: 10mm;
  text-align: center;
  letter-spacing: 6px;
}

.record-meta {
  display: flex;
  gap: 4mm;
  justify-content: space-between;
  font-size: 14px;
  line-height: 7mm;
}

.record-sheet {
  border: 1px solid #333;
  box-decoration-break: clone;
}

.record-patient {
  break-inside: avoid;
  break-after: avoid;
}

.record-patient-row {
  display: grid;
  grid-template-columns: 2.5fr 1.2fr 1.2fr 1.4fr;
  border-bottom: 1px solid #333;
}

.record-address-row {
  grid-template-columns: 3.7fr 1.2fr 1.4fr;
}

.record-contact-row {
  grid-template-columns: 1fr 1fr;
}

.record-followup-row {
  grid-template-columns: 1fr;
}

.record-patient-field {
  display: flex;
  align-items: stretch;
  min-width: 0;
  min-height: 9mm;
  border-right: 1px solid #333;
}

.record-patient-field:last-child {
  border-right: 0;
}

.record-patient-label {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  padding: 1mm 2mm;
  font-size: 14px;
  white-space: nowrap;
  border-right: 1px solid #333;
}

.record-patient-value {
  flex: 1;
  min-width: 0;
  padding: 1mm 2mm;
  font-size: 15px;
  line-height: 7mm;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.record-text {
  margin: 0;
  overflow-wrap: anywhere;
  orphans: 2;
  tab-size: 4;
  white-space: pre-wrap;
  widows: 2;
}

.record-narrative {
  min-height: 56mm;
  padding: 0 3mm;
  background-image: radial-gradient(circle at 0.25mm 7.75mm, #999 0.12mm, transparent 0.16mm);
  background-size: 1mm 8mm;
  box-decoration-break: clone;
}

.record-line-section {
  min-height: 8mm;
  padding: 0 3mm;
  border-top: 1px solid #333;
}

.record-line-label {
  white-space: nowrap;
}

.record-prescription {
  padding: 0 3mm 5mm;
  border-top: 1px solid #333;
}

.record-prescription h2 {
  margin: 0;
  font-size: 16px;
  font-weight: normal;
  line-height: 8mm;
  break-after: avoid;
}

.record-prescription .record-text {
  min-height: 96mm;
  break-after: avoid;
}

.record-signature {
  margin-top: 8mm;
  text-align: right;
  break-inside: avoid;
}

.record-signature-value {
  display: inline-block;
  min-width: 30mm;
  text-align: left;
}

.record-attachment {
  display: flex;
  flex-direction: column;
  height: 264mm;
  break-before: page;
  break-inside: avoid;
}

.record-attachment .record-title {
  font-size: 18px;
  letter-spacing: 1px;
}

.record-attachment-meta {
  margin-bottom: 4mm;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.record-attachment-image {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 0;
}

.record-attachment-image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
`

export function recordHtml(visit: Visit, images: RecordImage[] = []): string {
  const e = escapeHtml,
    p = visit.patient
  const field = (label: string, value: string) =>
    `<div class="record-patient-field"><span class="record-patient-label">${label}</span><span class="record-patient-value">${e(value)}</span></div>`
  const [year, month, day] = visit.date.split('-')
  const contact =
    p.phone || p.birthDate
      ? `<div class="record-patient-row record-contact-row">${field('联系电话', p.phone)}${field('出生日期', p.birthDate)}</div>`
      : ''
  const patientInfo =
    visit.kind === '复诊'
      ? `<div class="record-patient-row record-followup-row">${field('姓名', p.name)}</div>`
      : `<div class="record-patient-row">${field('姓名', p.name)}${field('性别', p.sex === '未填' ? '' : p.sex)}${field('年龄', ageValue(p.age))}${field('婚否', maritalStatusValue(p.maritalStatus))}</div>
        <div class="record-patient-row record-address-row">${field('家庭住址', p.address)}${field('职业', p.occupation)}${field('民族', p.ethnicity)}</div>${contact}`
  const document = `<article class="record-document">
    <header class="record-header">
      <h1 class="record-title">${visit.kind}病例</h1>
      <div class="record-meta"><span>病案号：${e(visit.recordNumber)}</span><span>${e(visit.kind)}</span><span>${e(year)} 年 ${e(month)} 月 ${e(day)} 日</span></div>
    </header>
    <div class="record-sheet">
      <div class="record-patient">
        ${patientInfo}
      </div>
      <div class="record-text record-narrative" data-field="narrative" aria-label="病情记录">${e(visit.body.narrative)}</div>
      ${(['mechanism', 'diagnosis'] as const).map((key) => `<div class="record-line-section" data-field="${key}"><span class="record-line-label">${FIELD_LABELS[key]}：</span><span class="record-text">${e(visit.body[key])}</span></div>`).join('')}
      <section class="record-prescription" data-field="prescription">
        <h2>处方：</h2>
        <div class="record-text">${e(visit.body.prescription)}</div>
        <div class="record-signature">医师签字：<span class="record-signature-value">${e(visit.doctorName)}</span></div>
      </section>
    </div>
  </article>`
  const imageHtml = images
    .map(({ attachment, source }) => {
      if (!/^image-\d+\.(jpg|png|webp)$/.test(source)) throw new Error('打印图片来源不正确')
      return `<article class="record-attachment">
      <h1 class="record-title">就诊附件 · ${e(attachment.kind)}</h1>
      <div class="record-meta"><span>${e(p.name)} · ${e(visit.recordNumber)}</span><span>${e(visit.date)} · ${e(visit.kind)} · ${e(visit.doctorName)}</span></div>
      <div class="record-attachment-meta">${e(attachment.name)}<br>上传时间：${e(new Date(attachment.createdAt).toLocaleString('zh-CN', { hour12: false }))}</div>
      <div class="record-attachment-image"><img src="${source}" alt="${e(attachment.name)}"></div>
    </article>`
    })
    .join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline';"><title>${visit.kind}病例</title><style>${RECORD_CSS}</style></head><body>${document}${imageHtml}</body></html>`
}
