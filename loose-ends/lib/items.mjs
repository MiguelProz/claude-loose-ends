// The loose ends of one repo: their shape, their states and every change a person or the sweep can make.
// Transitions take `now` as an ISO string; queries take it in milliseconds.
export const PRIORITIES = ['high', 'medium', 'low']
export const CATEGORIES = ['bug', 'deuda', 'test', 'aviso', 'mejora']

// English category names the tool and the sweep accept; they are stored under the keys above.
export const CATEGORY_ALIASES = { debt: 'deuda', warning: 'aviso', improvement: 'mejora' }

// The stored key for a category as Claude or the sweep wrote it; a value it does not know is returned as given, so
// the filter refuses it.
export function canonicalCategory(value) {
  if (typeof value !== 'string') return undefined
  const key = value.trim().toLowerCase()
  if (CATEGORIES.includes(key)) return key
  return Object.hasOwn(CATEGORY_ALIASES, key) ? CATEGORY_ALIASES[key] : value
}
const DAY = 24 * 60 * 60 * 1000
export const CANDIDATE_TTL_MS = 7 * DAY
export const STALE_MS = 14 * DAY
export const CLOSED_WINDOW_MS = 7 * DAY
// How long the ref keeps a closed item, and how many rejected it keeps (the filter compares against the last 50).
export const CLOSED_RETENTION_MS = 30 * DAY
export const REJECTED_KEEP = 50
// Where a 0.3 version kept the items, inside the working tree; only the import reads it.
export const LEGACY_FILE = '.claude/loose-ends.json'
const LIVE = new Set(['open', 'doing'])
const STATUSES = new Set(['candidate', 'open', 'doing', 'done', 'dismissed', 'rejected', 'expired'])
const RANK = { high: 0, medium: 1, low: 2 }

export function normalize(text) {
  const key = String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '')
  return key || String(text).trim().toLowerCase()
}

// An item as any version wrote it, in this version's shape: a 0.3 `queued` is open again, the queue's fields go.
export function upgrade(item) {
  const { remindedAt, reason, closedBy, ...rest } = item
  const status = item.status === 'queued' || !STATUSES.has(item.status) ? 'open' : item.status
  return { ...rest, status, updatedAt: item.updatedAt ?? item.closedAt ?? item.createdAt }
}

export function parseItems(text) {
  if (text == null || text.trim() === '') return { ok: true, items: [] }
  if (/^(<<<<<<<|=======|>>>>>>>)/m.test(text)) return { ok: false, error: 'conflict' }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'json' }
  }
  // a newer version's states would come back as open and be written over: its blob is left alone
  if (data && typeof data.version === 'number' && data.version > 2) return { ok: false, error: 'version' }
  if (!data || !Array.isArray(data.items)) return { ok: false, error: 'shape' }
  if (!data.items.every(i => i && typeof i === 'object' && typeof i.id === 'string')) return { ok: false, error: 'shape' }
  return { ok: true, items: data.items.map(upgrade) }
}

export function serializeItems(items) {
  return JSON.stringify({ version: 2, items }, null, 2) + '\n'
}

function fields(input) {
  return {
    id: input.id,
    text: String(input.text ?? '').trim().slice(0, 300),
    category: CATEGORIES.includes(input.category) ? input.category : undefined,
    priority: PRIORITIES.includes(input.priority) ? input.priority : 'medium',
    source: input.source,
    evidence: input.evidence ? String(input.evidence).slice(0, 400) : undefined,
    file: input.file || undefined,
    held: input.held ? true : undefined,
    branch: input.branch ?? null,
    createdAt: input.now,
    updatedAt: input.now,
  }
}

// A proposal from Claude or the sweep, waiting for the person. The filter has already run.
export function propose(items, input) {
  const item = { ...fields(input), status: 'candidate' }
  if (item.text.length < 3) return { items, added: null }
  return { items: [...items, item], added: item }
}

// A loose end the person writes by hand: open at once, unless the same text is already live or waiting.
export function addManual(items, input) {
  const item = { ...fields({ category: 'mejora', ...input, source: 'manual' }), status: 'open' }
  if (item.text.length < 3) return { items, added: null }
  const key = normalize(item.text)
  if (items.some(i => (LIVE.has(i.status) || i.status === 'candidate') && normalize(i.text) === key)) return { items, added: null }
  return { items: [...items, item], added: item }
}

