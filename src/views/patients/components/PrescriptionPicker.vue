<template>
  <ElDialog
    v-model="visible"
    title="引用处方"
    width="900px"
    destroy-on-close
    :close-on-click-modal="false"
  >
    <PrescriptionBrowser v-if="visible" selectable>
      <template #actions="{ row }"
        ><ElButton link type="primary" @click="select(row.id)">选择</ElButton></template
      >
    </PrescriptionBrowser>
    <div v-if="selected" class="mt-4 border-t border-[var(--art-card-border)] pt-4">
      <pre
        class="max-h-48 overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-6 text-g-900"
        data-testid="prescription-preview"
        >{{ prescriptionText(selected) }}</pre
      >
    </div>
    <template #footer
      ><span class="mr-4 text-xs text-g-500">追加到本次处方，可继续修改</span
      ><ElButton
        :disabled="!selected || loading"
        type="primary"
        data-testid="prescription-apply"
        @click="selected && emit('apply', selected)"
        >引用到病历</ElButton
      ></template
    >
  </ElDialog>
</template>

<script setup lang="ts">
  import { prescriptionText, type Prescription } from '@shared/prescriptions'
  import { clinicalCall, notifyError } from '@/services/clinical'
  import PrescriptionBrowser from '@/views/prescriptions/components/PrescriptionBrowser.vue'
  const visible = defineModel<boolean>({ required: true })
  const emit = defineEmits<{ apply: [prescription: Prescription] }>()
  const selected = ref<Prescription | null>(null),
    loading = ref(false)
  let request = 0
  watch(visible, () => {
    request++
    selected.value = null
    loading.value = false
  })
  async function select(id: string) {
    const current = ++request
    selected.value = null
    loading.value = true
    try {
      const item = await clinicalCall('prescription', id)
      if (current !== request) return
      if (!item.active) throw new Error('该处方已停用')
      selected.value = item
    } catch (error) {
      if (current === request) notifyError(error)
    } finally {
      if (current === request) loading.value = false
    }
  }
</script>
