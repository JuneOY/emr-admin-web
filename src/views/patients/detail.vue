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
          :disabled="loading || saving || records.some((item) => !item.id)"
          data-testid="new-visit"
          @click="prepareVisit"
          >新增复诊</ElButton
        >
        <ElButton
          v-if="draft"
          :disabled="loading"
          data-testid="visit-attachments"
          @click="openAttachments"
          >附件</ElButton
        >
        <ElButton
          v-if="draft"
          :disabled="loading"
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
            :disabled="loading"
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
        <RecordEditor v-for="(record, index) in records" :key="index" v-model="records[index]">
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
            </div>
          </template>
          <template #prescription-action>
            <ElButton
              type="primary"
              plain
              size="small"
              data-testid="pick-prescription"
              @click="pickPrescription(record)"
              >引用处方</ElButton
            >
          </template>
        </RecordEditor>
      </div>
    </template>
    <PrescriptionPicker v-model="prescriptionDialog" @apply="applyPrescription" />
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
  import { ArrowLeft } from '@element-plus/icons-vue'
  import {
    ageAt,
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
  import { appendPrescription, type Prescription } from '@shared/prescriptions'
  import type { Attachment } from '@shared/attachments'
  import RecordEditor from './components/RecordEditor.vue'
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
  const { records, draft, dirty, saving, open, append, save, leave } = useRecordDraft((visit) => {
    void refreshPatient(visit.patientId)
  }, syncRoute)
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
      if (request === patientRequest && draft.value?.patientId === id) patient.value = result
    } catch (error) {
      if (request === patientRequest) notifyError(error)
    }
  }
  const prescriptionDialog = ref(false),
    attachmentsVisible = ref(false),
    exportDialog = ref(false)
  const prescriptionTarget = ref<Visit | null>(null)
  const exportVisitId = ref(''),
    exportImages = ref<Attachment[]>([]),
    exportImagesLoading = ref(false)
  function pickPrescription(record: Visit) {
    prescriptionTarget.value = record
    prescriptionDialog.value = true
  }
  async function applyPrescription(prescription: Prescription) {
    const target = prescriptionTarget.value
    if (!target || !records.value.includes(target)) return
    try {
      target.body.prescription = appendPrescription(target.body.prescription, prescription)
      prescriptionDialog.value = false
      if (!target.id) ElMessage.success('处方已引用')
      else if (await saveRecord()) ElMessage.success('处方已引用并保存')
    } catch (error) {
      notifyError(error)
    }
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
  async function syncRoute() {
    if (!draft.value?.id) return
    const patientId = draft.value.patientId
    if (patient.value?.id !== patientId) patient.value = await clinicalCall('patient', patientId)
    if (String(route.params.id) !== patientId || route.query.visit === 'new') {
      const query = { ...route.query }
      delete query.visit
      await router.replace({ path: `/patients/${patientId}`, query })
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
  onBeforeRouteUpdate(leave)
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
