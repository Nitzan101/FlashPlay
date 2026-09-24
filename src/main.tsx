import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { TutorialProvider } from './Tutorial.tsx'
import './i18n.ts'
import './index.css'
import { canonicalUrlFor } from './lib/canonicalHost.ts'
import { authDomain } from './lib/firebase.ts'

// Sign-in only works when the app is served from the same origin as
// Firebase's auth handler. Bounce the lookalike domain before rendering
// anything, so a link shared from the wrong one still ends up working.
const canonical = canonicalUrlFor(window.location.href, authDomain)

if (canonical) {
  window.location.replace(canonical)
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <TutorialProvider>
        <App />
      </TutorialProvider>
    </StrictMode>,
  )
}
