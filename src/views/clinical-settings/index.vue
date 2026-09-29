<template>
  <section aria-label="医生与分类" data-testid="clinical-settings-page">
    <ElTabs v-model="kind"
      ><ElTabPane label="医生" name="doctor" /><ElTabPane label="就诊分类" name="category"
    /></ElTabs>
    <div class="mb-4 flex items-center justify-end"
      ><ElButton
        type="primary"
        :disabled="!isDesktop || loading"
        data-testid="dictionary-add"
        @click="edit()"
        >{{ kind === 'doctor' ? '添加医生' : '添加分类' }}</ElButton
      ></div
    >
    <ElTable
      v-loading="loading"
      :data="items"
      row-key="id"
      :empty-text="kind === 'doctor' ? '尚未添加医生' : '尚未添加分类'"
    >
      <ElTableColumn
        prop="name"
        :label="kind === 'doctor' ? '医生姓名' : '分类名称'"
        min-width="180"
      />
      <ElTableColumn label="状态" width="120"
        ><template #default="{ row }"
          ><span :class="row.active ? 'text-g-900' : 'text-g-500'">{{
            row.active ? '启用' : '已停用'
          }}</span></template
        ></ElTableColumn
      >
      <ElTableColumn label="操作" width="180" align="right"
        ><template #default="{ row }"
          ><ElButton link type="primary" @click="edit(row)">编辑</ElButton
          ><ElButton link :disabled="saving" @click="toggle(row)">{{
            row.active ? '停用' : '启用'
          }}</ElButton></template
        ></ElTableColumn
      >
    </ElTable>
    <ElDialog
      v-model="dialog"
      :title="kind === 'doctor' ? '医生资料' : '就诊分类'"
      width="400px"
      :close-on-click-modal="false"
    >
      <ElForm label-position="top" @submit.prevent="save"
        ><ElFormItem :label="kind === 'doctor' ? '医生姓名' : '分类名称'"
          ><ElInput v-model="form.name" maxlength="40" data-testid="dictionary-name" /></ElFormItem
        ><div class="flex justify-end"
          ><ElButton @click="dialog = false">取消</ElButton
          ><ElButton
            type="primary"
            native-type="submit"
            :loading="saving"
            data-testid="dictionary-submit"
            >保存</ElButton
          ></div
        ></ElForm
      >
    </ElDialog>
  </section>
</template>

<script setup lang="ts">
  import type { DictionaryInput, DictionaryItem, DictionaryKind } from '@shared/clinical'
  import { clinicalCall, notifyError } from '@/services/clinical'
  import { isDesktop } from '@/services/desktop'
  import { useClinicalDictionariesStore } from '@/store/modules/clinical-dictionaries'
  const kind = ref<DictionaryKind>('doctor'),
    dialog = ref(false),
    loading = ref(false),
    saving = ref(false)
  const { dictionaries: data } = storeToRefs(useClinicalDictionariesStore())
  const items = computed(() =>
    kind.value === 'doctor' ? data.value.doctors : data.value.categories
  )
  const form = reactive<DictionaryInput>({
    kind: 'doctor',
    id: null,
    name: '',
    active: true,
    revision: 0
  })
  async function load() {
    if (!isDesktop) return
    loading.value = true
    try {
      await clinicalCall('dictionaries', null)
    } catch (error) {
      notifyError(error)
    } finally {
      loading.value = false
    }
  }
  function edit(item?: DictionaryItem) {
    Object.assign(form, {
      kind: kind.value,
      id: item?.id ?? null,
      name: item?.name ?? '',
      active: item?.active ?? true,
      revision: item?.revision ?? 0
    })
    dialog.value = true
  }
  async function persist(input: DictionaryInput) {
    if (saving.value) return
    saving.value = true
    try {
      await clinicalCall('saveDictionary', input)
      dialog.value = false
      await load()
      ElMessage.success('已保存')
    } catch (error) {
      notifyError(error)
    } finally {
      saving.value = false
    }
  }
  const save = () => persist({ ...form })
  const toggle = (item: DictionaryItem) =>
    persist({ ...item, kind: kind.value, active: !item.active })
  onMounted(load)
</script>
