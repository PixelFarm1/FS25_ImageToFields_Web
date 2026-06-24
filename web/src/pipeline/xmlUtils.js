/** Build the XML declaration + root wrapper. */
const DECL = `<?xml version='1.0' encoding='utf-8'?>\n`

/** Stage 2 output — flat coordinates per field. */
export function fieldsToXML(fields) {
  const inner = fields.map(f => {
    const coords = f.coordinates
      .map(([x, y]) => `    <coordinate X="${x}" Y="${y}" />`)
      .join('\n')
    return `  <Field ID="${f.id}" X="${f.centerX}" Y="${f.centerY}">\n${coords}\n  </Field>`
  }).join('\n')
  return `${DECL}<Fields>\n${inner}\n</Fields>`
}

/** Stage 3/4 output — loops per field. */
export function loopFieldsToXML(fields) {
  const inner = fields.map(f => {
    const loops = f.loops.map(l => {
      const coords = l.coordinates
        .map(([x, y]) => `      <coordinate X="${x}" Y="${y}" />`)
        .join('\n')
      return `    <Loop ID="${l.id}">\n${coords}\n    </Loop>`
    }).join('\n')
    return `  <Field ID="${f.id}" X="${f.centerX}" Y="${f.centerY}">\n${loops}\n  </Field>`
  }).join('\n')
  return `${DECL}<Fields>\n${inner}\n</Fields>`
}

/** Stage 5 output — loops with mergeID annotations. */
export function markedFieldsToXML(fields) {
  const inner = fields.map(f => {
    const loops = f.loops.map(l => {
      const coords = l.coordinates.map(c => {
        const merge = c.mergeID ? ` mergeID="${c.mergeID}"` : ''
        return `      <coordinate X="${c.x}" Y="${c.y}"${merge} />`
      }).join('\n')
      return `    <Loop ID="${l.id}">\n${coords}\n    </Loop>`
    }).join('\n')
    return `  <Field ID="${f.id}" X="${f.centerX}" Y="${f.centerY}">\n${loops}\n  </Field>`
  }).join('\n')
  return `${DECL}<Fields>\n${inner}\n</Fields>`
}

/** Stage 6 output — single flat merged coordinate list per field. */
export function finalFieldsToXML(fields) {
  const inner = fields.map(f => {
    const coords = f.coordinates.map(c => {
      const merge = c.mergeID ? ` mergeID="${c.mergeID}"` : ''
      return `    <coordinate X="${c.x}" Y="${c.y}"${merge} />`
    }).join('\n')
    return `  <Field ID="${f.id}" X="${f.centerX}" Y="${f.centerY}">\n${coords}\n  </Field>`
  }).join('\n')
  return `${DECL}<Fields>\n${inner}\n</Fields>`
}
