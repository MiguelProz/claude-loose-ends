import { CATEGORIES, PRIORITIES } from './items.mjs'
import { formatCandidates } from './repos.mjs'

export const SWEEP_MODEL = 'claude-haiku-4-5-20251001'
export const MIN_ANSWER = 500
export const MAX_NEW = 2
export const MIN_EVIDENCE = 12

// New items only come from long answers; closures are looked for in any answer while an item is in progress.
export function shouldSweep(answer) {
  return typeof answer === 'string' && answer.length >= MIN_ANSWER
}

function fenceSafe(text) {
  return text.replace(/<<</g, '\u2039\u2039\u2039').replace(/>>>/g, '\u203A\u203A\u203A')
}

// What Haiku reads: the live items it may close (with ids), what waits for the person and what the person
// rejected (so it proposes neither again), the candidate repos when another repo was touched, and the fenced answer.
export function buildSweepPrompt(answer, liveItems, waiting = [], candidates = [], rejected = [], log = '') {
  const list = liveItems.length ? liveItems.map(i => `- ${i.id}: ${i.text}`).join('\n') : '(ninguno)'
  const queue = waiting.length ? `Por revisar (no los repitas; si la respuesta los deja hechos, van en "resolved"):\n${waiting.map(i => `- ${i.id}: ${i.text}`).join('\n')}\n\n` : ''
  const no = rejected.length ? `Ejemplos que el usuario rechazó (no propongas nada parecido):\n${rejected.map(t => `- ${t}`).join('\n')}\n\n` : ''
  const repos = candidates.length ? `Repos candidatos:\n${formatCandidates(candidates)}\n\n` : ''
  const commits = log.trim() ? `Commits de este turno:\n${log.trim().split('\n').map(l => `- ${fenceSafe(l)}`).join('\n')}\n\n` : ''
  return `Cabos abiertos:\n${list}\n\n${queue}${no}${repos}${commits}Respuesta del asistente:\n<<<\n${fenceSafe(answer.slice(0, 12000))}\n>>>`
}

// Index one past the "}" that closes the object opening at `start`, or -1. Braces inside JSON strings do not count.
function objectEnd(text, start) {
  let depth = 0
  let inString = false
  for (let k = start; k < text.length; k++) {
    const c = text[k]
    if (inString) {
      if (c === '\\') k++
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return k + 1
  }
  return -1
}

function firstJsonObject(text) {
  if (typeof text !== 'string') return null
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    const end = objectEnd(text, start)
    if (end === -1) continue
    try {
      const data = JSON.parse(text.slice(start, end))
      if (data && typeof data === 'object' && !Array.isArray(data)) return data
    } catch {}
  }
  return null
}

// Answer and quote go through the same normalization, so Markdown, quote style and list markers never decide
// whether a quote is literal.
const QUOTE_MARKS = /[`*_\u00AB\u00BB"\u201C\u201D'\u2019]/g
const LIST_MARKER = /^[ \t]*(?:[-*\u2022]|\d+[.)])[ \t]+/gm

function normalize(text) {
  return text
    .normalize('NFC')
    .replace(/\u2039\u2039\u2039/g, '<<<')
    .replace(/\u203A\u203A\u203A/g, '>>>')
    .replace(LIST_MARKER, '')
    .replace(QUOTE_MARKS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function normalizeEvidence(evidence) {
  return normalize(evidence.replace(/(?:\u2026|\.{3})\s*$/, ''))
}

// A quote is shown to the person between quotes: drop emphasis marks, keep underscores inside identifiers.
function cleanEvidence(evidence) {
  return evidence
    .replace(/[`*]/g, '')
    .replace(/(^|\s)_+(?=\S)/g, '$1')
    .replace(/(\S)_+(?=\s|$)/g, '$1')
    .trim()
}

// Whether `quote` is in `text` once both are normalized as the evidence gate does.
export function containsQuote(text, quote) {
  if (typeof text !== 'string' || typeof quote !== 'string') return false
  const needle = normalizeEvidence(quote)
  return needle.length >= MIN_EVIDENCE && normalize(text).includes(needle)
}

// The sentences of the answer that hold the quote, whole: a quote cut out of «… X sigue roto. Corregido.» must not
// hide the «Corregido». Lines and sentence ends split; a quote across several sentences takes all of them, and a
// short sentence right after (four words at most, like «Corregido.» or «Ya está.») or one that points back to it
// («Lo arreglo con el panel.») comes along.
const BACK_REFERENCE = /^(lo|la|los|las|eso|esto|esos|estos) /

export function sentenceAround(answer, quote) {
  if (typeof answer !== 'string' || typeof quote !== 'string') return null
  const needle = normalizeEvidence(quote)
  if (!needle) return null
  const parts = answer.split(/\n+/).flatMap(line => line.split(/(?<=[.!?\u2026])\s+/)).map(normalize).filter(Boolean)
  const joined = parts.join(' ')
  const at = joined.indexOf(needle)
  if (at === -1) return null
  const out = []
  let pos = 0
  for (const [k, part] of parts.entries()) {
    const end = pos + part.length
    if (end > at && pos < at + needle.length) {
      out.push(part)
      const after = parts[k + 1]
      if (end >= at + needle.length && after && (after.split(' ').length <= 4 || BACK_REFERENCE.test(after))) out.push(after)
    }
    pos = end + 1
  }
  return [...new Set(out)].join(' ')
}

