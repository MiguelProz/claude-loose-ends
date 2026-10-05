import { CATEGORIES, normalize } from './items.mjs'

// Openings of what is not a loose end: checking, waiting, deciding, reporting, pushing, deploying.
export const BANNED_STARTS = ['verificar', 'comprobar', 'confirmar', 'revisar', 'esperar', 'vigilar', 'decidir', 'informar', 'reportar', 'preguntar', 'avisar', 'hacer push', 'desplegar']
export const SIMILARITY = 0.6
export const REJECTED_WINDOW = 50
// What a candidate must not repeat: what waits for the person and what is still to do.
const POOL = new Set(['candidate', 'open', 'doing'])

// Lowercase words without accents or punctuation.
export function words(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

// Whether the text opens with a banned verb, or with «hay que» and one.
export function startsBanned(text) {
  const all = words(text)
  const rest = all[0] === 'hay' && all[1] === 'que' ? all.slice(2) : all
  return BANNED_STARTS.some(start => start.split(' ').every((word, k) => rest[k] === word))
}

// Jaccard of the two word sets: shared words over all distinct words.
export function similarity(a, b) {
  const x = new Set(words(a))
  const y = new Set(words(b))
  if (!x.size || !y.size) return 0
  let shared = 0
  for (const word of x) if (y.has(word)) shared++
  return shared / (x.size + y.size - shared)
}

const msOf = iso => Date.parse(iso) || 0

// Why a candidate must not reach the person, or null when it may.
export function rejectReason(candidate, items) {
  if (!CATEGORIES.includes(candidate.category)) return 'sin categoría (bug, deuda, test, aviso o mejora)'
  if (startsBanned(candidate.text)) return 'no es trabajo sobre el código (comprobar, esperar, decidir, avisar, hacer push o desplegar)'
  const pool = items.filter(i => POOL.has(i.status))
  const key = normalize(candidate.text)
  if (pool.some(i => normalize(i.text) === key)) return 'ya está apuntado'
  if (candidate.evidence) {
    const quote = normalize(candidate.evidence)
    if (pool.some(i => i.evidence && normalize(i.evidence) === quote)) return 'repite la cita de otro cabo'
  }
  if (candidate.file && pool.some(i => i.file === candidate.file && similarity(i.text, candidate.text) >= SIMILARITY)) return 'se parece a otro cabo del mismo fichero'
  const rejected = items
    .filter(i => i.status === 'rejected')
    .sort((a, b) => msOf(b.closedAt) - msOf(a.closedAt))
    .slice(0, REJECTED_WINDOW)
  if (rejected.some(i => similarity(i.text, candidate.text) >= SIMILARITY)) return 'se parece a uno que rechazaste'
  return null
}
