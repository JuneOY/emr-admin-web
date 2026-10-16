<template>
  <ElDrawer
    v-model="visible"
    :title="`${category?.name || '分类'} · 患者`"
    size="min(900px, calc(100vw - 32px))"
    append-to-body
    destroy-on-close
  >
    <div data-testid="category-patients">
      <ElInput
        v-model="keyword"
        placeholder="姓名 / 电话"
        aria-label="分类患者搜索"
        clearable
        class="mb-4 !w-64"
        data-testid="category-patient-search"
        @input="searchChanged"
        @clear="filterChanged"
        @keyup.enter="filterChanged"
      >
        <template #prefix><Search class="size-4" /></template>
      </ElInput>
      <ElTable
        v-loading="loading"
        :data="patients"
        row-key="id"
        :empty-text="keyword ? '暂无匹配的患者' : '该分类暂无患者'"
        @row-dblclick="openPatient"
      >
        <ElTableColumn prop="name" label="姓名" min-width="110" />
        <ElTableColumn label="电话" min-width="140">
          <template #default="{ row }">{{ row.phone || '—' }}</template>
        </ElTableColumn>
        <ElTableColumn prop="visitCount" label="就诊次数" width="100" />
        <ElTableColumn label="最近就诊" min-width="125">
          <template #default="{ row }">{{ row.latestVisitDate || '—' }}</template>
        </ElTableColumn>
        <ElTableColumn label="最近接诊医生" min-width="135">
          <template #default="{ row }">
            {{
              row.latestDoctorId
                ? dictionaryStore.doctorName(row.latestDoctorId, row.latestDoctorName || '—')
                : '—'
            }}
          </template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="100" align="right">
          <template #default="{ row }">
            <ElButton
              link
              type="primary"
              data-testid="category-open-patient"
              @click="openPatient(row)"
            >
              打开病例
            </ElButton>
          </template>
        </ElTableColumn>
      </ElTable>
      <div class="mt-4 flex justify-end">
        <ElPagination
          v-model:current-page="page"
          :page-size="20"
          :total="total"
          layout="total, prev, pager, next"
          @current-change="load"
        />
      </div>
    </div>
  </ElDrawer>
</template>

<script setup lang="ts">
  import { Search } from '@element-plus/icons-vue'
  import type { DictionaryItem, PatientRow } from '@shared/clinical'
  import { clinicalCall, notifyError } from '@/services/clinical'
  import { isDesktop } from '@/services/desktop'
  import { useClinicalDictionariesStore } from '@/store/modules/clinical-dictionaries'

  const visible = defineModel<boolean>({ required: true })
  const props = defineProps<{ category: DictionaryItem | null }>()
  const dictionaryStore = useClinicalDictionariesStore()
  const router = useRouter()
  const keyword = ref(''),
    page = ref(1),
    total = ref(0),
    loading = ref(false)
  const patients = ref<PatientRow[]>([])
  let request = 0,
    timer: ReturnType<typeof setTimeout> | undefined

  async function load() {
    if (!visible.value || !props.category || !isDesktop) return
    const current = ++request
    loading.value = true
    patients.value = []
    try {
      const result = await clinicalCall('patients', {
        keyword: keyword.value,
        doctorId: '',
        categoryId: props.category.id,
        page: page.value,
        pageSize: 20
      })
      if (current !== request) return
      patients.value = result.items
      total.value = result.total
    } catch (error) {
      if (current === request) {
        total.value = 0
        notifyError(error)
      }
    } finally {
      if (current === request) loading.value = false
    }
  }
  function filterChanged() {
    clearTimeout(timer)
    page.value = 1
    void load()
  }
  function searchChanged() {
    clearTimeout(timer)
    // 输入新条件时立即使旧请求失效，避免防抖期间旧结果回填。
    request++
    timer = setTimeout(filterChanged, 250)
  }
  function openPatient(patient: PatientRow) {
    visible.value = false
    void router.push(`/patients/${patient.id}`)
  }
  watch(
    () => [visible.value, props.category?.id],
    () => {
      request++
      clearTimeout(timer)
      keyword.value = ''
      page.value = 1
      patients.value = []
      total.value = 0
      loading.value = false
      void load()
    }
  )
  onBeforeUnmount(() => {
    request++
    clearTimeout(timer)
  })
</script>