// Words without accents, so the markers below match «está» and «esta» alike.
const plain = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
// Done in the same sentence («… Corregido.»), unless a negation sits right before it («todavía no está resuelto»).
const DONE = /\b(corregid[oa]s?|arreglad[oa]s?|resuelt[oa]s?|solucionad[oa]s?|ya esta (hecho|arreglado|corregido|resuelto|listo)|ya esta\b)/
const NEGATED = /\b(no|sin|nunca|todavia no|aun no)\s+(esta\s+|estan\s+|queda\s+|quedan\s+)?$/
// Work under way or planned in this session: agents running, the next batch, «lo arreglo», «cuando terminen».
const UNDER_WAY = /\b(he lanzado|lanzo (un|dos|tres|los|el|varios)|estoy lanzando|lo estan arreglando|va en la tanda|van en la tanda|en la (siguiente|proxima) tanda|(lo|la|los|las) (arreglo|corrijo|cambio|extraigo|hago) (ahora|con|en|al|despues)|se extraera|lo revisare|cuando terminen|cuando acaben|cuando termine el agente|en el siguiente paso|a continuacion (lo|la|los|las))/
// A choice left to the person.
const DECISION = /\b(es decision tuya|decision tuya|decides tu|te lo pregunto|decidir si)\b/

// Put off on purpose: later, another phase, outside the plan.
const DEFERRED = /\b(mas adelante|para luego|otro momento|otro dia|en el futuro|fase \d+|fuera del plan|fuera de alcance|fuera del alcance)\b/

// The sweep never says urgent: what it reads is high at most medium, and what is put off on purpose is low.
export function sweepPriority(priority, sentence) {
  if (typeof sentence === 'string' && DEFERRED.test(plain(sentence))) return 'low'
  return priority === 'low' ? 'low' : 'medium'
}

// Why the sentence holding a quote says it is not a loose end, or null.
export function sentenceVerdict(sentence) {
  if (typeof sentence !== 'string') return null
  const text = plain(sentence)
  for (const m of text.matchAll(new RegExp(DONE.source, 'g'))) {
    if (!NEGATED.test(text.slice(Math.max(0, m.index - 20), m.index))) return 'la frase dice que ya está hecho'
  }
  if (UNDER_WAY.test(text)) return 'la frase dice que se está haciendo'
  if (DECISION.test(text)) return 'la frase deja una decisión al usuario'
  return null
}

export function parseSweepReply(text, liveIds, candidatePaths = [], answer = '', { allowNew = true, log = '' } = {}) {
  const data = firstJsonObject(text)
  if (!data) return null
  const repos = new Set(candidatePaths)
  const haystack = normalize(typeof answer === 'string' ? answer : '')
  const literal = quote => {
    const needle = typeof quote === 'string' ? normalizeEvidence(quote) : ''
    return needle.length >= MIN_EVIDENCE && haystack.includes(needle) ? needle : null
  }
  // a closure may also quote the subject of a commit of the turn
  const commits = normalize(typeof log === 'string' ? log : '')
  const proven = quote => literal(quote) ?? (typeof quote === 'string' && normalizeEvidence(quote).length >= MIN_EVIDENCE && commits.includes(normalizeEvidence(quote)) ? quote : null)
  let notLiteral = 0
  const skipped = []
  const seen = new Set()
  // one sentence can back one item only
  const quoted = (allowNew && Array.isArray(data.new) ? data.new : [])
    .filter(x => x && typeof x.text === 'string' && x.text.trim().length >= 3)
    .filter(x => {
      const needle = literal(x.evidence)
      if (!needle) {
        notLiteral++
        return false
      }
      if (seen.has(needle)) return false
      seen.add(needle)
      x.sentence = sentenceAround(answer, x.evidence)
      const reason = sentenceVerdict(x.sentence)
      if (reason) {
        skipped.push({ text: x.text.trim(), reason })
        return false
      }
      return true
    })
  const fresh = quoted.slice(0, MAX_NEW).map(x => ({
    text: x.text.trim().slice(0, 300),
    category: CATEGORIES.includes(x.category) ? x.category : undefined,
    priority: sweepPriority(PRIORITIES.includes(x.priority) ? x.priority : 'medium', x.sentence),
    evidence: cleanEvidence(x.evidence).slice(0, 400),
    repo: typeof x.repo === 'string' && repos.has(x.repo) ? x.repo : undefined,
  }))
  const known = new Set(liveIds)
  const closed = new Set()
  const resolved = []
  for (const r of Array.isArray(data.resolved) ? data.resolved : []) {
    if (!r || typeof r.id !== 'string' || !known.has(r.id) || closed.has(r.id)) continue
    if (!proven(r.quote)) {
      notLiteral++
      continue
    }
    closed.add(r.id)
    resolved.push({ id: r.id, quote: cleanEvidence(r.quote).slice(0, 400) })
  }
  return { fresh, resolved, dropped: notLiteral, skipped }
}
