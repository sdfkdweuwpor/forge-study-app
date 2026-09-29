// Runs synchronously before first paint (loaded from index.html; no inline script, strict CSP).
// Sets <html data-theme="light|dark"> so there is no flash of the wrong theme.
// Reads the device-local mirror written by ThemeProvider: localStorage['forge:theme'] = 'light' | 'dark' | 'system'.
// Anything else (or no storage access) falls back to the OS preference.
;(function () {
  var theme = 'system'
  try {
    var stored = window.localStorage.getItem('forge:theme')
    if (stored === 'light' || stored === 'dark' || stored === 'system') theme = stored
  } catch {
    /* storage blocked: use the OS preference */
  }
  var dark =
    theme === 'dark' ||
    (theme === 'system' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
})()
