/** Privacy dialog, opened from the header. */
export default function PrivacyNotice({ open, onClose }) {
  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={() => onClose(false)}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Privacy</h2>

        <p><strong>Your images stay on your device.</strong> The whole pipeline runs in your
        browser. Images and the generated XML are never sent to any server — there is no
        backend.</p>

        <p><strong>No analytics, no tracking, no cookies.</strong> This site does not use
        analytics or any other third-party services and sets no cookies. The only thing it
        stores is <code>itf.staleReload</code> in sessionStorage, a temporary flag that prevents
        reload loops after a site update. It is cleared when you close the tab.</p>

        <p><strong>Fonts.</strong> The Inter typeface is served from this site itself, so no
        request — and therefore no IP address — goes to Google Fonts.</p>

        <p><strong>Hosting.</strong> The site is hosted on GitHub Pages (GitHub, Inc.). GitHub
        logs access data, including IP addresses, when delivering the page; see{' '}
        <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement"
           target="_blank" rel="noreferrer">GitHub's Privacy Statement</a>. I have no access to
        those logs.</p>

        <div className="modal-foot">
          <div className="modal-actions">
            <button className="btn" onClick={() => onClose(false)}>Close</button>
          </div>
        </div>
      </div>
    </div>
  )
}
