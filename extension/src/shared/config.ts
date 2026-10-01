/** Shared constants for the app and the Chrome extension. Dependency-free. */

/** The live app on GitHub Pages. Only the origin: an origin check compares this, nothing more. */
export const APP_ORIGIN = 'https://sdfkdweuwpor.github.io'
/** A project page is served under the repo name, so opening the app needs the path as well. */
export const APP_PATH = '/forge-study-app/'
/** Where to send someone to open the app. */
export const APP_URL = `${APP_ORIGIN}${APP_PATH}`
/** The Netlify deploy, kept as a fallback host. The same code, served from the root. */
export const FALLBACK_ORIGIN = 'https://forge-study-app.netlify.app'

export const DEFAULT_EXTENSION_ID = 'gpinhblnpebjbiodblihfpjbffacipbd'
/** Public repo: the latest release's zip downloads without a GitHub login. */
export const EXTENSION_ZIP_URL =
  'https://github.com/sdfkdweuwpor/forge-study-app/releases/latest/download/forge-extension.zip'
