import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The app started, so the stale-cache recovery in index.html is armed again for
// the next deploy rather than spent for the rest of the session.
try { sessionStorage.removeItem('itf.staleReload') } catch { /* private mode */ }
