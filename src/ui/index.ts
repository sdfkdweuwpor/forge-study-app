/**
 * Public API of the component library. Import from here or from a component folder
 * (`@/ui/Button`); never from `@/ui/internal/**` or a component's own helper files.
 *
 * Positioning helpers (`computePosition`, `place`) and the menu, palette-navigation and ring-math
 * internals stay behind their folders. Popover and Tooltip both have a `Side` type, so they are
 * exported here as `PopoverSide` and `TooltipSide`.
 */

// Primitives
export { Button } from './Button'
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button'
export { IconButton } from './IconButton'
export type { IconButtonProps, IconButtonSize, IconButtonVariant } from './IconButton'
export { Input, Field, useField } from './Input'
export type { InputProps, FieldIds, FieldOptions, FieldProps } from './Input'
export { Textarea } from './Textarea'
export type { TextareaProps } from './Textarea'
export { Checkbox } from './Checkbox'
export type { CheckboxProps } from './Checkbox'
export { Toggle } from './Toggle'
export type { ToggleProps } from './Toggle'
export { SegmentedControl } from './SegmentedControl'
export type { SegmentedControlProps, SegmentOption } from './SegmentedControl'
export { Tabs } from './Tabs'
export type { TabItem, TabsProps } from './Tabs'
export { Tag, TAG_COLORS } from './Tag'
export type { TagColor, TagProps } from './Tag'
export { Kbd, ariaKeyShortcuts, formatShortcut, spokenShortcut } from './Kbd'
export type { KbdProps } from './Kbd'
export { Tooltip, TooltipBubble } from './Tooltip'
export type {
  Side as TooltipSide,
  TooltipBubbleProps,
  TooltipProps,
  TooltipTriggerProps,
} from './Tooltip'
export { ProgressBar } from './ProgressBar'
export type { ProgressBarProps, ProgressTone } from './ProgressBar'
export { ProgressRing } from './ProgressRing'
export type { ProgressRingProps } from './ProgressRing'
export { Skeleton } from './Skeleton'
export type { SkeletonProps } from './Skeleton'
export { Spinner } from './Spinner'
export type { SpinnerProps } from './Spinner'
export { EmptyState } from './EmptyState'
export type { EmptyStateProps } from './EmptyState'

// Overlays
export { Popover, PopoverBody, PopoverPanel } from './Popover'
export type {
  Align as PopoverAlign,
  Side as PopoverSide,
  PopoverContext,
  PopoverProps,
  PopoverTriggerProps,
} from './Popover'
export { Dropdown } from './Dropdown'
export type {
  DropdownProps,
  DropdownTriggerProps,
  MenuEntry,
  MenuItem,
  MenuLabel,
  MenuSeparator,
} from './Dropdown'
export { Modal, ModalPanel } from './Modal'
export type { ModalPanelProps, ModalPhoneLayout, ModalProps, ModalSize } from './Modal'
export { ToastCard, ToastProvider, useToast } from './Toast'
export type {
  ToastApi,
  ToastCardProps,
  ToastExtras,
  ToastOptions,
  ToastProviderProps,
  ToastVariant,
} from './Toast'

// Composites
export { DatePicker } from './DatePicker'
export type { DatePickerProps, QuickDateId } from './DatePicker'
export { CommandPalette, CommandPalettePanel } from './CommandPalette'
export type {
  CommandPaletteProps,
  CommandPalettePanelProps,
  PaletteGroup,
  PaletteItem,
} from './CommandPalette'
export { Breadcrumbs } from './Breadcrumbs'
export type { BreadcrumbItem, BreadcrumbLinkProps, BreadcrumbsProps } from './Breadcrumbs'
export {
  PageHeader,
  CoverPicker,
  EmojiGrid,
  COVER_PRESETS,
  COVER_PRESET_LABELS,
  PAGE_EMOJI,
  isCoverPresetId,
} from './PageHeader'
export type { CoverPickerProps, CoverPresetId, PageCover, PageHeaderProps } from './PageHeader'
export { BlockEditor } from './BlockEditor'
export type { BlockEditorProps } from './BlockEditor'
export {
  BarChart,
  Heatmap,
  HourHistogram,
  HBarList,
  AccuracyScatter,
  Sparkline,
  ChartFrame,
} from './charts'
export type {
  BarChartProps,
  BarDatum,
  HeatmapProps,
  HourHistogramProps,
  HBarItem,
  HBarListProps,
  AccuracyScatterProps,
  ScatterPoint,
  SparklineProps,
  ChartFrameProps,
} from './charts'
