#!/usr/bin/env node
/**
 * Write the synthetic masks out as PNGs, for running through the CLI by hand.
 *
 *   node fixtures/generate.js
 *
 * The tests do not need this — they build the same masks in memory from
 * masks.js. Regeneration is deterministic.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { fixtures } from './masks.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function toPNG(mask) {
  const png = new PNG({ width: mask.width, height: mask.height })
  png.data.set(mask.toRGBA())
  return PNG.sync.write(png)
}

let wrote = 0
for (const [name, build] of Object.entries(fixtures)) {
  fs.writeFileSync(path.join(HERE, `${name}.png`), toPNG(build()))
  console.log(`wrote ${name}.png`)
  wrote++
}
console.log(`${wrote} fixture(s) generated.`)
