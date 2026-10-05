import { CATEGORIES } from './items.mjs'

export const TOOL_NAME = 'note_loose_end'
export const TOOL_ID = 'mcp__loose-ends__note_loose_end'

export const TOOL_DESCRIPTION =
  'Propone un cabo suelto: trabajo concreto sobre el código que dejas sin hacer (un bug que ves, una deuda, un test que te saltas, ' +
  'un aviso que ignoras, una mejora fuera de alcance). El usuario decide si se guarda; se guarda en refs/loose-ends del repo.'

export const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', description: 'Qué hay que hacer, en una frase accionable' },
    category: {
      type: 'string',
      enum: CATEGORIES,
      description: 'bug: algo roto; deuda: código que habría que rehacer; test: un test que falta o te saltas; aviso: un aviso que ignoras; mejora: algo que convendría y no es urgente',
    },
    priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'high: rompe algo o bloquea; medium: deuda real; low: cosmético' },
    evidence: { type: 'string', description: 'Tu frase literal donde lo mencionas' },
    file: { type: 'string', description: 'Fichero al que se ancla el cabo: ruta absoluta o relativa a la raíz del repo' },
    repo: { type: 'string', description: 'Ruta absoluta de un fichero o carpeta del repo al que pertenece el cabo, solo si no es el repo de esta sesión' },
  },
  required: ['text', 'category', 'priority'],
}

export const TOOL_GUIDE = [
  '# Cabos sueltos',
  `Cuando dejes sin hacer trabajo concreto sobre el código o el producto (un bug que ves, una deuda, un test que te saltas, un aviso que ignoras, una mejora fuera de alcance), propónlo con ${TOOL_ID} en ese mismo turno, con su categoría: bug, deuda, test, aviso o mejora. El usuario decide si se guarda.`,
  'No propongas comprobaciones, esperas, decisiones, push ni despliegues, ni tareas del usuario: el mod las rechaza.',
  'Si el cabo se ancla a un fichero, pásalo en "file". Si es de otro repo (tocaste otro), pasa en "repo" la ruta absoluta de un fichero o carpeta de ese repo.',
].join('\n')

export const SWEEP_SYSTEM = [
  'Lees la respuesta de un asistente de programación y propones cabos sueltos.',
  'Un cabo suelto es SOLO trabajo concreto sobre el código o el producto que el asistente deja explícitamente sin hacer: un bug o una deuda que vio y no arregló, algo que dijo que habría que cambiar más adelante, un test que se salta, un aviso que ignora.',
  'NO es cabo suelto: comprobar o verificar algo, esperar o vigilar algo (CI, despliegues, agentes), decidir algo, hacer push o desplegar, informar del estado, preguntas u opciones para el usuario, lo que hace ahora o en su siguiente paso, ni nada de las listas que te doy aunque esté con otras palabras.',
  'Ante la duda, no lo propongas: es mejor devolver "new" vacío. Devuelve como máximo 2 cabos nuevos.',
  'Cada cabo nuevo lleva su categoría en "category" (bug, deuda, test, aviso o mejora) y en "evidence" la frase literal de la respuesta donde lo deja sin hacer, copiada tal cual (mínimo 12 caracteres); sin esa cita no se guarda.',
  'En "resolved" pones los cabos abiertos de la lista que la respuesta deja hechos de verdad: su id y en "quote" la frase literal de la respuesta que lo prueba.',
  'Si hay una lista "Repos candidatos", rellena "repo" en cada cabo nuevo con la ruta exacta de uno de esos repos cuando el cabo pertenezca claramente a él; si dudas, omite "repo".',
  'Responde SOLO con JSON: {"new":[{"text":"frase accionable en español","category":"bug|deuda|test|aviso|mejora","priority":"high|medium|low","evidence":"frase literal","repo":"ruta de un repo candidato (opcional)"}],"resolved":[{"id":"id","quote":"frase literal"}]}.',
  'Sin nada que proponer ni cerrar: {"new":[],"resolved":[]}.',
].join('\n')

export const TOOL_TOO_SHORT = 'Texto demasiado corto: describe el cabo en una frase.'
export const NO_GIT_NOTE = 'Esta sesión no está en un repo git: indica "repo" con la ruta del repo del cabo.'
export const NOT_A_REPO = 'La ruta no está dentro de un repo git: no se ha propuesto.'
export const toolProposed = item => `Propuesto como cabo (${item.id}): ${item.text}. El usuario lo confirmará.`
export const toolRejected = reason => `No se ha propuesto: ${reason}.`
export const toolUnreadable = (target, error) => `No se pudo proponer: los cabos de ${target} (refs/loose-ends) no se pueden leer (${error}).`

export function formatContext(liveItems, max = 10) {
  const top = liveItems.filter(i => i.priority !== 'low').slice(0, max)
  if (!top.length) return null
  return [
    'Cabos sueltos abiertos de sesiones anteriores (refs/loose-ends). Tenlos presentes; no los resuelvas si no te lo piden:',
    ...top.map(i => `- [${i.priority}] ${i.text} (${i.id}${i.branch ? `, rama ${i.branch}` : ''})`),
  ].join('\n')
}

export function doNowText(item) {
  return `Resuelve este cabo suelto (${item.id}): ${item.text}${item.evidence ? `\nLo mencionaste así: «${item.evidence}»` : ''}`
}

export const SUGGEST_PREFIX = 'Resuelve el cabo: '
export const suggestText = item => `${SUGGEST_PREFIX}${item.text}`
export const passingText = items => `Cabos abiertos en este fichero: ${items.map(i => `${i.text} (${i.id})`).join('; ')}.`
