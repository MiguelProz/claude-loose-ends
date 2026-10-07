import { CATEGORIES, normalize } from './items.mjs'
import { t } from './i18n.mjs'

// Openings of what is not a loose end, per language: checking, trying, running, waiting, deciding, reporting, pushing,
// merging, deploying and sending to third parties. Both lists always apply, because Claude may answer in a language
// other than the mod's. English "merge" alone is a refactor as often as a git merge, so only its git forms are here.
export const BANNED_STARTS = {
  es: [
    'verificar', 'comprobar', 'confirmar', 'revisar', 'probar', 'ejecutar', 'lanzar', 'esperar', 'vigilar', 'decidir', 'informar', 'reportar', 'preguntar', 'avisar',
    'hacer push', 'subir la rama', 'subir los cambios', 'subir a main', 'hacer merge', 'mergear', 'fusionar y subir', 'fusionar la rama', 'desplegar', 'enviar',
  ],
  en: [
    'verify', 'check', 'confirm', 'review', 'test', 'try', 'run', 'execute', 'launch', 'wait', 'watch', 'monitor', 'decide', 'inform', 'report', 'ask', 'tell', 'notify',
    'push', 'merge the branch', 'merge and push', 'merge into main', 'merge to main', 'deploy', 'send',
  ],
}
const ALL_BANNED = [...BANNED_STARTS.es, ...BANNED_STARTS.en].map(start => start.split(' '))
// What may come before the banned verb («hay que verificar…», "we need to check…"); the longer ones first.
const LEAD_INS = [['hay', 'que'], ['we', 'need', 'to'], ['need', 'to'], ['we', 'have', 'to'], ['have', 'to'], ['we', 'should'], ['should'], ['must']]
export const SIMILARITY = 0.6
// The sweep repeats what Claude already noted in other words: its candidates are compared with the whole queue.
export const SWEEP_SIMILARITY = 0.5
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

// Whether the text opens with a banned verb of either language, or with a lead-in and one.
export function startsBanned(text) {
  const all = words(text)
  const lead = LEAD_INS.find(start => start.every((word, k) => all[k] === word))
  const rest = lead ? all.slice(lead.length) : all
  return ALL_BANNED.some(start => start.every((word, k) => rest[k] === word))
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

// Why a candidate must not reach the person, as a code for rejectText, or null when it may.
export function rejectReason(candidate, items) {
  if (!CATEGORIES.includes(candidate.category)) return 'noCategory'
  if (startsBanned(candidate.text)) return 'notCode'
  const pool = items.filter(i => POOL.has(i.status))
  const key = normalize(candidate.text)
  if (pool.some(i => normalize(i.text) === key)) return 'duplicate'
  if (candidate.evidence) {
    const quote = normalize(candidate.evidence)
    if (pool.some(i => i.evidence && normalize(i.evidence) === quote)) return 'sameQuote'
  }
  if (candidate.file && pool.some(i => i.file === candidate.file && similarity(i.text, candidate.text) >= SIMILARITY)) return 'sameFile'
  if (candidate.source === 'sweep' && pool.some(i => similarity(i.text, candidate.text) >= SWEEP_SIMILARITY)) return 'similar'
  const rejected = items
    .filter(i => i.status === 'rejected')
    .sort((a, b) => msOf(b.closedAt) - msOf(a.closedAt))
    .slice(0, REJECTED_WINDOW)
  if (rejected.some(i => similarity(i.text, candidate.text) >= SIMILARITY)) return 'likeRejected'
  return null
}

// A reason code in words of `lang`.
export const rejectText = (lang, code) => t(lang, `reject.${code}`)
