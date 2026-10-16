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
      <div class="ml-auto flex gap-3"
        ><ElButton @click="router.push('/clinical-settings')">医生与分类</ElButton
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
      empty-text="暂无病例"
      class="w-full"
    >
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
      <ElTableColumn label="操作" width="225" align="right"
        ><template #default="{ row }"
          ><ElButton link type="primary" @click="openPatient(row)">打开病例</ElButton>
          <ElButton link type="primary" data-testid="follow-up" @click="followUp(row)"
            >复诊</ElButton
          >
          <ElButton
            link
            type="danger"
            :disabled="Boolean(deletingId) || !isDesktop"
            :loading="deletingId === row.id"
            data-testid="delete-case"
            @click.stop="deleteCase(row)"
            @dblclick.stop
            >删除</ElButton
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
  import { clinicalCall, notifyError } from '@/services/clinical'
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
    loading = ref(false),
    deletingId = ref('')
  let request = 0,
    timer: ReturnType<typeof setTimeout> | undefined
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
      const lastPage = Math.max(1, Math.ceil(result.total / query.pageSize))
      if (query.page > lastPage) {
        query.page = lastPage
        await loadPatients()
        return
      }
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
    if (deletingId.value) return
    void router.push({
      path: `/patients/${patient.id}`,
      query: query.doctorId ? { doctor: query.doctorId } : {}
    })
  }
  function followUp(patient: Patient) {
    if (deletingId.value) return
    void router.push({
      path: `/patients/${patient.id}`,
      query: { visit: 'new', ...(query.doctorId ? { doctor: query.doctorId } : {}) }
    })
  }
  async function deleteCase(patient: PatientRow) {
    if (deletingId.value || !isDesktop) return
    deletingId.value = patient.id
    try {
      try {
        await ElMessageBox.confirm(
          `确认删除“${patient.name}”（${patient.recordNumber}）的整份病例？将删除患者资料、全部 ${patient.visitCount} 次就诊及关联附件，删除后无法直接撤销。`,
          '删除病例',
          {
            confirmButtonText: '删除整份病例',
            cancelButtonText: '取消',
            confirmButtonClass: 'el-button--danger',
            closeOnClickModal: false
          }
        )
      } catch {
        return
      }
      try {
        const result = await clinicalCall('deleteCase', {
          patientId: patient.id,
          revision: patient.revision,
          updatedAt: patient.updatedAt,
          visitCount: patient.visitCount
        })
        if (result.pendingAttachments)
          ElMessage.warning('病例已删除，剩余附件文件将在下次启动时继续清理')
        else ElMessage.success('病例已删除')
      } catch (error) {
        notifyError(error)
      }
      await loadPatients()
    } finally {
      deletingId.value = ''
    }
  }
  onMounted(async () => {
    void useDesktopStore().load()
    if (!isDesktop) return
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
  })
  useEventListener(window, 'focus', () => {
    if (isDesktop) void clinicalCall('dictionaries', null).catch(notifyError)
  })
</script>
