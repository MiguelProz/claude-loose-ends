import { CATEGORIES, PRIORITIES, canonicalCategory } from './items.mjs'
import { t } from './i18n.mjs'
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
export function buildSweepPrompt(lang, answer, liveItems, waiting = [], candidates = [], rejected = [], log = '') {
  const list = liveItems.length ? liveItems.map(i => `- ${i.id}: ${i.text}`).join('\n') : t(lang, 'sweepPrompt.none')
  const queue = waiting.length ? `${t(lang, 'sweepPrompt.waiting')}\n${waiting.map(i => `- ${i.id}: ${i.text}`).join('\n')}\n\n` : ''
  const no = rejected.length ? `${t(lang, 'sweepPrompt.rejected')}\n${rejected.map(x => `- ${x}`).join('\n')}\n\n` : ''
  const repos = candidates.length ? `${t(lang, 'sweepPrompt.repos')}\n${formatCandidates(candidates)}\n\n` : ''
  const commits = log.trim() ? `${t(lang, 'sweepPrompt.commits')}\n${log.trim().split('\n').map(l => `- ${fenceSafe(l)}`).join('\n')}\n\n` : ''
  return `${t(lang, 'sweepPrompt.open')}\n${list}\n\n${queue}${no}${repos}${commits}${t(lang, 'sweepPrompt.answer')}\n<<<\n${fenceSafe(answer.slice(0, 12000))}\n>>>`
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
const plain = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
// Done in the same sentence («… Corregido.»), unless a negation sits right before it («todavía no está resuelto»). A bare
// «ya está» counts only where the sentence ends: «ya está editado, sin tests» is half done.
const DONE = /\b(corregid[oa]s?|arreglad[oa]s?|resuelt[oa]s?|solucionad[oa]s?|ya esta (hecho|arreglado|corregido|resuelto|listo)|ya esta(?=[.!;]|$)|fixed|done|resolved|implemented|added|removed|handled)/
const NEGATED = /\b(no|sin|nunca|todavia no|aun no)\s+(esta\s+|estan\s+|queda\s+|quedan\s+)?$|\b(not|never|yet|still|to be|be|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|hasn['’]t|haven['’]t)\s+(yet\s+|been\s+)?$/
// Work under way or planned in this session: agents running, the next batch, «lo arreglo», «cuando terminen».
const UNDER_WAY = /\b(he lanzado|lanzo (un|dos|tres|los|el|varios)|estoy lanzando|lo estan arreglando|va en la tanda|van en la tanda|en la (siguiente|proxima) tanda|(lo|la|los|las) (arreglo|corrijo|cambio|extraigo|hago) (ahora|con|en|al|despues)|se extraera|lo revisare|cuando terminen|cuando acaben|cuando termine el agente|en el siguiente paso|a continuacion (lo|la|los|las)|i['’]?m (now )?(fixing|adding|launching|working on|handling|doing)|i am (now )?(fixing|adding|launching|working on|handling|doing)|in progress|working on it|(i['’]?ll|i will) (fix|handle|do|add) (it|this|that|them) (now|next|after|in|with)|(launched|launching) (a|an|two|three|the|several) agents?|(when|once) the agents? (finish|are done|have finished))/
// A choice left to the person.
const DECISION = /\b(es decision tuya|decision tuya|decides tu|te lo pregunto|decidir si|your call|up to you|you decide|you choose|your decision|let me know if you want)\b/

// Put off on purpose: later, another phase, outside the plan.
const DEFERRED = /\b(mas adelante|para luego|otro momento|otro dia|en el futuro|fase \d+|fuera del plan|fuera de alcance|fuera del alcance|for later|later on|out of scope|not now|separately|in (a|another|the next) (pr|task|session|phase|pull request)|follow-?ups?)\b/

// Said of noting a loose end, not of doing it: «I logged it as a loose end», «los he dejado apuntados como pendientes».
const LOGGED = /\b(apuntad[oa]s?|anotad[oa]s?)\b|\b(logged|noted|filed|recorded|flagged|proposed|tracked|added|saved|left|registrad[oa]s?|propuest[oa]s?|dejad[oa]s?|guardad[oa]s?|anadid[oa]s?)\b.*\b(loose ends?|cabos?|notebook|cuaderno|pendientes?|pending|backlog)\b|\b(save|guardar)\b.*\b(from|desde)\b.*\b(card|tarjeta)\b/
// What a closure may say besides DONE; new items keep the narrower list, where these words often describe the code.
const FINISHED = /\b(hech[oa]s?|terminad[oa]s?|completad[oa]s?|anadid[oa]s?|implementad[oa]s?|eliminad[oa]s?|quitad[oa]s?|fusionad[oa]s?|finished|completed|merged|shipped)\b/
// Words that say nothing about which loose end a sentence is about.
const COMMON_WORDS = new Set(['after', 'ahora', 'also', 'antes', 'before', 'cada', 'code', 'codigo', 'como', 'cuando', 'desde', 'donde', 'entre', 'esta', 'estas', 'este', 'esto', 'estos', 'from', 'have', 'hacer', 'into', 'only', 'para', 'porque', 'pero', 'sobre', 'tests', 'test', 'than', 'that', 'then', 'this', 'toda', 'todas', 'todo', 'todos', 'when', 'where', 'with'])
const IDENTIFIER = /[a-z0-9]+(?:[._/-][a-z0-9_]+)+|[a-z0-9]+_[a-z0-9_]+/g
const wordsOf = text => new Set(text.split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !COMMON_WORDS.has(w)))
const basename = file => (typeof file === 'string' ? plain(file).split(/[\\/]/).pop() : '')

