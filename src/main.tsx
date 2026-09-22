import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from '~/app/App'
import { watchForStaleBuild } from '~/core/pwa/staleBuild'
import '~/styles/global.css'

// Registered before the app renders: a chunk can fail during the very first
// route, and by then it is too late to start listening.
watchForStaleBuild()

const container = document.getElementById('root')
if (!container) throw new Error('Root container #root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
