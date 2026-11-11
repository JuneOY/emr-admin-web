<template>
  <section class="w-full" aria-label="病例" data-testid="patients-page">
    <ElTabs v-model="query.doctorId" @tab-change="filterChanged">
      <ElTabPane label="全部患者" name="" />
      <ElTabPane
        v-for="doctor in dictionaries.doctors"
        :key="doctor.id"
        :name="doctor.id"
        :label="doctor.name + (doctor.active ? '' : '（停用）')"
      />
    </ElTabs>
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <ElInput
        v-model="query.keyword"
        placeholder="姓名 / 电话"
        clearable
        class="!w-64"
        data-testid="patient-search"
        @input="searchChanged"
        @clear="filterChanged"
        @keyup.enter="filterChanged"
        ><template #prefix><Search class="size-4" /></template
      ></ElInput>
      <ElSelect
        v-model="query.categoryId"
        placeholder="就诊分类"
        clearable
        class="!w-40"
        @change="filterChanged"
        ><ElOption
          v-for="item in dictionaries.categories"
          :key="item.id"
          :value="item.id"
          :label="item.name + (item.active ? '' : '（停用）')"
      /></ElSelect>
      <div class="ml-auto flex items-center gap-3"
        ><span v-if="exporting && progressTotal" class="text-sm text-g-600" role="status"
          >正在导出 {{ progressDone }}/{{ progressTotal }}</span
        ><ElButton @click="router.push('/clinical-settings')">医生与分类</ElButton
        ><ElButton
          :disabled="!isDesktop || !selection.length || exporting"
          :loading="exporting"
          data-testid="batch-export-cases"
          @click="exportSelectedCases"
          >批量导出 PDF{{ selection.length ? `（${selection.length}）` : '' }}</ElButton
        ><ElButton
          type="primary"
          :disabled="!isDesktop"
          data-testid="new-case"
          @click="
            router.push({
              path: '/patients/new',
              query: query.doctorId ? { doctor: query.doctorId } : {}
            })
          "
          >新建病例</ElButton
        ></div
      >
    </div>
    <ElTable
      v-loading="loading"
      :data="patients"
      row-key="id"
      @row-dblclick="openPatient"
      @selection-change="selectionChanged"
      empty-text="暂无病例"
      class="w-full"
    >
      <ElTableColumn v-if="isDesktop" type="selection" width="44" />
      <ElTableColumn prop="recordNumber" label="病案号" width="135" />
      <ElTableColumn prop="name" label="姓名" min-width="120"
        ><template #default="{ row }"
          ><ElButton link type="primary" @click="openPatient(row)">{{
            row.name
          }}</ElButton></template
        ></ElTableColumn
      >
      <ElTableColumn prop="sex" label="性别" width="75" />
      <ElTableColumn prop="phone" label="电话" min-width="145"
        ><template #default="{ row }">{{ row.phone || '—' }}</template></ElTableColumn
      >
      <ElTableColumn prop="visitCount" label="就诊次数" width="100" />
      <ElTableColumn prop="latestVisitDate" label="最近就诊" min-width="130"
        ><template #default="{ row }">{{ row.latestVisitDate || '—' }}</template></ElTableColumn
      >
      <ElTableColumn label="最近接诊医生" min-width="140">
        <template #default="{ row }">
          <span data-testid="latest-doctor">{{
            row.latestDoctorId
              ? dictionaryStore.doctorName(row.latestDoctorId, row.latestDoctorName || '—')
              : '—'
          }}</span>
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作" width="170" align="right"
        ><template #default="{ row }"
          ><ElButton link type="primary" @click="openPatient(row)">打开病例</ElButton>
          <ElButton link type="primary" data-testid="follow-up" @click="followUp(row)"
            >复诊</ElButton
          ></template
        ></ElTableColumn
      >
    </ElTable>
    <div class="mt-4 flex justify-end"
      ><ElPagination
        v-model:current-page="query.page"
        :page-size="query.pageSize"
        :total="total"
        layout="total, prev, pager, next"
        @current-change="loadPatients"
    /></div>
  </section>
</template>

