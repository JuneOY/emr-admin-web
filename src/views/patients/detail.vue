<template>
  <section
    v-loading="loading"
    class="min-w-0 w-full"
    aria-label="患者病例"
    data-testid="patient-detail"
  >
    <div
      class="mb-4 flex flex-wrap items-center gap-3 border-b border-[var(--art-card-border)] pb-4"
      data-testid="case-actions"
    >
      <ElButton
        :icon="ArrowLeft"
        circle
        aria-label="返回病例列表"
        title="返回病例列表"
        data-testid="back-to-patients"
        @click="router.push('/patients')"
      />
      <div class="ml-auto flex items-center gap-3 [&>.el-button]:!ml-0">
        <ElButton
          v-if="patient"
          type="primary"
          :disabled="loading || saving || !!deleting || records.some((item) => !item.id)"
          data-testid="new-visit"
          @click="prepareVisit"
          >新增复诊</ElButton
        >
        <ElButton
          v-if="draft"
          :disabled="loading || !!deleting"
          data-testid="visit-attachments"
          @click="openAttachments"
          >附件</ElButton
        >
        <ElButton
          v-if="draft"
          :disabled="loading || !!deleting"
          :loading="exporting"
          data-testid="export-record"
          @click="prepareExport"
          >导出 PDF</ElButton
        >
      </div>
    </div>
    <template v-if="draft">
      <div
        class="sticky z-20 mb-3 flex flex-wrap items-center gap-3 border-b border-[var(--art-card-border)] bg-[var(--default-bg-color)] py-2"
        :style="{ top: `${headerHeight}px` }"
        data-testid="record-toolbar"
      >
        <ElSelect
          v-if="records.length === 1 && !draft.id"
          v-model="draft.doctorId"
          class="!w-32"
          placeholder="接诊医生"
          aria-label="接诊医生"
          :disabled="saving"
          @change="changeDoctor"
        >
          <ElOption
            v-for="doctor in dictionaries.doctors.filter((item) => item.active)"
            :key="doctor.id"
            :value="doctor.id"
            :label="doctor.name"
          />
        </ElSelect>
        <span v-else class="text-sm" data-testid="case-doctor">{{ draft.doctorName }}</span>
        <span class="text-sm text-g-600" data-testid="latest-visit-summary"
          >{{ draft.kind }} · {{ draft.date }}</span
        >
        <div class="ml-auto flex items-center gap-3">
          <span class="text-xs text-g-500" role="status" data-testid="record-save-state">{{
            saving ? '保存中…' : dirty ? '未保存' : draft.id ? '已保存' : '待保存'
          }}</span>
          <ElButton
            type="primary"
            :loading="saving"
            :disabled="loading || !!deleting"
            data-testid="save-record"
            @click="saveRecord"
            >保存</ElButton
          >
        </div>
      </div>
      <div
        class="min-w-0 divide-y divide-[var(--art-card-border)] rounded-lg border border-[var(--art-card-border)] bg-box"
        data-testid="case-records"
      >
        <RecordEditor
          v-for="(record, index) in records"
          :key="recordKey(record)"
          v-model="records[index]"
          :inert="deleting === record"
        >
          <template #metadata>
            <div class="flex flex-wrap items-center gap-2">
              <ElDatePicker
                v-model="record.date"
                type="date"
                value-format="YYYY-MM-DD"
                :clearable="false"
                class="!w-36"
                :aria-label="`${record.kind}日期`"
              />
              <ElSelect
                v-model="record.categoryIds"
                multiple
                collapse-tags
                collapse-tags-tooltip
                :max-collapse-tags="1"
                placeholder="就诊分类"
                class="!w-44"
                aria-label="本次就诊分类"
              >
                <ElOption
                  v-for="item in dictionaries.categories.filter(
                    (item) => item.active || record.categoryIds.includes(item.id)
                  )"
                  :key="item.id"
                  :label="item.name + (item.active ? '' : '（停用）')"
                  :value="item.id"
                />
              </ElSelect>
              <ElButton
                v-if="record.kind === '复诊'"
                type="danger"
                link
                :loading="deleting === record"
                :disabled="loading || saving || !!deleting || exporting"
                data-testid="delete-followup"
                @click="deleteFollowup(record)"
                >删除复诊</ElButton
              >
            </div>
          </template>
          <template #prescription-action="{ editor }">
            <ElDropdown
              trigger="click"
              :disabled="loading || saving || !!deleting"
              @command="(command) => selectPrescription(command, record, editor)"
            >
              <ElButton type="primary" plain size="small" data-testid="pick-prescription">
                引用处方<ArrowDown class="ml-1 size-3" />
              </ElButton>
              <template #dropdown>
                <ElDropdownMenu>
                  <ElDropdownItem
                    command="previous"
                    :disabled="!previousPrescription(records, index).trim()"
                    data-testid="use-previous-prescription"
                    >上次处方</ElDropdownItem
                  >
                  <ElDropdownItem command="library" data-testid="use-library-prescription"
                    >处方库</ElDropdownItem
                  >
                </ElDropdownMenu>
              </template>
            </ElDropdown>
          </template>
        </RecordEditor>
      </div>
    </template>
    <PrescriptionPicker
      v-model="prescriptionDialog"
      @apply="applyPrescription"
      @closed="restorePrescriptionFocus"
    />
    <VisitAttachments
      v-if="savedRecords.length"
      v-model="attachmentsVisible"
      :visits="savedRecords"
    />
    <VisitExportDialog
      v-model="exportDialog"
      v-model:visit-id="exportVisitId"
      :visits="savedRecords"
      :images="exportImages"
      :exporting="exporting"
      :loading="exportImagesLoading"
      @export="exportPdf"
    />
  </section>
