<template>
  <div>
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <ElInput
        v-model="query.keyword"
        placeholder="搜索处方名称"
        clearable
        class="!w-64"
        maxlength="80"
        aria-label="搜索处方"
        data-testid="prescription-search"
      />
      <ElSelect
        v-model="query.kind"
        class="!w-40"
        placeholder="全部类型"
        clearable
        aria-label="处方类型筛选"
      >
        <ElOption v-for="kind in PRESCRIPTION_KINDS" :key="kind" :label="kind" :value="kind" />
      </ElSelect>
      <ElCheckbox v-if="!selectable" v-model="query.activeOnly">只看启用</ElCheckbox>
      <slot name="toolbar" />
    </div>
    <ElTable
      v-loading="loading"
      :data="items"
      row-key="id"
      empty-text="暂无处方"
      data-testid="prescription-table"
    >
      <ElTableColumn prop="name" label="处方名称" min-width="160" show-overflow-tooltip />
      <ElTableColumn prop="kind" label="类型" width="140" />
      <ElTableColumn label="药品" min-width="180" show-overflow-tooltip>
        <template #default="{ row }">{{
          row.items.map((item: PrescriptionItem) => item.name).join('、')
        }}</template>
      </ElTableColumn>
      <ElTableColumn v-if="!selectable" label="状态" width="90">
        <template #default="{ row }"
          ><span :class="row.active ? 'text-g-900' : 'text-g-500'">{{
            row.active ? '启用' : '已停用'
          }}</span></template
        >
      </ElTableColumn>
      <ElTableColumn label="操作" :width="selectable ? 90 : 140" align="right">
        <template #default="{ row }"><slot name="actions" :row="row" /></template>
      </ElTableColumn>
    </ElTable>
    <ElPagination
      v-if="total > 20"
      v-model:current-page="query.page"
      :total="total"
      :page-size="20"
      layout="total, prev, pager, next"
      class="mt-4 justify-end"
      @current-change="load"
    />
  </div>
</template>

<script setup lang="ts">
  import {
    PRESCRIPTION_KINDS,
    type Prescription,
    type PrescriptionItem,
    type PrescriptionQuery
  } from '@shared/prescriptions'
  import { clinicalCall, notifyError } from '@/services/clinical'
  import { isDesktop } from '@/services/desktop'
  defineProps<{ selectable?: boolean }>()
  const query = reactive<PrescriptionQuery>({
    keyword: '',
    kind: '',
    activeOnly: true,
    page: 1,
    pageSize: 20
  })
  const items = ref<Prescription[]>([]),
    total = ref(0),
    loading = ref(false)
  let request = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  async function load() {
    if (!isDesktop) return
    const current = ++request
    loading.value = true
    try {
      const result = await clinicalCall('prescriptions', query)
      if (current !== request) return
      items.value = result.items
      total.value = result.total
      if (!items.value.length && total.value && query.page > 1) {
        query.page = 1
        await load()
      }
    } catch (error) {
      if (current === request) notifyError(error)
    } finally {
      if (current === request) loading.value = false
    }
  }
  watch(
    () => [query.keyword, query.kind, query.activeOnly],
    () => {
      request++
      clearTimeout(timer)
      timer = setTimeout(() => {
        query.page = 1
        void load()
      }, 250)
    }
  )
  onMounted(load)
  onBeforeUnmount(() => {
    request++
    clearTimeout(timer)
  })
  defineExpose({ load })
</script>
