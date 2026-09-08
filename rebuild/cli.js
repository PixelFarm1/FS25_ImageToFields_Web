#!/usr/bin/env node
/**
 * Headless runner.
 *
 *   node cli.js mask.png --dem 2048 --out out/
 *   node cli.js mask.png --clearance 2 --simplify 0.3 --svg
 *   node cli.js --audit existing_final_field_coordinates.xml
 *
 * Writes final_field_coordinates.xml (import this into the Giants Editor),
 * field_rings.xml, a debug SVG, and a report.json.
 */
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import { runPipeline } from './core/pipeline.js'
import { renderDebugSVG } from './debugSvg.js'
import { auditXML } from './audit.js'

function parseArgs(argv) {
  const opt = {
    input: null, out: 'out', demSize: 2048, simplification: 0.2,
    clearance: 0, unitsPerPixel: 1, svg: true, quiet: false, audit: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--dem') opt.demSize = parseInt(next(), 10)
    else if (a === '--simplify') opt.simplification = parseFloat(next())
    else if (a === '--clearance') opt.clearance = parseFloat(next())
    // --mpp stays accepted as the old spelling of the same option.
    else if (a === '--upp' || a === '--mpp') opt.unitsPerPixel = parseInt(next(), 10)
    else if (a === '--out') opt.out = next()
    else if (a === '--audit') opt.audit = next()
    else if (a === '--no-svg') opt.svg = false
    else if (a === '--quiet' || a === '-q') opt.quiet = true
    else if (a === '--help' || a === '-h') opt.help = true
    else if (!a.startsWith('--')) opt.input = a
  }
  return opt
}

const HELP = `
FS25 ImageToFields — rebuild CLI

  node cli.js <mask.png> [options]
  node cli.js --audit <final_field_coordinates.xml>

Options
  --dem <n>          DEM size (1024|2048|4096|8192)   default 2048
  --simplify <f>     RDP tolerance                    default 0.2
  --clearance <f>    border reduction / island clearance, world units   default 0
  --upp <n>          world units per source pixel, for area reporting   default 1
  --out <dir>        output directory                 default ./out
  --no-svg           skip the debug SVG
  -q, --quiet        only print the summary

--audit re-checks an XML produced by any version of the tool and reports
bridges that run over non-field area.
`

async function main() {
  const opt = parseArgs(process.argv.slice(2))
  if (opt.help || (!opt.input && !opt.audit)) {
    console.log(HELP)
    process.exit(opt.help ? 0 : 1)
  }

  if (opt.audit) {
    const result = auditXML(fs.readFileSync(opt.audit, 'utf8'))
    console.log(`\nAudit of ${path.basename(opt.audit)}`)
    console.log(`  fields             ${result.fields}`)
    console.log(`  with islands       ${result.fieldsWithIslands}`)
    console.log(`  islands            ${result.islands}`)
    console.log(`  bridge length      ${result.bridgeLength.toFixed(1)} wu`)
    console.log(`  crossing bridges   ${result.crossings} in ${result.badFields.length} field(s)`)
    for (const b of result.badFields) {
      console.log(`    field ${b.id}: ${b.islands} island(s), ${b.crossings} crossing(s)`)
    }
    return
  }

  const log = opt.quiet ? () => {} : msg => console.log(msg)

  const png = PNG.sync.read(fs.readFileSync(opt.input))
  const result = runPipeline(
    { width: png.width, height: png.height, rgba: png.data },
    opt, log,
  )

  fs.mkdirSync(opt.out, { recursive: true })
  const write = (name, content) => {
    fs.writeFileSync(path.join(opt.out, name), content)
    return path.join(opt.out, name)
  }

  write('final_field_coordinates.xml', result.xml.final)
  write('field_rings.xml', result.xml.rings)

  // Attach validation issues so the SVG can colour failing fields.
  const issuesById = new Map(result.validation.report.map(r => [r.id, r.issues]))
  const decorated = result.fields.map(f => ({ ...f, issues: issuesById.get(f.id) }))
  if (opt.svg) write('debug.svg', renderDebugSVG(decorated))

  write('report.json', JSON.stringify({
    options: {
      demSize: opt.demSize, simplification: opt.simplification,
      clearance: opt.clearance, unitsPerPixel: opt.unitsPerPixel,
    },
    stats: result.stats,
    warnings: result.warnings,
    validation: result.validation.report,
    fields: result.fields.map(f => ({
      id: f.id, sourceId: f.sourceId, part: f.part,
      points: f.coordinates.length, islands: f.islandCount,
      bridges: f.bridges.length, areaM2: Math.round(f.areaM2),
    })),
  }, null, 2))

  const s = result.stats
  console.log(`\n  fields             ${s.fields}`)
  console.log(`  islands            ${s.islands}`)
  console.log(`  bridges            ${s.bridges}  (${s.bridgesToBoundary} to a boundary, ` +
              `${s.bridges - s.bridgesToBoundary} island-to-island)`)
  console.log(`  bridge length      ${s.bridgeLength.toFixed(1)} wu`)
  console.log(`  output points      ${s.points}`)
  console.log(`  validation         ${s.errors} error(s), ${s.warnings} warning(s)`)
  console.log(`  written to         ${path.resolve(opt.out)}\n`)

  if (s.errors > 0) process.exitCode = 1
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
