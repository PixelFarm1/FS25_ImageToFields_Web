export const translations = {
  en: {
    // Header
    appTitle: 'FS25 Image to Fields',

    // Controls
    fieldMaskPng: 'Field mask PNG',
    demSize: 'DEM size',
    demSizeTooltip: 'Resolution of your DEM.png minus 1 pixel (e.g. 2049×2049 → choose 2048)',
    processingSettings: 'Processing settings',
    simplificationStrength: 'Simplification strength',
    simplificationTooltip: 'Controls the Ramer-Douglas-Peucker tolerance. Higher = fewer polygon points.',
    distanceThreshold: 'Distance threshold',
    distanceTooltip: 'Maximum gap between consecutive points before they are split into separate loops.',
    scaleUnits: 'Scale & units',
    scaleTooltip: 'Set the real-world scale of your map image and preferred area unit',
    metersPerPixel: 'm / pixel',
    hectares: 'Hectares',
    acres: 'Acres',
    run: 'Run',
    running: 'Running...',
    toggleFieldIDs: 'Toggle field IDs',
    downloadZip: 'Download .zip',

    // Log panel
    activity: 'Activity',
    logEmpty: 'Run the pipeline to see activity here.',

    // Drop zone
    dropZone: 'Drop PNG or click to browse',

    // Canvas
    fieldVisualisation: 'Field visualisation',
    fieldDetected: '{n} field detected',
    fieldsDetected: '{n} fields detected',
    runToVisualize: 'Run the pipeline to visualise fields',

    // Privacy & cookie consent
    consentBody: 'This site uses Google Analytics to count visits. It only runs if you allow it — your images are always processed on your own device and are never uploaded.',
    consentAccept: 'Allow analytics',
    consentDecline: 'Decline',
    privacyLink: 'Privacy details',
    privacyTitle: 'Privacy',
    privacyImagesHeading: 'Your images stay on your device.',
    privacyImages: 'The whole pipeline runs in your browser. Images, generated XML and the .zip are never sent to any server — there is no backend.',
    privacyAnalyticsHeading: 'Analytics (optional).',
    privacyAnalytics: 'If you allow it, Google Analytics 4 sets cookies and records anonymised visit data (page views, whether the pipeline was run, whether a .zip was downloaded, approximate region, browser and device type) with IP anonymisation enabled. Google acts as processor and may process data outside the EU. Nothing loads until you accept, and declining sets no cookies at all.',
    privacyFontsHeading: 'Fonts.',
    privacyFonts: 'The Inter typeface is served from this site itself, so no request — and therefore no IP address — goes to Google Fonts.',
    privacyHostingHeading: 'Hosting.',
    privacyHosting: 'The site is hosted on GitHub Pages. GitHub records server access logs, including IP addresses, as part of delivering the page.',
    privacyRightsHeading: 'Your choice and your rights.',
    privacyRights: 'You can change or withdraw consent at any time here. Under the GDPR you may request access to, correction of, or deletion of your data — open an issue on the GitHub repository of this project to get in touch.',
    privacyCurrentChoice: 'Analytics is currently',
    privacyChoiceOn: 'allowed',
    privacyChoiceOff: 'declined',
    privacyChoiceNone: 'not set',
    privacyOptIn: 'Allow',
    privacyOptOut: 'Turn off',
    privacy: 'Privacy',
    close: 'Close',
  },

  de: {
    // Header
    appTitle: 'FS25 Image to Fields',

    // Controls
    fieldMaskPng: 'Feldmaske PNG',
    demSize: 'DEM-Größe',
    demSizeTooltip: 'Auflösung der DEM.png minus 1 Pixel (z.B. 2049×2049 → 2048 wählen)',
    processingSettings: 'Verarbeitungseinstellungen',
    simplificationStrength: 'Vereinfachungsstärke',
    simplificationTooltip: 'Steuert die Ramer-Douglas-Peucker-Toleranz. Höher = weniger Polygonpunkte.',
    distanceThreshold: 'Abstandsschwelle',
    distanceTooltip: 'Maximaler Abstand zwischen Punkten, bevor sie in separate Schleifen aufgeteilt werden.',
    scaleUnits: 'Maßstab & Einheiten',
    scaleTooltip: 'Maßstab des Kartenbildes und bevorzugte Flächeneinheit festlegen',
    metersPerPixel: 'm / Pixel',
    hectares: 'Hektar',
    acres: 'Acres',
    run: 'Starten',
    running: 'Läuft...',
    toggleFieldIDs: 'Feld-IDs umschalten',
    downloadZip: '.zip herunterladen',

    // Log panel
    activity: 'Aktivität',
    logEmpty: 'Starte die Pipeline, um Aktivität hier zu sehen.',

    // Drop zone
    dropZone: 'PNG ablegen oder klicken',

    // Canvas
    fieldVisualisation: 'Feldvisualisierung',
    fieldDetected: '{n} Feld erkannt',
    fieldsDetected: '{n} Felder erkannt',
    runToVisualize: 'Pipeline starten, um Felder anzuzeigen',

    // Datenschutz & Cookie-Einwilligung
    consentBody: 'Diese Seite nutzt Google Analytics zur Besuchszählung. Es läuft nur mit deiner Zustimmung — deine Bilder werden immer auf deinem eigenen Gerät verarbeitet und niemals hochgeladen.',
    consentAccept: 'Analytics erlauben',
    consentDecline: 'Ablehnen',
    privacyLink: 'Datenschutzdetails',
    privacyTitle: 'Datenschutz',
    privacyImagesHeading: 'Deine Bilder bleiben auf deinem Gerät.',
    privacyImages: 'Die gesamte Verarbeitung läuft in deinem Browser. Bilder, erzeugte XML-Dateien und die .zip werden an keinen Server gesendet — es gibt kein Backend.',
    privacyAnalyticsHeading: 'Analytics (optional).',
    privacyAnalytics: 'Wenn du zustimmst, setzt Google Analytics 4 Cookies und erfasst anonymisierte Besuchsdaten (Seitenaufrufe, ob die Pipeline gestartet wurde, ob eine .zip heruntergeladen wurde, ungefähre Region, Browser- und Gerätetyp) mit aktivierter IP-Anonymisierung. Google handelt als Auftragsverarbeiter und verarbeitet Daten möglicherweise außerhalb der EU. Vor deiner Zustimmung wird nichts geladen, bei Ablehnung werden keinerlei Cookies gesetzt.',
    privacyFontsHeading: 'Schriftarten.',
    privacyFonts: 'Die Schrift Inter wird von dieser Seite selbst ausgeliefert. Es geht also keine Anfrage — und damit keine IP-Adresse — an Google Fonts.',
    privacyHostingHeading: 'Hosting.',
    privacyHosting: 'Die Seite wird auf GitHub Pages gehostet. GitHub speichert zur Auslieferung der Seite Server-Zugriffsprotokolle einschließlich IP-Adressen.',
    privacyRightsHeading: 'Deine Wahl und deine Rechte.',
    privacyRights: 'Du kannst deine Einwilligung hier jederzeit ändern oder widerrufen. Nach der DSGVO kannst du Auskunft, Berichtigung oder Löschung deiner Daten verlangen — eröffne dafür ein Issue im GitHub-Repository des Projekts.',
    privacyCurrentChoice: 'Analytics ist derzeit',
    privacyChoiceOn: 'erlaubt',
    privacyChoiceOff: 'abgelehnt',
    privacyChoiceNone: 'nicht festgelegt',
    privacyOptIn: 'Erlauben',
    privacyOptOut: 'Deaktivieren',
    privacy: 'Datenschutz',
    close: 'Schließen',
  },
}

/** Replace {key} placeholders in a translation string. */
export function tpl(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))
}
