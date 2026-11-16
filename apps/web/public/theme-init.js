/* global window, document */
// Applies the saved/system colour theme before first paint to avoid a flash.
(function () {
  var theme = 'system';
  try {
    theme = window.localStorage.getItem('kk-theme') || 'system';
  } catch (_e) {
    /* storage unavailable */
  }
  var dark = theme === 'dark' || (theme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
})();
