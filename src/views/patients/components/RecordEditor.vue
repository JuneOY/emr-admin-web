<template>
  <article
    class="record-document min-w-0 px-5 py-5"
    :aria-label="`${model.kind}病例`"
    data-testid="record-document"
    :data-record-id="model.id || 'new'"
    :data-doctor-id="model.doctorId"
  >
    <div
      class="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--art-card-border)] pb-3"
    >
      <h2 class="text-base font-medium text-g-900">{{ model.kind }}病例</h2>
      <slot name="metadata" />
    </div>
    <div class="grid grid-cols-4 gap-x-5 gap-y-4 max-xl:grid-cols-2">
      <label class="min-w-0 text-xs text-g-600"
        >姓名
        <ElInput
          v-model="model.patient.name"
          class="mt-1"
          maxlength="40"
          placeholder="患者姓名"
          aria-label="患者姓名"
          data-testid="patient-name"
        />
      </label>
      <template v-if="model.kind === '初诊'">
        <label class="min-w-0 text-xs text-g-600"
          >联系电话
          <ElInput
            v-model="model.patient.phone"
            class="mt-1"
            maxlength="30"
            placeholder="选填"
            aria-label="联系电话"
            data-testid="patient-phone"
          />
        </label>
        <label class="min-w-0 text-xs text-g-600"
          >性别
          <ElSelect v-model="model.patient.sex" class="mt-1" aria-label="患者性别">
            <ElOption v-for="sex in ['未填', '男', '女']" :key="sex" :label="sex" :value="sex" />
          </ElSelect>
        </label>
        <label class="min-w-0 text-xs text-g-600"
          >年龄
          <ElInput
            v-model="model.patient.age"
            class="mt-1"
            maxlength="16"
            placeholder="如 36"
            aria-label="年龄"
            @blur="model.patient.age = ageValue(model.patient.age)"
          />
        </label>
        <label class="min-w-0 text-xs text-g-600"
          >婚否
          <ElSelect
            v-model="model.patient.maritalStatus"
            clearable
            class="mt-1"
            placeholder="选填"
            aria-label="婚否"
          >
            <ElOption label="是" value="是" />
            <ElOption label="否" value="否" />
          </ElSelect>
        </label>
        <label class="min-w-0 text-xs text-g-600"
          >出生日期
          <ElDatePicker
            :model-value="model.patient.birthDate"
            class="mt-1 !w-full"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选填"
            aria-label="出生日期"
            @update:model-value="setBirthDate"
          />
        </label>
        <label v-for="field in detailFields" :key="field.key" class="min-w-0 text-xs text-g-600"
          >{{ field.label }}
          <ElInput
            v-model="model.patient[field.key]"
            class="mt-1"
            :maxlength="field.max"
            placeholder="选填"
            :aria-label="field.label"
          />
        </label>
        <label class="col-span-full text-xs text-g-600"
          >家庭住址
          <ElInput
            v-model="model.patient.address"
            class="mt-1"
            maxlength="120"
            placeholder="选填"
            aria-label="家庭住址"
          />
        </label>
      </template>
    </div>
    <div
      class="mt-5 divide-y divide-[var(--art-card-border)] border-t border-[var(--art-card-border)]"
    >
      <section
        v-for="field in fields"
        :key="field.key"
        class="py-4 last:pb-0"
        :aria-label="field.label"
      >
        <div class="mb-2 flex items-center justify-between gap-3">
          <label
            :for="`record-${model.id || 'new'}-${field.key}`"
            class="text-sm font-medium text-g-800"
            >{{ field.label }}</label
          >
          <slot v-if="field.key === 'prescription'" name="prescription-action" />
        </div>
        <ElInput
          :id="`record-${model.id || 'new'}-${field.key}`"
          v-model="model.body[field.key]"
          type="textarea"
          :autosize="{ minRows: field.rows }"
          :maxlength="field.max"
          :placeholder="field.placeholder"
          :data-field="field.key"
          :aria-label="field.label"
          resize="none"
          :spellcheck="false"
        />
      </section>
    </div>
    <div
      class="record-signature mt-5 flex justify-end border-t border-[var(--art-card-border)] pt-3 text-sm text-g-600"
      >接诊医生：{{ model.doctorName || '待选择' }}</div
    >
  </article>
</template>

<script setup lang="ts">
  import { ageAt, ageValue, type Visit } from '@shared/clinical'
  const model = defineModel<Visit>({ required: true })
  const detailFields = [
    { key: 'occupation', label: '职业', max: 30 },
    { key: 'ethnicity', label: '民族', max: 20 }
  ] as const
  const fields = [
    {
      key: 'narrative',
      label: '病情记录',
      rows: 4,
      max: 20000,
      placeholder: '记录症状、病程和检查情况…'
    },
    { key: 'mechanism', label: '病机要点', rows: 2, max: 4000, placeholder: '填写病机要点…' },
    { key: 'diagnosis', label: '中医诊断', rows: 2, max: 4000, placeholder: '填写诊断…' },
    {
      key: 'prescription',
      label: '处方',
      rows: 3,
      max: 20000,
      placeholder: '直接填写，或从处方库引用…'
    }
  ] as const
  function setBirthDate(value: string | null) {
    model.value.patient.birthDate = value || ''
    model.value.patient.age = ageAt(value || '', model.value.date)
  }
</script>

<style scoped>
  .record-document :deep(.el-input__wrapper),
  .record-document :deep(.el-select__wrapper) {
    padding-inline: 0;
    background: transparent;
    border-bottom: 1px solid var(--art-card-border);
    border-radius: 0;
    box-shadow: none;
  }

  .record-document :deep(.el-input__wrapper.is-focus),
  .record-document :deep(.el-select__wrapper.is-focused) {
    border-bottom-color: var(--el-color-primary);
  }

  .record-document :deep(.el-textarea__inner) {
    padding: 4px 0;
    font-size: 14px;
    line-height: 1.9;
    border-radius: 0;
    box-shadow: none;
  }

  .record-document :deep(.el-textarea__inner:focus) {
    outline: 1px solid var(--el-color-primary-light-7);
    outline-offset: 4px;
  }
</style>
