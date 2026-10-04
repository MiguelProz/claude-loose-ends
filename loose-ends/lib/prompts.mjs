export const TOOL_NAME = 'note_loose_end'
export const TOOL_ID = 'mcp__loose-ends__note_loose_end'

export const TOOL_DESCRIPTION =
  'Apunta un cabo suelto: algo que has mencionado que habría que hacer o corregir y que no vas a hacer ahora ' +
  '(fuera de alcance, un test que te saltas, un aviso que ignoras, una deuda que ves de paso). ' +
  'Queda guardado entre sesiones en .claude/loose-ends.json del proyecto.'

export const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', description: 'Qué hay que hacer, en una frase accionable' },
    priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'high: rompe algo o bloquea; medium: deuda real; low: cosmético' },
    evidence: { type: 'string', description: 'Tu frase literal donde lo mencionas' },
  },
  required: ['text', 'priority'],
}

export const TOOL_GUIDE = [
  '# Cabos sueltos',
  `Cuando menciones algo que habría que hacer o corregir y no lo vayas a hacer en esta tarea (fuera de alcance, un test que te saltas, un aviso que ignoras, una deuda que ves de paso), llama a ${TOOL_ID} en ese mismo turno.`,
  'No apuntes lo que vas a hacer tú mismo ahora, ni repitas uno que ya está en la lista de cabos abiertos.',
].join('\n')

export const SWEEP_SYSTEM = [
  'Lees la respuesta de un asistente de programación y extraes cabos sueltos.',
  'Un cabo suelto es algo que el asistente dice que habría que hacer o corregir y que NO hace en esa respuesta: fuera de alcance, lo deja para luego, un test que se salta, un aviso que ignora, una deuda que ve de paso.',
  'No es cabo suelto: lo que sí hace, preguntas al usuario, opciones que ofrece sin recomendar hacerlas.',
  'No devuelvas en "new" nada que ya esté en la lista de cabos abiertos, aunque la respuesta lo mencione o lo diga con otras palabras.',
  'También marcas como resueltos los cabos abiertos de la lista que la respuesta deja hechos de verdad.',
  'Responde SOLO con JSON: {"new":[{"text":"frase accionable en español","priority":"high|medium|low","evidence":"frase literal"}],"resolved":["id"]}.',
  'Sin cabos nuevos ni resueltos: {"new":[],"resolved":[]}.',
].join('\n')

export function formatContext(activeItems, max = 10) {
  const top = activeItems.filter(i => i.priority !== 'low').slice(0, max)
  if (!top.length) return null
  return [
    'Cabos sueltos abiertos de sesiones anteriores (.claude/loose-ends.json). Tenlos presentes; no los resuelvas si no te lo piden:',
    ...top.map(i => `- [${i.priority}] ${i.text} (${i.id}${i.branch ? `, rama ${i.branch}` : ''})`),
  ].join('\n')
}

export function reminderText(items) {
  return [
    'Antes de cerrar, quedan cabos sueltos en cola. Resuélvelos ahora o explica en una línea por qué no:',
    ...items.map(i => `- ${i.text} (${i.id})`),
  ].join('\n')
}

export function doNowText(item) {
  return `Resuelve este cabo suelto (${item.id}): ${item.text}${item.evidence ? `\nLo mencionaste así: «${item.evidence}»` : ''}`
}
