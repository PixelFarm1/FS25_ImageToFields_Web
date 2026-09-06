/**
 * Consent-gated Google Analytics.
 *
 * Nothing is loaded from googletagmanager.com until the visitor explicitly
 * opts in, so no analytics cookies are set and no data (including the IP
 * address implied by the request itself) reaches Google beforehand. This is
 * what ePrivacy/GDPR require for non-essential analytics.
 */

const STORAGE_KEY = 'fs25itf.analyticsConsent'
const GA_ID = 'G-Y9WZ6V9P02'

/** @returns {'granted'|'denied'|null} null = visitor has not chosen yet */
export function readConsent() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'granted' || v === 'denied' ? v : null
  } catch {
    // Private mode or blocked storage — treat as "not chosen", never as consent.
    return null
  }
}

function persist(value) {
  try { localStorage.setItem(STORAGE_KEY, value) } catch { /* non-fatal */ }
}

let scriptLoaded = false

function loadGA() {
  if (scriptLoaded || typeof document === 'undefined') return
  scriptLoaded = true

  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
  document.head.appendChild(s)

  window.dataLayer = window.dataLayer || []
  // Must stay a function declaration: gtag relies on `arguments`.
  function gtag() { window.dataLayer.push(arguments) }
  window.gtag = gtag

  gtag('js', new Date())
  gtag('config', GA_ID, { anonymize_ip: true })
}

/** Drops the _ga* cookies GA set while consent was active. */
function clearGACookies() {
  if (typeof document === 'undefined') return
  const host = location.hostname
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0].trim()
    if (!name.startsWith('_ga') && name !== '_gid') continue
    for (const domain of [host, `.${host}`]) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${domain}`
    }
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
  }
}

/** Call once on startup: re-attaches GA only if consent was previously given. */
export function initAnalytics() {
  if (readConsent() === 'granted') loadGA()
}

export function grantConsent() {
  persist('granted')
  loadGA()
}

export function denyConsent() {
  persist('denied')
  clearGACookies()
  // GA cannot be unloaded once injected; this stops it receiving further hits.
  window['ga-disable-' + GA_ID] = true
}

/** No-ops unless the visitor opted in. */
export function trackEvent(name, params) {
  if (readConsent() !== 'granted') return
  window.gtag?.('event', name, params)
}
