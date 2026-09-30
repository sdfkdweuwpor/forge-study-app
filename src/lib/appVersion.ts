/** The app's version (from package.json at build time), or "dev" where the build constant does not exist. */
export function appVersion(): string {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
}
