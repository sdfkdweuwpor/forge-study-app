/**
 * The complete typed route table for every phase (PLAN §5.1). Features never edit this file:
 * they register a lazy page for their route names in their `feature.ts` manifest.
 * `:param?` is an optional last segment.
 */

export interface RouteDef {
  readonly path: string
  /** Feature folder that owns the page (its manifest registers the component). */
  readonly owner: string
  /** Phase in which the real page lands; the Placeholder says so. */
  readonly phase: number
  /** Document title fragment ("Goals · Forge"). */
  readonly title: string
  /** One line for the Placeholder empty state. */
  readonly blurb: string
}

export const ROUTES = {
  today: {
    path: '/',
    owner: 'today',
    phase: 3,
    title: 'Today',
    blurb: 'Your next task, today’s plan and your streak in one calm view.',
  },
  focus: {
    path: '/focus',
    owner: 'focus',
    phase: 4,
    title: 'Focus',
    blurb: 'A pomodoro timer that survives refreshes, with a full-screen mode.',
  },
  tasks: {
    path: '/tasks/:list?',
    owner: 'tasks',
    phase: 3,
    title: 'Tasks',
    blurb: 'Inbox, Upcoming and All tasks as a list, board or calendar.',
  },
  taskView: {
    path: '/tasks/views/:viewId',
    owner: 'tasks',
    phase: 3,
    title: 'Saved view',
    blurb: 'A saved filter over your tasks.',
  },
  task: {
    path: '/task/:taskId',
    owner: 'tasks',
    phase: 3,
    title: 'Task',
    blurb: 'Notes, subtasks and recurrence for one task.',
  },
  goals: {
    path: '/goals',
    owner: 'goals',
    phase: 5,
    title: 'Goals',
    blurb: 'Turn a degree like your B.S. in Computer Science into a daily plan.',
  },
  goalNew: {
    path: '/goals/new',
    owner: 'goals',
    phase: 5,
    title: 'New goal',
    blurb: 'The wizard that builds a schedule from your courses and availability.',
  },
  goal: {
    path: '/goals/:goalId',
    owner: 'goals',
    phase: 5,
    title: 'Goal',
    blurb: 'Courses, terms and the projected finish date for one goal.',
  },
  course: {
    path: '/goals/:goalId/courses/:courseId',
    owner: 'goals',
    phase: 5,
    title: 'Course',
    blurb: 'Units, notes and assessments for a course such as C182 Introduction to IT.',
  },
  roadmap: {
    path: '/roadmap',
    owner: 'roadmap',
    phase: 5,
    title: 'Roadmap',
    blurb: 'Every goal over the months, with milestones and a projected finish.',
  },
  cardReview: {
    path: '/goals/:goalId/courses/:courseId/review',
    owner: 'flashcards',
    phase: 11,
    title: 'Review cards',
    blurb: 'Spaced-repetition review for one course.',
  },
  world: {
    path: '/world',
    owner: 'world',
    phase: 8,
    title: 'My World',
    blurb: 'A small city that grows with every course you finish.',
  },
  progress: {
    path: '/progress',
    owner: 'progress',
    phase: 7,
    title: 'Progress',
    blurb: 'Streaks, focus hours and how your pace compares with your plan.',
  },
  weeklyReview: {
    path: '/review/:weekStart?',
    owner: 'progress',
    phase: 7,
    title: 'Weekly review',
    blurb: 'Wins, blockers and a look at the week ahead.',
  },
  rewards: {
    path: '/rewards/:tab?',
    owner: 'gamification',
    phase: 6,
    title: 'Rewards',
    blurb: 'Spend the XP you earn on rewards you chose yourself.',
  },
  blocker: {
    path: '/blocker',
    owner: 'blocker',
    phase: 9,
    title: 'Blocker',
    blurb: 'Keep distracting sites out of the way while you study.',
  },
  settings: {
    path: '/settings/:section?',
    owner: 'settings',
    phase: 1,
    title: 'Settings',
    blurb: 'Appearance, focus timings, data and backups.',
  },
  trash: {
    path: '/trash',
    owner: 'safety',
    phase: 11,
    title: 'Trash',
    blurb: 'Deleted items stay here for 30 days.',
  },
  ritual: {
    path: '/rituals/:kind',
    owner: 'rituals',
    phase: 11,
    title: 'Ritual',
    blurb: 'A short morning plan or evening shutdown.',
  },
  welcome: {
    path: '/welcome',
    owner: 'onboarding',
    phase: 10,
    title: 'Welcome',
    blurb: 'Set up your first goal in a couple of minutes.',
  },
  design: {
    path: '/design',
    owner: 'design',
    phase: 2,
    title: 'Design system',
    blurb: 'Every component in every state, in both themes.',
  },
  notFound: {
    path: '*',
    owner: 'app',
    phase: 1,
    title: 'Not found',
    blurb: 'That page does not exist.',
  },
} as const satisfies Record<string, RouteDef>

export type RouteName = keyof typeof ROUTES

// ── Param typing ────────────────────────────────────────────────────────────────────────────────

type Simplify<T> = { [K in keyof T]: T[K] } & unknown

type ParamOf<S extends string> = S extends `${infer N}?`
  ? { [K in N]?: string }
  : { [K in S]: string }

type ParamsOfPath<P extends string> = P extends `${string}:${infer Rest}`
  ? Rest extends `${infer Param}/${infer Tail}`
    ? ParamOf<Param> & ParamsOfPath<`/${Tail}`>
    : ParamOf<Rest>
  : Record<never, never>

export type RouteParams<N extends RouteName> = Simplify<ParamsOfPath<(typeof ROUTES)[N]['path']>>

/** True when every param of the route is optional (or it has none). */
export type ParamsOptional<N extends RouteName> =
  Record<never, never> extends RouteParams<N> ? true : false

export type Query = Record<string, string | undefined>

/** Trailing arguments of `href`/`navigate`: params are required exactly when the route has required params. */
export type RouteArgs<N extends RouteName, Extra> =
  ParamsOptional<N> extends true
    ? [params?: RouteParams<N>, extra?: Extra]
    : [params: RouteParams<N>, extra?: Extra]
