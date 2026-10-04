import { PRIORITIES } from './store.mjs'
import { formatCandidates } from './repos.mjs'

export const SWEEP_MODEL = 'claude-haiku-4-5-20251001'
export const MIN_ANSWER = 500
export const MAX_NEW = 2
export const MIN_EVIDENCE = 12

export function shouldSweep(answer) {
  return typeof answer === 'string' && answer.length >= MIN_ANSWER
}

function fenceSafe(text) {
  return text.replace(/<<</g, '\u2039\u2039\u2039').replace(/>>>/g, '\u203a\u203a\u203a')
}

export function buildSweepPrompt(answer, openItems, candidates = []) {
  const list = openItems.length ? openItems.map(i => `- ${i.id}: ${i.text}`).join('\n') : '(ninguno)'
  const repos = candidates.length ? `Repos candidatos:\n${formatCandidates(candidates)}\n\n` : ''
  return `Cabos abiertos:\n${list}\n\n${repos}Respuesta del asistente:\n<<<\n${fenceSafe(answer.slice(0, 12000))}\n>>>`
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

function squash(text) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

// Evidence must be a literal stretch of the answer (case and whitespace aside), long enough to mean something.
function quotedIn(evidence, haystack) {
  if (typeof evidence !== 'string') return false
  const needle = squash(evidence)
  return needle.length >= MIN_EVIDENCE && haystack.includes(needle)
}

export function parseSweepReply(text, openIds, candidatePaths = [], answer = '') {
  const data = firstJsonObject(text)
  if (!data) return null
  const repos = new Set(candidatePaths)
  const haystack = squash(typeof answer === 'string' ? answer : '')
  const fresh = (Array.isArray(data.new) ? data.new : [])
    .filter(x => x && typeof x.text === 'string' && x.text.trim().length >= 3 && quotedIn(x.evidence, haystack))
    .slice(0, MAX_NEW)
    .map(x => ({
      text: x.text.trim().slice(0, 300),
      priority: PRIORITIES.includes(x.priority) ? x.priority : 'medium',
      evidence: x.evidence.slice(0, 400),
      repo: typeof x.repo === 'string' && repos.has(x.repo) ? x.repo : undefined,
    }))
  const known = new Set(openIds)
  const resolved = [...new Set((Array.isArray(data.resolved) ? data.resolved : []).filter(id => known.has(id)))]
  return { fresh, resolved }
}
