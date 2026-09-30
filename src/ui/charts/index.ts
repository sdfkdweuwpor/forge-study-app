/**
 * Hand-made SVG charts (no chart library). Every chart is a `<figure>` with a caption, one
 * `<svg role="img">` that is a single tab stop (arrow keys walk the data, a tooltip and a polite
 * live region say what is selected, Escape hides it), a visually hidden data table, an empty state,
 * and it draws at its real pixel width. Colours are design tokens only.
 */
export { BarChart } from './BarChart'
export type { BarChartProps, BarDatum } from './BarChart'
export { Heatmap } from './Heatmap'
export type { HeatmapProps } from './Heatmap'
export { HourHistogram } from './HourHistogram'
export type { HourHistogramProps } from './HourHistogram'
export { HBarList } from './HBarList'
export type { HBarItem, HBarListProps } from './HBarList'
export { AccuracyScatter } from './AccuracyScatter'
export type { AccuracyScatterProps, ScatterPoint } from './AccuracyScatter'
export { Sparkline } from './Sparkline'
export type { SparklineProps } from './Sparkline'
export { ChartFrame, ChartLive, ChartTooltip } from './ChartFrame'
export type {
  ChartFrameProps,
  ChartSvgContext,
  ChartTable,
  ChartTooltipContent,
  ChartTooltipState,
} from './ChartFrame'
export { niceTicks, niceTimeTicks } from './scale'
