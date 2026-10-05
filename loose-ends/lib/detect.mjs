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
export function buildSweepPrompt(answer, liveItems, waiting = [], candidates = [], rejected = []) {
  const list = liveItems.length ? liveItems.map(i => `- ${i.id}: ${i.text}`).join('\n') : '(ninguno)'
  const queue = waiting.length ? `Por revisar (no los repitas):\n${waiting.map(i => `- ${i.text}`).join('\n')}\n\n` : ''
  const no = rejected.length ? `Ejemplos que el usuario rechazó (no propongas nada parecido):\n${rejected.map(t => `- ${t}`).join('\n')}\n\n` : ''
  const repos = candidates.length ? `Repos candidatos:\n${formatCandidates(candidates)}\n\n` : ''
  return `Cabos abiertos:\n${list}\n\n${queue}${no}${repos}Respuesta del asistente:\n<<<\n${fenceSafe(answer.slice(0, 12000))}\n>>>`
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

export function parseSweepReply(text, liveIds, candidatePaths = [], answer = '', { allowNew = true } = {}) {
  const data = firstJsonObject(text)
  if (!data) return null
  const repos = new Set(candidatePaths)
  const haystack = normalize(typeof answer === 'string' ? answer : '')
  const literal = quote => {
    const needle = typeof quote === 'string' ? normalizeEvidence(quote) : ''
    return needle.length >= MIN_EVIDENCE && haystack.includes(needle) ? needle : null
  }
  let notLiteral = 0
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
      return true
    })
  const fresh = quoted.slice(0, MAX_NEW).map(x => ({
    text: x.text.trim().slice(0, 300),
    category: CATEGORIES.includes(x.category) ? x.category : undefined,
    priority: PRIORITIES.includes(x.priority) ? x.priority : 'medium',
    evidence: cleanEvidence(x.evidence).slice(0, 400),
    repo: typeof x.repo === 'string' && repos.has(x.repo) ? x.repo : undefined,
  }))
  const known = new Set(liveIds)
  const closed = new Set()
  const resolved = []
  for (const r of Array.isArray(data.resolved) ? data.resolved : []) {
    if (!r || typeof r.id !== 'string' || !known.has(r.id) || closed.has(r.id)) continue
    if (!literal(r.quote)) {
      notLiteral++
      continue
    }
    closed.add(r.id)
    resolved.push({ id: r.id, quote: cleanEvidence(r.quote).slice(0, 400) })
  }
  return { fresh, resolved, dropped: notLiteral }
}
