import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { ErrorBoundary } from '@/components/error-boundary'

import { NotchApp } from './notch-app'

/**
 * Boot the notch HUD window. Rides the same bundle as the main app but via
 * `?win=notch`, mounting a minimal, transparent surface (no app shell, no
 * gateway — it only renders state pushed from the main renderer). The
 * index.html boot script paints an opaque themed background to avoid a flash in
 * normal windows; the notch must be see-through, so force every host layer
 * transparent with a late, high-specificity style tag.
 */
export function mountNotch(): void {
  const style = document.createElement('style')
  style.textContent = 'html,body,#root{background:transparent !important;}'
  document.head.appendChild(style)

  const root = document.getElementById('root')

  if (!root) {
    return
  }

  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary label="notch">
        <NotchApp />
      </ErrorBoundary>
    </StrictMode>
  )
}
