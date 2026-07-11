import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { ErrorBoundary } from '@/components/error-boundary'

import { HandtrackApp } from './handtrack-app'

/**
 * Boot the hand-control overlay window. Rides the same bundle as the main app
 * via `?win=handtrack`, mounting a full-screen transparent surface (no app
 * shell, no gateway — it talks to the main process over the `apps` +
 * `handtrack` IPC). Force host layers transparent so the desktop shows through.
 */
export function mountHandtrack(): void {
  const style = document.createElement('style')
  style.textContent = 'html,body,#root{background:transparent !important;}'
  document.head.appendChild(style)

  const root = document.getElementById('root')

  if (!root) {
    return
  }

  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary label="handtrack">
        <HandtrackApp />
      </ErrorBoundary>
    </StrictMode>
  )
}
