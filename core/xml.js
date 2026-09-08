/**
 * XML serialisation. The final document is byte-compatible in shape with the
 * original tool's final_field_coordinates.xml, so coordinatesToFields.lua reads
 * it unchanged.
 */

const DECL = `<?xml version='1.0' encoding='utf-8'?>\n`
const n2 = v => (Math.round(v * 100) / 100).toString()

/**
 * Final output — one flat coordinate list per field.
 *
 * The Field's X/Y is the origin of the transform group the importer creates,
 * and coordinatesToFields.lua links both nameIndicator and teleportIndicator to
 * that group without translating them — so they sit exactly on this point. A
 * centroid origin therefore puts a field's name marker and its teleport target
 * outside the field itself whenever the field is a crescent, a C, or wrapped
 * around a lake. The origin is the label point instead.
 *
 * Every coordinate is re-expressed against the same origin, so origin + offset
 * is unchanged and the polygon lands in exactly the same world position; only
 * the pivot moves.
 */
export function finalFieldsToXML(fields) {
  const body = fields.map(f => {
    const ox = f.labelX ?? 0
    const oy = f.labelY ?? 0
    const coords = f.coordinates.map(c => {
      const merge = c.mergeID ? ` mergeID="${c.mergeID}"` : ''
      return `    <coordinate X="${n2(c.x - ox)}" Y="${n2(c.y - oy)}"${merge} />`
    }).join('\n')
    return `  <Field ID="${f.id}" X="${n2(f.centerX + ox)}" Y="${n2(f.centerY + oy)}">\n` +
           `${coords}\n  </Field>`
  }).join('\n')
  return `${DECL}<Fields>\n${body}\n</Fields>`
}

/** Intermediate — structured rings, before bridging. Useful for diffing. */
export function ringFieldsToXML(fields) {
  const body = fields.map(f => {
    const rings = [
      { id: 1, pts: f.outer },
      ...f.islands.map((r, i) => ({ id: i + 2, pts: r })),
    ]
    const loops = rings.map(l => {
      const coords = l.pts
        .map(p => `      <coordinate X="${n2(p.x)}" Y="${n2(p.y)}" />`)
        .join('\n')
      return `    <Loop ID="${l.id}">\n${coords}\n    </Loop>`
    }).join('\n')
    return `  <Field ID="${f.id}" X="${n2(f.centerX)}" Y="${n2(f.centerY)}">\n${loops}\n  </Field>`
  }).join('\n')
  return `${DECL}<Fields>\n${body}\n</Fields>`
}