// Patches the item with this id when its status is one of `from` (any status when `from` is null).
function change(items, id, from, patch, now) {
  return items.map(i => (i.id === id && (!from || from.includes(i.status)) ? { ...i, ...patch, updatedAt: now } : i))
}

export const save = (items, id, now) => change(items, id, ['candidate'], { status: 'open' }, now)
export const reject = (items, id, now) => change(items, id, ['candidate'], { status: 'rejected', closedAt: now }, now)
export const start = (items, id, now) => change(items, id, ['open', 'doing'], { status: 'doing' }, now)
export const keepOpen = (items, id, now) => change(items, id, ['open', 'doing'], { status: 'open', proposal: undefined }, now)
export const markDone = (items, id, now) => change(items, id, ['open', 'doing'], { status: 'done', proposal: undefined, closedAt: now }, now)
export const dismiss = (items, id, now) => change(items, id, ['open', 'doing'], { status: 'dismissed', proposal: undefined, closedAt: now }, now)
export const reopen = (items, id, now) => change(items, id, ['done', 'dismissed'], { status: 'open', proof: undefined, closedAt: undefined }, now)
// A candidate a later answer shows done goes away by itself, with the sentence that proves it; ↺ brings it back to
// review. It is stored as expired with `withdrawn`, a state 0.4 already reads and leaves alone.
export const withdraw = (items, id, { quote, commit }, now) =>
  change(items, id, ['candidate'], { status: 'expired', withdrawn: true, proof: { quote, ...(commit ? { commit } : {}) }, closedAt: now }, now)
export const isWithdrawn = item => item.status === 'expired' && item.withdrawn === true
export function unwithdraw(items, id, now) {
  return items.map(i => (i.id === id && isWithdrawn(i) ? { ...i, status: 'candidate', withdrawn: undefined, proof: undefined, closedAt: undefined, updatedAt: now } : i))
}
export const touch = (items, id, now) => change(items, id, ['open', 'doing'], {}, now)

export function proposeClose(items, id, { quote, commit }, now) {
  return change(items, id, ['open', 'doing'], { proposal: { quote, ...(commit ? { commit } : {}), at: now } }, now)
}

export function confirmClose(items, id, now) {
  return items.map(i =>
    i.id === id && LIVE.has(i.status) && i.proposal
      ? { ...i, status: 'done', proof: { quote: i.proposal.quote, ...(i.proposal.commit ? { commit: i.proposal.commit } : {}) }, proposal: undefined, closedAt: now, updatedAt: now }
      : i,
  )
}

export function setPriority(items, id, priority, now) {
  return PRIORITIES.includes(priority) ? change(items, id, null, { priority }, now) : items
}

export function editText(items, id, text, now) {
  const clean = String(text ?? '').trim()
  return clean.length < 3 ? items : change(items, id, null, { text: clean.slice(0, 300) }, now)
}

// Puts an item back as it was before an action (Deshacer); the new updatedAt makes the restore win any merge.
export function restore(items, previous, now) {
  const back = { ...previous, updatedAt: now }
  return items.some(i => i.id === previous.id) ? items.map(i => (i.id === previous.id ? back : i)) : [...items, back]
}

const msOf = iso => {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : 0
}
const created = item => msOf(item.createdAt)
const touched = item => msOf(item.updatedAt ?? item.createdAt)

export function expireCandidates(items, now) {
  const at = Date.parse(now)
  return items.map(i => (i.status === 'candidate' && at - created(i) >= CANDIDATE_TTL_MS ? { ...i, status: 'expired', closedAt: now, updatedAt: now } : i))
}

// An item's priority as the lists read it: one they do not know counts as medium.
const priorityOf = item => (Object.hasOwn(RANK, item.priority) ? item.priority : 'medium')
const byRank = (a, b) => RANK[priorityOf(a)] - RANK[priorityOf(b)]
const byPriority = (a, b) => byRank(a, b) || created(a) - created(b)

