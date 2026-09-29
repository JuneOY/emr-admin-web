<template>
  <ElDialog
    v-model="visible"
    title="导出病例"
    width="560px"
    :close-on-click-modal="false"
    :show-close="!exporting"
    :close-on-press-escape="!exporting"
  >
    <VisitSelector v-model="visitId" :visits="visits" :disabled="exporting" class="mb-4" />
    <p class="mb-3 text-sm text-g-600"
      >勾选的图片将按列表顺序附在病历后，PDF 报告请在附件中导出原件。</p
    >
    <ElCheckboxGroup
      v-model="selected"
      v-loading="loading"
      :disabled="exporting || loading"
      class="max-h-80 overflow-y-auto"
      data-testid="export-images"
    >
      <ElCheckbox
        v-for="item in images"
        :key="item.id"
        :value="item.id"
        class="!mx-0 flex w-full"
        :title="item.name"
        ><span class="text-g-500">{{ item.kind }}</span
        ><span class="ml-3">{{ item.name }}</span></ElCheckbox
      >
    </ElCheckboxGroup>
    <template #footer
      ><ElButton :disabled="exporting" @click="visible = false">取消</ElButton
      ><ElButton
        type="primary"
        :loading="exporting"
        :disabled="loading || !visitId"
        data-testid="confirm-export-record"
        @click="emit('export', [...selected])"
        >{{ selected.length ? `导出病历及 ${selected.length} 张图片` : '仅导出文字病历' }}</ElButton
      ></template
    >
  </ElDialog>
</template>

<script setup lang="ts">
  import type { Attachment } from '@shared/attachments'
  import type { VisitSummary } from '@shared/clinical'
  import VisitSelector from './VisitSelector.vue'
  const visible = defineModel<boolean>({ required: true })
  const visitId = defineModel<string>('visitId', { required: true })
  const props = defineProps<{
    visits: VisitSummary[]
    images: Attachment[]
    exporting: boolean
    loading: boolean
  }>()
  const emit = defineEmits<{ export: [imageIds: string[]] }>()
  const selected = ref<string[]>([])
  watch(visible, () => {
    selected.value = []
  })
  watch(
    () => props.images,
    () => {
      selected.value = []
    }
  )
</script>