// A closure is stricter than the filter of new items: any negation earlier in the clause undoes it («no está del todo
// corregido», «isn't fully fixed», «nada está hecho»), and so does a question.
const CLAUSE_NEGATED = /\b(no|not|never|sin|nunca|nada|ninguno|ninguna|nothing|none|aun|todavia|yet|still|isn['’]?t|aren['’]?t|wasn['’]?t|weren['’]?t|hasn['’]?t|haven['’]?t)\b/
const saysDone = text => {
  if (text.endsWith('?')) return false
  const done = new RegExp(`${DONE.source}|${FINISHED.source}`, 'g')
  return [...text.matchAll(done)].some(m => !CLAUSE_NEGATED.test(text.slice(0, m.index).split(/[,;:.]/).pop()))
}

const negationFree = (pattern, text) => [...text.matchAll(new RegExp(pattern.source, 'g'))].some(m => !NEGATED.test(text.slice(Math.max(0, m.index - 20), m.index)))

// The sentence is about this item: two words of its text, or one identifier of its text or its file's name. A closure
// in another language shares neither and the candidate stays: one click for the person, where a false withdrawal hides
// it from them.
function sameSubject(item, text) {
  // the sentence comes normalized, without underscores
  const bare = name => name.replace(/_/g, '')
  const said = wordsOf(text)
  const own = plain(item.text ?? '')
  const names = [...(own.match(IDENTIFIER) ?? []).flatMap(n => [n, ...n.split('/')]), basename(item.file)].map(bare).filter(n => n.length >= 5 && !/^v?\d/.test(n))
  const spoken = new Set((text.match(IDENTIFIER) ?? []).map(bare))
  if (names.some(n => spoken.has(n) || said.has(n))) return true
  return [...wordsOf(own)].filter(w => said.has(w)).length >= 2
}

// Why this sentence does not show this item done, or null. The subject of a commit is done work by being a commit,
// but a merge or a revert says nothing of the item. An item in progress skips the subject: the turn was about it.
export function closureVerdict(item, sentence, { commit = false } = {}) {
  const text = plain(sentence)
  if (LOGGED.test(text)) return 'the sentence says it was noted'
  if (commit && /^(merge|revert)\b|\b(wip|draft|partial)\b/.test(text)) return 'a merge, a revert or unfinished work says nothing of it'
  if (!commit) {
    if (UNDER_WAY.test(text) || DECISION.test(text) || DEFERRED.test(text)) return 'the sentence leaves it to do'
    if (!saysDone(text)) return 'the sentence does not say it is done'
  }
  if (item.status !== 'doing' && !sameSubject(item, text)) return 'the sentence is about something else'
  return null
}

// The sweep never says urgent: what it reads is high at most medium, and what is put off on purpose is low.
export function sweepPriority(priority, sentence) {
  if (typeof sentence === 'string' && DEFERRED.test(plain(sentence))) return 'low'
  return priority === 'low' ? 'low' : 'medium'
}

// Why the sentence holding a quote says it is not a loose end, or null. Only the debug log shows it, in English.
export function sentenceVerdict(sentence) {
  if (typeof sentence !== 'string') return null
  const text = plain(sentence)
  if (negationFree(DONE, text)) return 'the sentence says it is already done'
  if (UNDER_WAY.test(text)) return 'the sentence says it is being done'
  if (DECISION.test(text)) return 'the sentence leaves a decision to the user'
  return null
}

export function parseSweepReply(text, closable, candidatePaths = [], answer = '', { allowNew = true, log = '' } = {}) {
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
  const inCommit = quote => typeof quote === 'string' && normalizeEvidence(quote).length >= MIN_EVIDENCE && commits.includes(normalizeEvidence(quote))
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
    category: CATEGORIES.includes(canonicalCategory(x.category)) ? canonicalCategory(x.category) : undefined,
    priority: sweepPriority(PRIORITIES.includes(x.priority) ? x.priority : 'medium', x.sentence),
    evidence: cleanEvidence(x.evidence).slice(0, 400),
    repo: typeof x.repo === 'string' && repos.has(x.repo) ? x.repo : undefined,
  }))
  const known = new Map(closable.map(i => [i.id, i]))
  const closed = new Set()
  const claims = []
  for (const r of Array.isArray(data.resolved) ? data.resolved : []) {
    if (!r || typeof r.id !== 'string' || !known.has(r.id) || closed.has(r.id)) continue
    const said = literal(r.quote)
    if (!said && !inCommit(r.quote)) {
      notLiteral++
      continue
    }
    closed.add(r.id)
    claims.push({ item: known.get(r.id), quote: r.quote, commit: !said, sentence: said ? sentenceAround(answer, r.quote) ?? said : normalizeEvidence(r.quote) })
  }
  // one sentence that closes several items names none of them: «Están hechas las 15 tareas»
  const shared = sentence => claims.filter(c => c.sentence === sentence).length > 1
  const resolved = []
  for (const { item, quote, commit, sentence } of claims) {
    const reason = shared(sentence) ? 'one sentence cannot prove two items' : closureVerdict(item, sentence, { commit })
    if (reason) skipped.push({ text: item.text, reason: `not a closure: ${reason}` })
    else resolved.push({ id: item.id, quote: cleanEvidence(quote).slice(0, 400) })
  }
  return { fresh, resolved, dropped: notLiteral, skipped }
}
