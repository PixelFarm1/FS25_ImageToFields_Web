import { useEffect, useState } from 'react'
import { readConsent, grantConsent, denyConsent, initAnalytics } from './analytics.js'

/**
 * Consent banner + privacy dialog, carried over from the main app.
 *
 * The banner shows only until a choice is made; the dialog stays reachable from
 * the header so consent can be withdrawn as easily as it was given. Consent is
 * stored under the same key as the main app, so a visitor who already chose
 * there is not asked again.
 */
export default function PrivacyNotice({ open, onClose }) {
  const [consent, setConsent] = useState(() => readConsent())

  useEffect(() => { initAnalytics() }, [])

  function choose(granted) {
    granted ? grantConsent() : denyConsent()
    setConsent(granted ? 'granted' : 'denied')
  }

  return (
    <>
      {consent === null && (
        <div className="consent">
          <p>
            This site uses Google Analytics to count visits. It only runs if you allow it —
            your images are always processed on your own device and are never uploaded.{' '}
            <button className="linkbtn" onClick={() => onClose(true)}>Privacy details</button>
          </p>
          <div className="consent-actions">
            <button className="btn" onClick={() => choose(false)}>Decline</button>
            <button className="btn primary" onClick={() => choose(true)}>Allow analytics</button>
          </div>
        </div>
      )}

      {open && (
        <div className="modal-backdrop" onClick={() => onClose(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Privacy</h2>

            <p><strong>Your images stay on your device.</strong> The whole pipeline runs in your
            browser. Images and the generated XML are never sent to any server — there is no
            backend.</p>

            <p><strong>Analytics (optional).</strong> If you allow it, Google Analytics 4 sets
            cookies and records anonymised visit data (page views, whether the pipeline was run,
            whether an XML was downloaded, approximate region, browser and device type) with IP
            anonymisation enabled. Google acts as processor and may process data outside the EU.
            Nothing loads until you accept, and declining sets no cookies at all.</p>

            <p><strong>Fonts.</strong> The Inter typeface is served from this site itself, so no
            request — and therefore no IP address — goes to Google Fonts.</p>

            <p><strong>Hosting.</strong> The site is hosted on GitHub Pages. GitHub records server
            access logs, including IP addresses, as part of delivering the page.</p>

            <p><strong>Your choice and your rights.</strong> You can change or withdraw consent at
            any time here. Under the GDPR you may request access to, correction of, or deletion of
            your data — open an issue on the GitHub repository of this project to get in touch.</p>

            <div className="modal-foot">
              <p>
                Analytics is currently{' '}
                <strong>
                  {consent === 'granted' ? 'allowed' : consent === 'denied' ? 'declined' : 'not set'}
                </strong>
              </p>
              <div className="modal-actions">
                {consent !== 'denied' && (
                  <button className="btn" onClick={() => choose(false)}>Turn off</button>
                )}
                {consent !== 'granted' && (
                  <button className="btn primary" onClick={() => choose(true)}>Allow</button>
                )}
                <button className="btn" onClick={() => onClose(false)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