</template>

<script setup lang="ts">
  import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
  import { ArrowDown, ArrowLeft } from '@element-plus/icons-vue'
  import {
    ageAt,
    previousPrescription,
    EMPTY_PATIENT,
    EMPTY_RECORD,
    localDate,
    type Patient,
    type Visit
  } from '@shared/clinical'
  import { clinicalCall, exportVisitPdf, notifyError } from '@/services/clinical'
  import { isDesktop } from '@/services/desktop'
  import { useClinicalDictionariesStore } from '@/store/modules/clinical-dictionaries'
  import { useRecordDraft } from './use-record-draft'
  import type { Prescription } from '@shared/prescriptions'
  import type { Attachment } from '@shared/attachments'
  import RecordEditor from './components/RecordEditor.vue'
  import type RecordPrescriptionEditor from './components/RecordPrescriptionEditor.vue'
  import PrescriptionPicker from './components/PrescriptionPicker.vue'
  import VisitAttachments from './components/VisitAttachments.vue'
  import VisitExportDialog from './components/VisitExportDialog.vue'

  const route = useRoute(),
    router = useRouter()
  const headerElement = ref<HTMLElement>()
  const { height: headerHeight } = useElementSize(headerElement)
  const patient = ref<Patient | null>(null)
  const dictionaryStore = useClinicalDictionariesStore()
  const { dictionaries } = storeToRefs(dictionaryStore)
  const loading = ref(false),
    exporting = ref(false)
  const { records, draft, dirty, saving, deleting, open, append, save, remove, leave } =
    useRecordDraft((visit) => {
      void refreshPatient(visit.patientId)
    }, syncRoute)
  const recordKeys = new WeakMap<Visit, number>()
  let recordSequence = 0
  function recordKey(record: Visit) {
    if (!recordKeys.has(record)) recordKeys.set(record, ++recordSequence)
    return recordKeys.get(record)!
  }
  const savedRecords = computed(() => records.value.filter((item) => item.id))
  watchEffect(() => {
    for (const record of records.value)
      record.doctorName = dictionaryStore.doctorName(record.doctorId, record.doctorName)
  })
  let patientRequest = 0,
    pageRequest = 0,
    imageRequest = 0
  async function refreshPatient(id: string) {
    const request = ++patientRequest
    try {
      const result = await clinicalCall('patient', id)
      if (request !== patientRequest || draft.value?.patientId !== id) return false
      patient.value = result
      return true
    } catch (error) {
      if (request === patientRequest) notifyError(error)
      return false
    }
  }
  const prescriptionDialog = ref(false),
    attachmentsVisible = ref(false),
    exportDialog = ref(false)
  const prescriptionTarget = shallowRef<{
    record: Visit
    editor: InstanceType<typeof RecordPrescriptionEditor>
  } | null>(null)
  const exportVisitId = ref(''),
    exportImages = ref<Attachment[]>([]),
    exportImagesLoading = ref(false)
  async function deleteFollowup(record: Visit) {
    const result = await remove(record)
    if (!result) return
    if (prescriptionTarget.value?.record === record) {
      prescriptionDialog.value = false
      prescriptionTarget.value = null
    }
    if (exportVisitId.value === record.id) {
      exportVisitId.value = savedRecords.value.at(-1)?.id || ''
      exportImages.value = []
    }
    if (result.pendingAttachments)
      ElMessage.warning('本次复诊已删除，部分附件暂被占用，将在下次启动时继续清理')
    else ElMessage.success('本次复诊已删除')
    if (patient.value) void refreshPatient(patient.value.id)
    try {
      await syncRoute()
    } catch (error) {
      notifyError(error)
    }
  }
  async function selectPrescription(
    command: string,
    record: Visit,
    editor: InstanceType<typeof RecordPrescriptionEditor>
  ) {
    if (command === 'library') {
      prescriptionTarget.value = { record, editor }
      prescriptionDialog.value = true
      return
    }
    if (command !== 'previous') return
    const prescription = previousPrescription(records.value, records.value.indexOf(record))
    if (!prescription.trim()) {
      ElMessage.info('上次就诊没有处方可引用')
      return
    }
    if (record.body.prescription === prescription) return
    if (record.body.prescription.trim()) {
      try {
        await ElMessageBox.confirm(
          '使用上次处方替换当前处方内容？其他病历栏目不会改变。',
          '引用上次处方',
          {
            confirmButtonText: '替换处方',
            cancelButtonText: '保留当前处方',
            closeOnClickModal: false
          }
        )
      } catch {
        return
      }
    }
    if (!records.value.includes(record)) return
    record.body.prescription = prescription
    if (!record.id) ElMessage.success('已填充上次处方')
    else if (await save(false)) ElMessage.success('上次处方已填充并保存')
  }
  async function applyPrescription(prescription: Prescription) {
    const target = prescriptionTarget.value
    if (!target || !records.value.includes(target.record)) return
    try {
      target.editor.insert(prescription)
      prescriptionDialog.value = false
      if (!target.record.id) ElMessage.success('处方已引用')
      else if (await saveRecord()) ElMessage.success('处方已引用并保存')
    } catch (error) {
      notifyError(error)
    }
  }
  function restorePrescriptionFocus() {
    const target = prescriptionTarget.value
    prescriptionTarget.value = null
    if (target && records.value.includes(target.record)) void target.editor.restoreFocus()
  }
  async function scrollToNewRecord() {
    await nextTick()
    const element = document.querySelector('[data-record-id="new"]')
    const container = document.getElementById('app-main')
    if (element && container)
      container.scrollTo({
        top: container.scrollTop + element.getBoundingClientRect().top - headerHeight.value - 64
      })
  }
  async function prepareVisit() {
    if (!(await saveRecord())) return
    if (patient.value && !(await refreshPatient(patient.value.id))) return
    startDraft()
    await scrollToNewRecord()
  }
  function startDraft() {
    const first = records.value[0]
    const selected = String(route.query.doctor || '')
    const doctor =
      dictionaries.value.doctors.find((item) => item.active && item.id === selected) ||
      dictionaries.value.doctors.find((item) => item.active)
    const details = { ...EMPTY_PATIENT }
    for (const key of Object.keys(details) as (keyof typeof EMPTY_PATIENT)[])
      Object.assign(details, { [key]: patient.value?.[key] ?? EMPTY_PATIENT[key] })
    const date = localDate()
    append({
      id: '',
      patientId: patient.value?.id || '',
      recordNumber: patient.value?.recordNumber || '',
      doctorId: first?.doctorId || doctor?.id || '',
      doctorName: first?.doctorName || doctor?.name || '',
      date,
      kind: first ? '复诊' : '初诊',
      revision: 0,
      createdAt: '',
      updatedAt: '',
      layoutVersion: 1,
      categoryIds: [],
      patient: { ...details, age: ageAt(details.birthDate, date) },
      body: { ...EMPTY_RECORD }
    })
  }
  function changeDoctor() {
    if (draft.value) draft.value.doctorName = dictionaryStore.doctorName(draft.value.doctorId, '')
  }
  let syncingRoute = false
  async function syncRoute() {
    if (!draft.value?.id) return
    const patientId = draft.value.patientId
    if (patient.value?.id !== patientId) patient.value = await clinicalCall('patient', patientId)
    if (String(route.params.id) !== patientId || route.query.visit === 'new') {
      const query = { ...route.query }
      delete query.visit
      syncingRoute = true
      try {
        await router.replace({ path: `/patients/${patientId}`, query })
      } finally {
        syncingRoute = false
      }
    }
  }
  async function saveRecord() {
    if (!(await save())) return false
    try {
      await syncRoute()
      return true
    } catch (error) {
      notifyError(error)
      return false
    }
  }
  async function openAttachments() {
    if (await saveRecord()) attachmentsVisible.value = true
  }
  async function loadExportImages() {
    const request = ++imageRequest
    exportImages.value = []
    if (!exportVisitId.value || !exportDialog.value) return
    exportImagesLoading.value = true
    try {
      const items = await clinicalCall('attachments', exportVisitId.value)
      if (request === imageRequest)
        exportImages.value = items.filter((item) => item.mediaType.startsWith('image/'))
    } catch (error) {
      if (request === imageRequest) {
        exportDialog.value = false
        notifyError(error)
      }
    } finally {
      if (request === imageRequest) exportImagesLoading.value = false
    }
  }
  watch(() => [exportVisitId.value, exportDialog.value], loadExportImages)
  async function prepareExport() {
    if (!draft.value || exporting.value || !(await saveRecord())) return
    exportVisitId.value = draft.value.id
    exportDialog.value = true
  }
  async function exportPdf(imageIds: string[]) {
    if (
      !exportVisitId.value ||
      exporting.value ||
      exportImagesLoading.value ||
      !(await saveRecord())
    )
      return
    exporting.value = true
    try {
      if (await exportVisitPdf({ visitId: exportVisitId.value, imageIds })) {
        exportDialog.value = false
        ElMessage.success('PDF 已导出')
      }
    } catch (error) {
      notifyError(error)
    } finally {
      exporting.value = false
    }
  }
  onBeforeRouteLeave(leave)
  onBeforeRouteUpdate(() => syncingRoute || leave())
  onBeforeUnmount(() => {
    pageRequest++
    patientRequest++
    imageRequest++
  })
  async function loadPage() {
    const patientId = String(route.params.id)
    if (draft.value?.id && draft.value.patientId === patientId && route.query.visit !== 'new')
      return
    const request = ++pageRequest
    patientRequest++
    if (!isDesktop) return
    loading.value = true
    try {
      const [p] = await Promise.all([
        patientId === 'new' ? Promise.resolve(null) : clinicalCall('patient', patientId),
        clinicalCall('dictionaries', null)
      ])
      if (request !== pageRequest) return
      const visits: Visit[] = []
      if (p) {
        let page = 1,
          total = 1
        while (visits.length < total) {
          const result = await clinicalCall('caseVisits', {
            patientId: p.id,
            page: page++,
            pageSize: 100
          })
          if (request !== pageRequest) return
          visits.push(...result.items)
          total = result.total
          if (!result.items.length) break
        }
      }
      patient.value = p
      open(visits)
      if (!visits.length || route.query.visit === 'new') {
        startDraft()
        await scrollToNewRecord()
      }
    } catch (error) {
      if (request === pageRequest) notifyError(error)
    } finally {
      if (request === pageRequest) loading.value = false
    }
  }
  watch(() => [route.params.id, route.query.visit], loadPage, { immediate: true })
  useEventListener(window, 'focus', () => {
    if (isDesktop) void clinicalCall('dictionaries', null).catch(notifyError)
  })
  onMounted(() => {
    headerElement.value = document.getElementById('app-header') || undefined
  })
</script>
