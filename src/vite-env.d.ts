/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Build-time switch for `?seed=wgu|empty` (dev and e2e builds only). Set to '1' by `npm run dev` and
   * by the Playwright web servers; never set for a deployed build, which then ignores `?seed=`.
   */
  readonly VITE_ENABLE_SEED?: string
}

declare const __APP_VERSION__: string
