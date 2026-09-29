import '@fontsource-variable/inter'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { APP_ORIGIN } from '@/config'
import './hello.css'

// Placeholder entry point: the app shell (Phase 1C) replaces this.
function Hello() {
  return (
    <main className="hello">
      <h1>
        Hello, <span className="mark">Forge</span>
      </h1>
      <p>Scaffold is running. {APP_ORIGIN.replace('https://', '')}</p>
    </main>
  )
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Missing #root element')
createRoot(rootEl).render(
  <StrictMode>
    <Hello />
  </StrictMode>,
)
