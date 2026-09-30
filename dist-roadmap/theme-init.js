// Runs synchronously before first paint (loaded from index.html; no inline script, strict CSP).
// Sets <html data-theme="light|dark">, data-accent and data-reduced-motion so there is no flash of the wrong look.
// Reads the device-local mirrors written by ThemeProvider (same `forge:` prefix as src/lib/localPrefs.ts):
//   forge:theme          'light' | 'dark' | 'system'
//   forge:accent         an accent id such as 'blue' (validated by shape; unknown ids fall back to the CSS default)
//   forge:reduced-motion 'on' | 'off' | 'system'
// Anything else (or no storage access) falls back to the OS preference or the default accent.
;(function () {
  function read(key) {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null /* storage blocked: use the defaults */
    }
  }
  function osPrefers(query) {
    return !!(window.matchMedia && window.matchMedia(query).matches)
  }

  var root = document.documentElement

  var theme = read('forge:theme')
  var dark = theme === 'dark' || (theme !== 'light' && osPrefers('(prefers-color-scheme: dark)'))
  root.setAttribute('data-theme', dark ? 'dark' : 'light')

  var accent = read('forge:accent')
  if (accent && /^[a-z]{2,16}$/.test(accent)) root.setAttribute('data-accent', accent)

  var motion = read('forge:reduced-motion')
  var reduced =
    motion === 'on' || (motion !== 'off' && osPrefers('(prefers-reduced-motion: reduce)'))
  root.setAttribute('data-reduced-motion', reduced ? 'on' : 'off')
})()
