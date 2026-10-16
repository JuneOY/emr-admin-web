const assert = require('node:assert/strict')
const { join } = require('node:path')
const { writeFile } = require('node:fs/promises')
const { BrowserWindow } = require('electron')
const { require: requireTypeScript } = require('tsx/cjs/api')
const { renderVisitPdf } = requireTypeScript('../electron/main/pdf.ts', __filename)
const { EMPTY_PATIENT, EMPTY_RECORD } = requireTypeScript('../shared/clinical.ts', __filename)
const { recordHtml } = requireTypeScript('../shared/record-layout.ts', __filename)

async function continuousPdfWorkflow({ evaluate, artifacts, firstId, longText }) {
  const result = await evaluate(`window.emrDesktop.clinical('visit', '${firstId}')`)
  assert.equal(result.success, true)
  const specimens = [
    {
      name: 'clinical-prescription-four-columns',
      pages: 1,
      patient: { ...result.data.patient },
      body: {
        ...EMPTY_RECORD,
        narrative: '合成病例，只用于处方排版验证。',
        prescription:
          '四列处方测试\n' +
          Array.from(
            { length: 9 },
            (_, index) =>
              `合成项${index + 1}  测试量 份` +
              (index === 2 ? '  长说明自动换行且完整显示，不影响其他药品的排列。' : '')
          ).join('\n') +
          '\n用法：整体说明保持独立段落。\n备注：末项 END-FOUR'
      }
    },
    {
      name: 'clinical-prescription-four-columns-long',
      pages: 2,
      patient: { ...result.data.patient },
      body: {
        ...EMPTY_RECORD,
        narrative: '合成病例，只用于四列处方跨页验证。',
        prescription:
          '四列长处方测试\n' +
          Array.from({ length: 80 }, (_, index) => `合成项${index + 1}  测试量`).join('\n') +
          '\n用法：长处方末尾 END-FOUR-LONG'
      }
    },
    {
      name: 'clinical-template-empty',
      pages: 1,
      patient: { ...EMPTY_PATIENT, age: '' },
      body: { ...EMPTY_RECORD }
    },
    {
      name: 'clinical-template-short',
      pages: 1,
      patient: {
        ...EMPTY_PATIENT,
        name: '排版测试',
        phone: '13900000000',
        sex: '女',
        age: '36岁',
        birthDate: '1990-01-01',
        maritalStatus: '已婚',
        occupation: '软件验证',
        ethnicity: '汉族',
        address: '仅供软件测试的合成地址'
      },
      body: {
        narrative: '此为合成病情内容，仅用于版式验证。\n原病历单的横线区应能正常填写、换行。',
        mechanism: '病机要点排版测试。',
        diagnosis: '软件测试，不作诊断用途。',
        prescription: '处方区域仅放合成文字。\n不包含药品和用药建议。'
      }
    },
    {
      name: 'clinical-template-growing',
      pages: 1,
      patient: { ...result.data.patient },
      body: {
        narrative: Array.from(
          { length: 12 },
          (_, i) => `病情增高第${i + 1}行：仅作排版测试。`
        ).join('\n'),
        mechanism: '病机第一行。\n病机第二行。\n病机第三行。',
        diagnosis: '诊断第一行。\n诊断第二行。',
        prescription: '处方第一行。\n处方第二行。\n处方第三行。\n末尾验证 END-GROWING'
      }
    },
    {
      name: 'clinical-template-wrapped',
      pages: 2,
      patient: { ...result.data.patient },
      body: {
        narrative:
          Array.from({ length: 90 }, (_, i) => `自动换行内容${i + 1}，`).join('') +
          'NARRATIVE-WRAP-END',
        mechanism: '病机内容也会自动换行。'.repeat(8),
        diagnosis: '诊断内容仅供软件验证。'.repeat(8),
        prescription:
          Array.from({ length: 60 }, (_, i) => `连续处方测试${i + 1}，`).join('') + 'WRAP-END'
      }
    },
    {
      name: 'clinical-template-expanded',
      pages: 3,
      patient: { ...result.data.patient },
      body: {
        narrative: Array.from(
          { length: 48 },
          (_, i) => `长病情第${i + 1}行：验证区域撑高和跨页续写。`
        ).join('\n'),
        mechanism: Array.from(
          { length: 18 },
          (_, i) => `长病机第${i + 1}行：后方栏目必须顺延。`
        ).join('\n'),
        diagnosis: Array.from({ length: 12 }, (_, i) => `长诊断第${i + 1}行：仅作软件测试。`).join(
          '\n'
        ),
        prescription: '长病情后的处方正文必须保留。\n末尾验证 END-EXPANDED'
      }
    }
  ]
  // 检查真实 Chromium 布局：首行四列，尾行一项，长说明撑高同一行。
  const layoutWindow = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true }
  })
  try {
    await layoutWindow.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(recordHtml({ ...result.data, ...specimens[0] }))
    )
    const layout = await layoutWindow.webContents
      .executeJavaScript(`document.fonts.ready.then(() => {
      const rows = Array.from(document.querySelectorAll('.record-prescription-row'))
      const first = Array.from(rows[0].children).map(el => el.getBoundingClientRect())
      return {
        counts: rows.map(row => row.children.length),
        sameTop: first.every(rect => Math.abs(rect.top - first[0].top) < 1),
        separate: first.every((rect, index) => index === 0 || rect.left > first[index - 1].right),
        contained: Array.from(document.querySelectorAll('.record-prescription-item')).every(el => el.scrollWidth <= el.clientWidth + 1),
        grows: rows[0].getBoundingClientRect().height > rows[1].getBoundingClientRect().height
      }
    })`)
    assert.deepEqual(layout, {
      counts: [4, 4, 1],
      sameTop: true,
      separate: true,
      contained: true,
      grows: true
    })
  } finally {
    layoutWindow.destroy()
  }
  for (const specimen of specimens) {
    const bytes = await renderVisitPdf({
      ...result.data,
      patient: specimen.patient,
      body: specimen.body
    })
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
    // Chromium 保留未压缩的页面字典，防止仅为模板留白多生成签字页。
    assert.equal(
      (bytes.toString('latin1').match(/\/Type \/Page\b/g) || []).length,
      specimen.pages,
      `${specimen.name} 的实际分页不符`
    )
    await writeFile(join(artifacts, specimen.name + '.pdf'), bytes)
  }
  const visit = {
    ...result.data,
    body: {
      narrative: longText,
      mechanism: '此内容仅供软件排版验证。',
      diagnosis: '测试病例，不作诊断用途。',
      prescription: Array.from(
        { length: 85 },
        (_, index) => `处方排版验证 ${index + 1}：本行是合成文字，不包含用药建议。`
      ).join('\n')
    }
  }
  const bytes = await renderVisitPdf(visit)
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
  await writeFile(join(artifacts, 'clinical-long-prescription.pdf'), bytes)
}

module.exports = { continuousPdfWorkflow }
