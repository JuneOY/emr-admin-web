<template>
  <ElDialog
    v-model="visible"
    :title="prescription ? '编辑处方' : '新建处方'"
    width="820px"
    destroy-on-close
    :close-on-click-modal="false"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    :before-close="beforeClose"
  >
    <ElForm label-position="top" :disabled="saving" @submit.prevent="save">
      <div class="grid grid-cols-[1fr_200px] gap-4">
        <ElFormItem label="处方名称"
          ><ElInput v-model="form.name" maxlength="80" data-testid="prescription-name"
        /></ElFormItem>
        <ElFormItem label="类型"
          ><ElSelect v-model="form.kind" aria-label="处方类型"
            ><ElOption
              v-for="kind in PRESCRIPTION_KINDS"
              :key="kind"
              :label="kind"
              :value="kind" /></ElSelect
        ></ElFormItem>
      </div>
      <div
        class="mb-2 grid grid-cols-[2fr_90px_70px_2fr_46px] gap-2 text-xs text-g-600"
        aria-hidden="true"
      >
        <span>药品名称</span><span>用量</span><span>单位</span><span>药品用法／说明</span
        ><span></span>
      </div>
      <div class="max-h-64 space-y-2 overflow-y-auto pr-1">
        <div
          v-for="(item, index) in form.items"
          :key="index"
          class="grid grid-cols-[2fr_90px_70px_2fr_46px] gap-2"
        >
          <ElInput
            v-model="item.name"
            :aria-label="`药品${index + 1}名称`"
            maxlength="80"
            :data-testid="`drug-name-${index}`"
          />
          <ElInput v-model="item.amount" :aria-label="`药品${index + 1}用量`" maxlength="30" />
          <ElInput v-model="item.unit" :aria-label="`药品${index + 1}单位`" maxlength="20" />
          <ElInput v-model="item.usage" :aria-label="`药品${index + 1}用法`" maxlength="160" />
          <ElButton
            link
            :disabled="form.items.length === 1"
            :aria-label="`移除药品${index + 1}`"
            @click="form.items.splice(index, 1)"
            >移除</ElButton
          >
        </div>
      </div>
      <ElButton
        link
        type="primary"
        class="my-3"
        :disabled="form.items.length >= 80"
        @click="form.items.push(emptyItem())"
        >添加药品</ElButton
      >
      <ElFormItem :label="form.kind === '中药饮片' ? '剂数与煎服方法' : '整体用法说明'">
        <ElInput
          v-model="form.usage"
          type="textarea"
          :rows="2"
          maxlength="1500"
          data-testid="prescription-usage"
        />
      </ElFormItem>
      <ElFormItem label="备注"
        ><ElInput v-model="form.notes" type="textarea" :rows="2" maxlength="1500"
      /></ElFormItem>
      <div class="flex items-center justify-between">
        <ElCheckbox v-model="form.active">启用</ElCheckbox>
        <div
          ><ElButton @click="beforeClose(() => (visible = false))">取消</ElButton
          ><ElButton
            type="primary"
            native-type="submit"
            :loading="saving"
            data-testid="prescription-submit"
            >保存</ElButton
          ></div
        >
      </div>
    </ElForm>
  </ElDialog>
</template>

<script setup lang="ts">
  import { ElMessageBox } from 'element-plus'
  import { onBeforeRouteLeave } from 'vue-router'
  import {
    PRESCRIPTION_KINDS,
    parsePrescription,
    type Prescription,
    type PrescriptionInput
  } from '@shared/prescriptions'
  import { clinicalCall, notifyError } from '@/services/clinical'
  import { registerPageSaveGuard } from '@/services/page-save-guard'
  const visible = defineModel<boolean>({ required: true })
  const props = defineProps<{ prescription: Prescription | null }>()
  const emit = defineEmits<{ saved: [] }>()
  const emptyItem = () => ({ name: '', amount: '', unit: '', usage: '' })
  const form = ref<PrescriptionInput>({
    id: null,
    revision: 0,
    name: '',
    kind: '中药饮片',
    items: [emptyItem()],
    usage: '',
    notes: '',
    active: true
  })
  const saving = ref(false)
  let original = ''
  watch(visible, (open) => {
    if (!open) return
    const value = props.prescription
    form.value = value
      ? {
          id: value.id,
          revision: value.revision,
          name: value.name,
          kind: value.kind,
          items: JSON.parse(JSON.stringify(value.items)),
          usage: value.usage,
          notes: value.notes,
          active: value.active
        }
      : {
          id: null,
          revision: 0,
          name: '',
          kind: '中药饮片',
          items: [emptyItem()],
          usage: '',
          notes: '',
          active: true
        }
    original = JSON.stringify(form.value)
  })
  async function canLeave() {
    if (saving.value) {
      ElMessage.info('处方正在保存')
      return false
    }
    if (!visible.value || JSON.stringify(form.value) === original) return true
    try {
      await ElMessageBox.confirm('放弃尚未保存的处方修改？', '关闭处方', {
        confirmButtonText: '放弃修改',
        cancelButtonText: '继续编辑',
        closeOnClickModal: false
      })
      return true
    } catch {
      return false
    }
  }
  async function beforeClose(done: () => void) {
    if (await canLeave()) done()
  }
  async function save() {
    if (saving.value) return
    saving.value = true
    try {
      await clinicalCall('savePrescription', parsePrescription(form.value))
      visible.value = false
      emit('saved')
      ElMessage.success('处方已保存')
    } catch (error) {
      notifyError(error)
    } finally {
      saving.value = false
    }
  }
  onBeforeRouteLeave(canLeave)
  const dispose = registerPageSaveGuard(canLeave)
  onBeforeUnmount(dispose)
</script>
