<template>
  <div
    class="w-full bg-[var(--default-bg-color)]"
    :class="[cardTabs ? 'mb-5 max-sm:mb-3 !bg-box' : '']"
  >
    <header
      class="relative box-border flex-b h-15 leading-15 select-none"
      :class="[cardTabs ? 'border-b border-[var(--art-card-border)]' : '']"
    >
      <div class="flex-c flex-1 min-w-0 leading-15">
        <ArtIconButton
          v-if="shouldShowMenuButton"
          icon="ri:menu-2-fill"
          class="ml-3 max-sm:ml-[7px]"
          aria-label="展开或收起菜单"
          @click="settings.setMenuOpen(!settings.menuOpen)"
        />
        <ArtIconButton
          v-if="shouldShowRefreshButton"
          icon="ri:refresh-line"
          class="!ml-3 refresh-btn max-sm:!hidden"
          aria-label="刷新页面"
          @click="refresh()"
        />
        <ArtBreadcrumb v-if="shouldShowBreadcrumb" />
      </div>
      <div class="flex-c shrink-0 gap-2.5 pr-5 max-sm:pr-[15px]">
        <button
          v-if="shouldShowGlobalSearch"
          type="button"
          class="flex-cb w-40 h-9 px-2.5 border border-g-400 rounded-custom-sm max-md:!hidden"
          aria-label="搜索菜单"
          @click="mittBus.emit('openSearchDialog')"
        >
          <span class="flex-c"
            ><ArtSvgIcon icon="ri:search-line" class="text-sm text-g-500" /><span
              class="ml-1 text-xs font-normal text-g-500"
              >搜索菜单</span
            ></span
          >
          <span class="flex-c h-5 px-1.5 text-xs text-g-500 border border-g-400 rounded"
            >Ctrl K</span
          >
        </button>
        <ArtIconButton
          v-if="shouldShowThemeToggle"
          :icon="settings.isDark ? 'ri:sun-fill' : 'ri:moon-line'"
          aria-label="切换主题"
          @click="themeAnimation"
        />
        <ArtIconButton
          v-if="shouldShowSettings"
          icon="ri:settings-line"
          aria-label="界面设置"
          @click="mittBus.emit('openSetting')"
        />
      </div>
    </header>
    <ArtWorkTab />
  </div>
</template>

<script setup lang="ts">
  import { useSettingStore } from '@/store/modules/setting'
  import { useCommon } from '@/hooks/core/useCommon'
  import { themeAnimation } from '@/utils/ui/animation'
  import { mittBus } from '@/utils/sys'
  import { useHeaderBar } from '@/hooks/core/useHeaderBar'
  const {
    shouldShowMenuButton,
    shouldShowRefreshButton,
    shouldShowBreadcrumb,
    shouldShowGlobalSearch,
    shouldShowSettings,
    shouldShowThemeToggle
  } = useHeaderBar()
  const settings = useSettingStore()
  const cardTabs = computed(() => ['tab-card', 'tab-google'].includes(settings.tabStyle))
  const { refresh } = useCommon()
</script>
