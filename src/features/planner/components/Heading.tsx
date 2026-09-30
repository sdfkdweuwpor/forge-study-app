import type { ComponentPropsWithoutRef } from 'react'

export type HeadingLevel = 2 | 3 | 4

/**
 * A heading whose level the caller sets, for pieces used in two places: a step title is an `h2` under the
 * page's `h1`, but an `h3` inside a dialog (whose own title is the `h2`), and its subsections sit one
 * level below.
 */
export function Heading({
  level,
  ...rest
}: { level: HeadingLevel } & ComponentPropsWithoutRef<'h2'>) {
  const Tag = `h${level}` as const
  return <Tag {...rest} />
}
