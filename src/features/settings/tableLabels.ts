import type { TableName } from '@/db/types'

/** What each table holds, in the words a person uses. Exhaustive on purpose: a new table must be named here. */
export const TABLE_LABELS: Record<TableName, string> = {
  settings: 'Settings',
  tasks: 'Tasks',
  goals: 'Goals',
  milestones: 'Courses',
  units: 'Units',
  sessions: 'Focus sessions',
  streakDays: 'Streak days',
  xpEvents: 'XP events',
  badges: 'Badges',
  rewards: 'Rewards',
  redemptions: 'Redeemed rewards',
  blocklist: 'Blocked sites',
  blockEvents: 'Blocked attempts',
  parkingLot: 'Parked thoughts',
  checkIns: 'Check-ins',
  assessments: 'Assessment attempts',
  flashcards: 'Flashcards',
  resources: 'Resources',
  files: 'Attached files',
  snapshots: 'Snapshots',
  trash: 'Trash',
  worldTiles: 'World tiles',
  savedViews: 'Saved views',
  rituals: 'Rituals',
  weeklyReviews: 'Weekly reviews',
  templates: 'Templates',
  plannedAssessments: 'Planned exams',
  planProposals: 'Plan proposals',
  practiceQuestions: 'Practice questions',
  questionAttempts: 'Question attempts',
  readiness: 'Readiness',
  syncOutbox: 'Changes waiting to sync',
  syncState: 'Sync settings',
}

export function tableLabel(table: string): string {
  return (TABLE_LABELS as Record<string, string | undefined>)[table] ?? table
}
