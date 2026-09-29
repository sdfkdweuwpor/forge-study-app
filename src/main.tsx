// Tokens, self-hosted Inter (official Latin subset from inter-ui) and global styles.
import './styles/index.css'
import { registry } from '@/app/registry/discover'
import { start } from '@/app/start'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Missing #root element')

// Startup (seed, settings row, domain handlers) finishes before first render so the first paint is final;
// a failed or stuck startup renders the recovery screen instead (see app/start.tsx).
start(rootEl, registry)