// What waits for the person; a candidate the sweep holds back a turn is not shown yet.
export const candidates = items => items.filter(i => i.status === 'candidate' && !i.held).sort((a, b) => created(a) - created(b))
export const heldCandidates = items => items.filter(i => i.status === 'candidate' && i.held).sort((a, b) => created(a) - created(b))
// The held candidates with these ids go to the person.
export function release(items, ids, now) {
  const set = new Set(ids)
  return items.map(i => (set.has(i.id) && i.status === 'candidate' && i.held ? { ...i, held: undefined, updatedAt: now } : i))
}
export const live = items => items.filter(i => LIVE.has(i.status)).sort(byPriority)
export const isStale = (item, now) => LIVE.has(item.status) && now - touched(item) >= STALE_MS

export function closedRecently(items, now) {
  return items
    .filter(i => (i.status === 'done' || i.status === 'dismissed' || isWithdrawn(i)) && msOf(i.closedAt) >= now - CLOSED_WINDOW_MS)
    .sort((a, b) => msOf(b.closedAt) - msOf(a.closedAt))
}

export function rejectedTexts(items, max = 20) {
  return items
    .filter(i => i.status === 'rejected')
    .sort((a, b) => msOf(b.closedAt) - msOf(a.closedAt))
    .slice(0, max)
    .map(i => i.text)
}

export function counts(items) {
  const open = live(items)
  const of = priority => open.filter(i => priorityOf(i) === priority).length
  return { candidates: candidates(items).length, live: open.length, high: of('high'), medium: of('medium'), low: of('low') }
}

export const topUrgent = items => live(items).find(i => i.priority === 'high') ?? null

// The item the band names next: the most urgent live one; at the same priority the one in progress, then the oldest.
const doingFirst = (a, b) => (a.status === 'doing' ? 0 : 1) - (b.status === 'doing' ? 0 : 1)
export function nextItem(items) {
  // live() is already by priority then age, and sort is stable: moving the doing ones up keeps the oldest first
  return live(items).sort((a, b) => byRank(a, b) || doingFirst(a, b))[0] ?? null
}

// The urgent item the prompt may propose: one still open (not started) with no closure waiting, and only while no
// candidate waits for the person.
export function suggestable(items) {
  if (candidates(items).length) return null
  return live(items).find(i => i.priority === 'high' && i.status === 'open' && !i.proposal) ?? null
}

// What the repo looks like to a session: every id, and the ones still to do.
export function snapshot(items, now) {
  return { at: now, ids: items.map(i => i.id), live: items.filter(i => LIVE.has(i.status)).map(i => i.id) }
}

// What changed since `seen`: items it did not know that wait for the person or are to do, and items it saw to do
// that are closed now. Null without a usable snapshot.
export function recap(items, seen) {
  if (!seen || !Array.isArray(seen.ids) || !Array.isArray(seen.live)) return null
  const known = new Set(seen.ids)
  const wasLive = new Set(seen.live)
  return {
    at: seen.at,
    fresh: items.filter(i => !known.has(i.id) && ((i.status === 'candidate' && !i.held) || LIVE.has(i.status))).length,
    closed: items.filter(i => wasLive.has(i.id) && (i.status === 'done' || i.status === 'dismissed')).length,
  }
}

const GONE_AFTER_RETENTION = new Set(['done', 'dismissed', 'expired'])

// What the ref keeps, so its one blob never grows without end: closed, dismissed and expired items until 30 days
// after closing, and the 50 newest rejected. Every machine applies the same rule, so a merge that brings a pruned
// item back loses it again on the next write. The same array when nothing goes.
export function prune(items, now) {
  const rejected = items.filter(i => i.status === 'rejected').sort((a, b) => msOf(b.closedAt) - msOf(a.closedAt))
  const keptRejected = new Set(rejected.slice(0, REJECTED_KEEP).map(i => i.id))
  const kept = items.filter(i => {
    if (i.status === 'rejected') return keptRejected.has(i.id)
    if (!GONE_AFTER_RETENTION.has(i.status)) return true
    const closed = Date.parse(i.closedAt)
    return !Number.isFinite(closed) || now - closed <= CLOSED_RETENTION_MS
  })
  return kept.length === items.length ? items : kept
}
