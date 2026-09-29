/** The Forge mark (same "F" as public/favicon.svg), themed through tokens. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="var(--accent)" />
      <path
        fill="var(--accent-contrast)"
        d="M20 14h26a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H29v6h13a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H29v9a3 3 0 0 1-3 3h-6a3 3 0 0 1-3-3V17a3 3 0 0 1 3-3z"
      />
    </svg>
  )
}