<script setup lang="ts">
  import { Search } from '@element-plus/icons-vue'
  import type { Patient, PatientQuery, PatientRow } from '@shared/clinical'
  import { MAX_BATCH_PATIENTS } from '@shared/exports'
  import { clinicalCall, notifyError } from '@/services/clinical'
  import { exportCases, onCaseExportProgress } from '@/services/exports'
  import { isDesktop } from '@/services/desktop'
  import { useDesktopStore } from '@/store/modules/desktop'
  import { useClinicalDictionariesStore } from '@/store/modules/clinical-dictionaries'
  const router = useRouter()
  const dictionaryStore = useClinicalDictionariesStore()
  const { dictionaries } = storeToRefs(dictionaryStore)
  const query = reactive<PatientQuery>({
    keyword: '',
    doctorId: '',
    categoryId: '',
    page: 1,
    pageSize: 20
  })
  const patients = ref<PatientRow[]>([]),
    total = ref(0),
    loading = ref(false)
  const selection = ref<PatientRow[]>([]),
    exporting = ref(false),
    progressDone = ref(0),
    progressTotal = ref(0)
  let request = 0,
    timer: ReturnType<typeof setTimeout> | undefined,
    stopProgress: (() => void) | undefined
  async function loadPatients() {
    if (!isDesktop) return
    const current = ++request
    loading.value = true
    try {
      const result = await clinicalCall('patients', {
        ...query,
        categoryId: query.categoryId || ''
      })
      if (current !== request) return
      patients.value = result.items
      total.value = result.total
    } catch (error) {
      if (current === request) notifyError(error)
    } finally {
      if (current === request) loading.value = false
    }
  }
  function filterChanged() {
    clearTimeout(timer)
    query.page = 1
    void loadPatients()
  }
  function searchChanged() {
    clearTimeout(timer)
    timer = setTimeout(filterChanged, 250)
  }
  function openPatient(patient: Patient) {
    void router.push({
      path: `/patients/${patient.id}`,
      query: query.doctorId ? { doctor: query.doctorId } : {}
    })
  }
  function followUp(patient: Patient) {
    void router.push({
      path: `/patients/${patient.id}`,
      query: { visit: 'new', ...(query.doctorId ? { doctor: query.doctorId } : {}) }
    })
  }
  function selectionChanged(rows: PatientRow[]) {
    selection.value = rows
  }
  async function exportSelectedCases() {
    if (exporting.value || !selection.value.length) return
    if (selection.value.length > MAX_BATCH_PATIENTS) {
      ElMessage.warning({
        message: `每次最多导出 ${MAX_BATCH_PATIENTS} 位患者的病例`,
        grouping: true
      })
      return
    }
    exporting.value = true
    progressDone.value = 0
    progressTotal.value = 0
    try {
      const result = await exportCases({
        patientIds: selection.value.map((item) => item.id)
      })
      if (!result) return
      const notes = [
        result.failed ? `${result.failed} 份生成失败` : '',
        result.withoutImages ? `${result.withoutImages} 份图片超过 100 MB，仅导出文字` : ''
      ].filter(Boolean)
      if (notes.length)
        ElMessage.warning({
          message: `已导出 ${result.exported} 份病历，${notes.join('，')}`,
          grouping: true
        })
      else ElMessage.success(`已导出 ${result.exported} 份病历`)
    } catch (error) {
      notifyError(error)
    } finally {
      exporting.value = false
      progressDone.value = 0
      progressTotal.value = 0
    }
  }
  onMounted(async () => {
    void useDesktopStore().load()
    if (!isDesktop) return
    stopProgress = onCaseExportProgress((progress) => {
      progressDone.value = progress.completed
      progressTotal.value = progress.total
    })
    try {
      await clinicalCall('dictionaries', null)
      await loadPatients()
    } catch (error) {
      notifyError(error)
    }
  })
  onBeforeUnmount(() => {
    request++
    clearTimeout(timer)
    stopProgress?.()
  })
  useEventListener(window, 'focus', () => {
    if (isDesktop) void clinicalCall('dictionaries', null).catch(notifyError)
  })
</script>
