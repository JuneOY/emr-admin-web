<template>
  <ElIcon v-if="icon" class="art-svg-icon inline" v-bind="$attrs">
    <component :is="resolvedIcon" />
  </ElIcon>
</template>
<script setup lang="ts">
  import { resolveLocalIcon } from './local-icons'
  defineOptions({ name: 'ArtSvgIcon', inheritAttrs: false })
  const props = defineProps<{ icon?: string }>()
  const resolvedIcon = computed(() => resolveLocalIcon(props.icon || ''))
</script>
