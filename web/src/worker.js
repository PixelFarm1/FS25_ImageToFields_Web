/**
 * Web Worker — orchestrates the full 6-stage pipeline.
 * Communicates with the main thread via postMessage.
 *
 * Inbound:  { type: 'RUN', payload: { imageBuffer, demSize, simplificationStrength, distanceThreshold, borderReduction } }
 * Outbound: { type: 'LOG',  message: string }
 *           { type: 'DONE', fields: Field[], zipBuffer: ArrayBuffer }
 *           { type: 'ERROR', message: string }
 */
import JSZip from 'jszip'
import { stage1, stage2 } from './pipeline/imageProcessing.js'
import { stage3, stage4 } from './pipeline/fieldLoops.js'
import { stage5, stage6 } from './pipeline/fieldMerge.js'

function log(msg) {
  self.postMessage({ type: 'LOG', message: msg })
}

self.onmessage = async (e) => {
  if (e.data.type !== 'RUN') return
  const { imageBuffer, demSize, simplificationStrength, distanceThreshold, borderReduction } = e.data.payload

  try {
    // Stage 1
    const s1 = await stage1(imageBuffer, log)

    // Stage 2
    const s2 = stage2(s1, demSize, log)

    // Stage 3
    const s3 = stage3(s2.fields, distanceThreshold, log)

    // Stage 4
    const s4 = stage4(s3.fields, simplificationStrength, borderReduction, log)

    // Stage 5
    const s5 = stage5(s4.fields, log)

    // Stage 6
    const s6 = stage6(s5.fields, log)

    // Assemble zip
    log('Assembling output zip...')
    const zip = new JSZip()
    zip.file('processed_image.png',        s1.pngBuffer)
    zip.file('coordinates1.xml',           s2.xml)
    zip.file('field_loops.xml',            s3.xml)
    zip.file('simplified_field_loops.xml', s4.xml)
    zip.file('field_coordinates_marked.xml', s5.xml)
    zip.file('final_field_coordinates.xml',  s6.xml)

    const zipBlob = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
    log('Done! Click "Download .zip" to save all output files.')

    self.postMessage({ type: 'DONE', fields: s6.fields, zipBuffer: zipBlob }, [zipBlob])
  } catch (err) {
    self.postMessage({ type: 'ERROR', message: String(err?.message ?? err) })
  }
}
