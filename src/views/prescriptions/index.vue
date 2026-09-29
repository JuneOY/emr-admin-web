<template>
  <section aria-label="处方库" data-testid="prescriptions-page">
    <PrescriptionBrowser ref="browser">
      <template #toolbar
        ><ElButton
          type="primary"
          class="ml-auto"
          :disabled="!isDesktop"
          data-testid="new-prescription"
          @click="edit(null)"
          >新建处方</ElButton
        ></template
      >
      <template #actions="{ row }"
        ><ElButton link type="primary" @click="edit(row)">编辑</ElButton
        ><ElButton link :disabled="saving" @click="toggle(row)">{{
          row.active ? '停用' : '启用'
        }}</ElButton></template
      >
    </PrescriptionBrowser>
    <PrescriptionDialog v-model="dialog" :prescription="selected" @saved="browser?.load()" />
  </section>
</template>

<script setup lang="ts">
  import type { Prescription } from '@shared/prescriptions'
  import { clinicalCall, notifyError } from '@/services/clinical'
  import { isDesktop } from '@/services/desktop'
  import PrescriptionBrowser from './components/PrescriptionBrowser.vue'
  import PrescriptionDialog from './components/PrescriptionDialog.vue'
  const browser = ref<InstanceType<typeof PrescriptionBrowser>>()
  const dialog = ref(false),
    selected = ref<Prescription | null>(null),
    saving = ref(false)
  function edit(row: Prescription | null) {
    selected.value = row
    dialog.value = true
  }
  async function toggle(row: Prescription) {
    if (saving.value) return
    saving.value = true
    try {
      const { createdAt: _created, updatedAt: _updated, ...input } = row
      void [_created, _updated]
      await clinicalCall('savePrescription', { ...input, active: !row.active })
      await browser.value?.load()
      ElMessage.success(row.active ? '处方已停用' : '处方已启用')
    } catch (error) {
      notifyError(error)
    } finally {
      saving.value = false
    }
  }
</script>
