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
  },
}

/** Replace {key} placeholders in a translation string. */
export function tpl(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))
}
