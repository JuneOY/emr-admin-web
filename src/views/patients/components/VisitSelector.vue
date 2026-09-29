<template>
  <div class="flex flex-wrap items-center gap-3" data-testid="visit-selector">
    <ElRadioGroup
      :model-value="selected?.kind"
      :disabled="disabled"
      aria-label="初诊复诊归属"
      @update:model-value="changeKind"
    >
      <ElRadioButton
        v-for="kind in ['初诊', '复诊']"
        :key="kind"
        :value="kind"
        :disabled="!visits.some((visit) => visit.kind === kind)"
        >{{ kind }}</ElRadioButton
      >
    </ElRadioGroup>
    <ElSelect v-model="visitId" :disabled="disabled" class="!w-60" aria-label="就诊单据">
      <ElOption
        v-for="(visit, index) in matching"
        :key="visit.id"
        :value="visit.id"
        :label="`${visit.date} · ${visit.kind === '复诊' ? `第 ${index + 1} 次复诊` : '初诊'}`"
      />
    </ElSelect>
  </div>
</template>

<script setup lang="ts">
  import type { VisitSummary } from '@shared/clinical'
  const visitId = defineModel<string>({ required: true })
  const props = defineProps<{ visits: VisitSummary[]; disabled?: boolean }>()
  const selected = computed(() => props.visits.find((visit) => visit.id === visitId.value))
  const matching = computed(() =>
    props.visits.filter((visit) => visit.kind === selected.value?.kind)
  )
  function changeKind(kind: string | number | boolean | undefined) {
    visitId.value = props.visits.findLast((visit) => visit.kind === kind)?.id || ''
  }
</script>
