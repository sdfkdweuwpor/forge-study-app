import '@fontsource-variable/inter'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/reset.css'
import './styles/global.css'
import { App } from '@/app/App'
import { bootApp } from '@/app/boot'
import { registry } from '@/app/registry/discover'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Missing #root element')
const root = createRoot(rootEl)

// Startup (seed, settings row, domain handlers) finishes before first render so the first paint is final.
void bootApp(registry).then(() => {
  root.render(
    <StrictMode>
      <App registry={registry} />
    </StrictMode>,
  )
})
