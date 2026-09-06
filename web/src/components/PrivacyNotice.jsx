import { useEffect, useState } from 'react'
import { Button } from './ui/button.jsx'
import { readConsent, grantConsent, denyConsent, initAnalytics } from '../analytics.js'

/**
 * Consent banner + privacy policy dialog.
 *
 * The banner shows only until a choice is made; the policy stays reachable
 * from the header so consent can be withdrawn as easily as it was given.
 */
export default function PrivacyNotice({ t, open, onClose }) {
  const [consent, setConsent] = useState(() => readConsent())

  useEffect(() => { initAnalytics() }, [])

  function choose(granted) {
    granted ? grantConsent() : denyConsent()
    setConsent(granted ? 'granted' : 'denied')
  }

  return (
    <>
      {consent === null && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card shadow-[0_-2px_12px_rgba(0,0,0,0.15)]">
          <div className="mx-auto flex max-w-4xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
            <p className="flex-1 text-[13px] leading-snug text-foreground">
              {t.consentBody}{' '}
              <button
                onClick={() => onClose(true)}
                className="underline underline-offset-2 hover:text-primary"
              >
                {t.privacyLink}
              </button>
            </p>
            <div className="flex flex-shrink-0 gap-2">
              <Button variant="outline" className="h-8 text-[13px]" onClick={() => choose(false)}>
                {t.consentDecline}
              </Button>
              <Button className="h-8 text-[13px]" onClick={() => choose(true)}>
                {t.consentAccept}
              </Button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => onClose(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="mb-3 text-[16px] font-bold text-foreground">{t.privacyTitle}</h2>

            <div className="space-y-3 text-[13px] leading-relaxed text-foreground">
              <p><strong>{t.privacyImagesHeading}</strong> {t.privacyImages}</p>
              <p><strong>{t.privacyAnalyticsHeading}</strong> {t.privacyAnalytics}</p>
              <p><strong>{t.privacyFontsHeading}</strong> {t.privacyFonts}</p>
              <p><strong>{t.privacyHostingHeading}</strong> {t.privacyHosting}</p>
              <p><strong>{t.privacyRightsHeading}</strong> {t.privacyRights}</p>
            </div>

            <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center">
              <p className="flex-1 text-[13px] text-muted-foreground">
                {t.privacyCurrentChoice}{' '}
                <strong className="text-foreground">
                  {consent === 'granted' ? t.privacyChoiceOn
                    : consent === 'denied' ? t.privacyChoiceOff
                    : t.privacyChoiceNone}
                </strong>
              </p>
              <div className="flex gap-2">
                {consent !== 'denied' && (
                  <Button variant="outline" className="h-8 text-[13px]" onClick={() => choose(false)}>
                    {t.privacyOptOut}
                  </Button>
                )}
                {consent !== 'granted' && (
                  <Button className="h-8 text-[13px]" onClick={() => choose(true)}>
                    {t.privacyOptIn}
                  </Button>
                )}
                <Button variant="outline" className="h-8 text-[13px]" onClick={() => onClose(false)}>
                  {t.close}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
