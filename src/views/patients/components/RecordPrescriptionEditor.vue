<template>
  <ElInput
    ref="input"
    :model-value="draft"
    type="textarea"
    :autosize="{ minRows: 3 }"
    :maxlength="20000"
    placeholder="直接填写，或从处方库引用…"
    data-field="prescription"
    aria-label="处方"
    resize="none"
    :spellcheck="false"
    @update:model-value="update"
    @focus="rememberSelection"
    @click="rememberSelection"
    @keyup="rememberSelection"
    @select="rememberSelection"
    @blur="formatOnBlur"
  />
</template>

<script setup lang="ts">
  import type { InputInstance } from 'element-plus'
  import {
    formatPrescriptionEdit,
    formatPrescriptionText,
    type PrescriptionSelection
  } from '@shared/prescription-layout'
  import { insertPrescription, type PrescriptionInput } from '@shared/prescriptions'

  const input = ref<InputInstance>()
  const model = defineModel<string>({ required: true })
  const draft = ref(formatPrescriptionText(model.value))
  let selection: PrescriptionSelection | null = null
  watch(model, (value) => {
    // 自身输入不重新排版，保留光标位置；外部引用或刷新时再应用四项一行。
    if (value !== draft.value) {
      draft.value = formatPrescriptionText(value)
      selection = null
    }
  })
  function update(value: string) {
    draft.value = value
    model.value = value
    rememberSelection()
  }
  function readSelection() {
    const textarea = input.value?.textarea
    if (textarea) selection = { start: textarea.selectionStart, end: textarea.selectionEnd }
  }
  function rememberSelection() {
    if (document.activeElement === input.value?.textarea) readSelection()
  }
  function formatOnBlur() {
    readSelection()
    const result = formatPrescriptionEdit(
      draft.value,
      selection || { start: draft.value.length, end: draft.value.length }
    )
    update(result.text)
    selection = result.selection
  }
  function insert(prescription: PrescriptionInput) {
    rememberSelection()
    const result = insertPrescription(draft.value, prescription, selection || undefined)
    update(result.text)
    selection = result.selection
  }
  async function restoreFocus() {
    await nextTick()
    const textarea = input.value?.textarea
    if (!textarea) return
    const range = selection || { start: draft.value.length, end: draft.value.length }
    textarea.focus({ preventScroll: true })
    textarea.setSelectionRange(range.start, range.end)
    selection = range
  }
  defineExpose({ insert, restoreFocus })
</script>
