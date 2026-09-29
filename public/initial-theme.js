try {
  if (localStorage.getItem('emr-ui-theme') === 'dark') document.documentElement.classList.add('dark')
} catch { /* 无法访问界面缓存时使用默认主题。 */ }
