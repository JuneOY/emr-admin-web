<template>
  <ElDrawer
    v-model="visible"
    title="病例附件"
    size="760px"
    :close-on-click-modal="false"
    :before-close="beforeClose"
  >
    <VisitSelector v-model="visitId" :visits="visits" :disabled="importing || busy" class="mb-4" />
    <div v-if="visit" class="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <span class="font-medium text-g-900">{{ visit.patient.name }}</span
      ><span class="text-g-600">{{ visit.date }} · {{ visit.kind }} · {{ visit.doctorName }}</span>
    </div>
    <div class="mb-4 flex items-center gap-3">
      <ElSelect v-model="kind" class="!w-32" aria-label="附件分类"
        ><ElOption v-for="item in ATTACHMENT_KINDS" :key="item" :label="item" :value="item"
      /></ElSelect>
      <ElButton
        type="primary"
        :loading="importing"
        :disabled="!visit || busy"
        data-testid="attachment-import"
        @click="add"
        >添加附件</ElButton
      >
      <span class="ml-auto text-xs text-g-500">图片、PDF，单个 ≤20 MB</span>
    </div>
    <ElTable
      v-loading="loading"
      :data="items"
      row-key="id"
      empty-text="本次就诊暂无附件"
      data-testid="attachment-table"
    >
      <ElTableColumn label="附件" min-width="180">
        <template #default="{ row }"
          ><button
            type="button"
            class="max-w-full truncate text-left text-[var(--el-color-primary)]"
            :title="row.name"
            @click="preview(row)"
            >{{ row.name }}</button
          ><div class="text-xs text-g-500">{{ row.kind }} · {{ fileSize(row.size) }}</div></template
        >
      </ElTableColumn>
      <ElTableColumn label="上传时间" width="145"
        ><template #default="{ row }"
          ><span class="text-xs">{{
            new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false })
          }}</span></template
        ></ElTableColumn
      >
      <ElTableColumn label="操作" width="155" align="right"
        ><template #default="{ row }"
          ><ElButton link :disabled="busy" @click="download(row)">导出原件</ElButton
          ><ElButton link :disabled="busy" @click="remove(row)">移除</ElButton></template
        ></ElTableColumn
      >
    </ElTable>
    <ElDialog
      v-model="previewVisible"
      :title="previewName"
      width="80%"
      append-to-body
      destroy-on-close
      @closed="clearPreview"
    >
      <div v-loading="previewLoading" class="flex min-h-60 items-center justify-center">
        <iframe
          v-if="previewUrl && previewMedia === 'application/pdf'"
          :src="previewUrl"
          class="h-[65vh] w-full border-0"
          title="PDF 附件预览"
          data-testid="attachment-pdf-preview"
        ></iframe>
        <img
          v-else-if="previewUrl"
          :src="previewUrl"
          :alt="previewName"
          class="max-h-[65vh] max-w-full object-contain"
          data-testid="attachment-image-preview"
          @error="previewFailed"
        />
      </div>
    </ElDialog>
  </ElDrawer>
</template>

<script setup lang="ts">
  import { ElMessageBox } from 'element-plus'
  import type { Visit } from '@shared/clinical'
  import VisitSelector from './VisitSelector.vue'
  import { ATTACHMENT_KINDS, type Attachment, type AttachmentKind } from '@shared/attachments'
  import {
    clinicalCall,
    importAttachments,
    readAttachment,
    exportAttachment,
    removeAttachment,
    notifyError
  } from '@/services/clinical'
  const visible = defineModel<boolean>({ required: true })
  const props = defineProps<{ visits: Visit[] }>()
  const visitId = ref('')
  const visit = computed(() => props.visits.find((item) => item.id === visitId.value))
  watch(visible, (value) => {
    if (value) visitId.value = props.visits.at(-1)?.id || ''
  })
  const items = ref<Attachment[]>([]),
    kind = ref<AttachmentKind>('舌苔照')
  const loading = ref(false),
    importing = ref(false),
    busy = ref(false)
  const previewVisible = ref(false),
    previewLoading = ref(false),
    previewUrl = ref(''),
    previewName = ref(''),
    previewMedia = ref('')
  let request = 0,
    previewRequest = 0
  const fileSize = (size: number) =>
    size < 1024 * 1024
      ? `${Math.max(1, Math.round(size / 1024))} KB`
      : `${(size / 1024 / 1024).toFixed(1)} MB`
  async function load() {
    const current = ++request
    loading.value = true
    try {
      const result = await clinicalCall('attachments', visitId.value)
      if (current === request) items.value = result
    } catch (error) {
      if (current === request) notifyError(error)
    } finally {
      if (current === request) loading.value = false
    }
  }
  watch(
    () => [visible.value, visitId.value],
    () => {
      request++
      items.value = []
      if (visible.value && visitId.value) void load()
    },
    { immediate: true }
  )
  function beforeClose(done: () => void) {
    if (importing.value || busy.value) {
      ElMessage.info('附件正在处理，请等待完成')
      return
    }
    previewVisible.value = false
    done()
  }
  async function add() {
    if (importing.value || !visit.value) return
    importing.value = true
    const selectedId = visitId.value
    try {
      const result = await importAttachments({ visitId: selectedId, kind: kind.value })
      if (!result) return
      if (selectedId === visitId.value && visible.value) await load()
      ElMessage.success(
        result.skipped
          ? `已添加 ${result.added.length} 个附件，跳过 ${result.skipped} 个重复文件`
          : `已添加 ${result.added.length} 个附件`
      )
    } catch (error) {
      notifyError(error)
    } finally {
      importing.value = false
    }
  }
  function clearPreview() {
    previewRequest++
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = ''
  }
  function previewFailed() {
    notifyError(new Error('图片无法预览，请检查原始图片是否完整'))
    previewVisible.value = false
  }
  async function preview(row: Attachment) {
    clearPreview()
    const current = ++previewRequest
    previewName.value = row.name
    previewVisible.value = true
    previewLoading.value = true
    try {
      const result = await readAttachment(row.id)
      if (current !== previewRequest || !previewVisible.value) return
      previewMedia.value = result.attachment.mediaType
      previewUrl.value = URL.createObjectURL(
        new Blob([new Uint8Array(result.bytes)], { type: result.attachment.mediaType })
      )
    } catch (error) {
      if (current === previewRequest) {
        previewVisible.value = false
        notifyError(error)
      }
    } finally {
      if (current === previewRequest) previewLoading.value = false
    }
  }
  async function download(row: Attachment) {
    if (busy.value) return
    busy.value = true
    try {
      if (await exportAttachment(row.id)) ElMessage.success('附件原件已导出')
    } catch (error) {
      notifyError(error)
    } finally {
      busy.value = false
    }
  }
  async function remove(row: Attachment) {
    if (busy.value) return
    busy.value = true
    try {
      try {
        await ElMessageBox.confirm(`移除“${row.name}”？该附件将从本次就诊中删除。`, '移除附件', {
          confirmButtonText: '移除',
          cancelButtonText: '取消',
          closeOnClickModal: false
        })
      } catch {
        return
      }
      await removeAttachment(row.id)
      await load()
      ElMessage.success('附件已移除')
    } catch (error) {
      notifyError(error)
    } finally {
      busy.value = false
    }
  }
  onBeforeUnmount(() => {
    request++
    clearPreview()
  })
</script>
