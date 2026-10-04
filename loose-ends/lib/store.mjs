export const FILE = '.claude/loose-ends.json'
export const PRIORITIES = ['high', 'medium', 'low']
const ACTIVE = new Set(['open', 'queued'])
const RANK = { high: 0, medium: 1, low: 2 }

export function normalize(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '')
}

export function parseFile(text) {
  if (text == null || text.trim() === '') return { ok: true, items: [] }
  if (/^(<<<<<<<|=======|>>>>>>>)/m.test(text)) return { ok: false, error: 'conflict' }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'json' }
  }
  if (!data || !Array.isArray(data.items)) return { ok: false, error: 'shape' }
  if (!data.items.every(i => i && typeof i === 'object' && typeof i.id === 'string')) return { ok: false, error: 'shape' }
  return { ok: true, items: data.items }
}

export function serialize(items) {
  return JSON.stringify({ version: 1, items }, null, 2) + '\n'
}

export function addItem(items, input) {
  const text = String(input.text ?? '').trim()
  if (text.length < 3) return { items, added: null }
  const key = normalize(text)
  if (items.some(i => ACTIVE.has(i.status) && normalize(i.text) === key)) return { items, added: null }
  const added = {
    id: input.id,
    text,
    priority: PRIORITIES.includes(input.priority) ? input.priority : 'medium',
    status: 'open',
    source: input.source,
    evidence: input.evidence ? String(input.evidence).slice(0, 400) : undefined,
    branch: input.branch ?? null,
    createdAt: input.now,
  }
  return { items: [...items, added], added }
}

function patch(items, id, change) {
  return items.map(i => (i.id === id ? { ...i, ...change } : i))
}

export function close(items, id, { status, reason, closedBy, now }) {
  return patch(items, id, { status, reason, closedBy, closedAt: now, remindedAt: undefined })
}

export function reopen(items, id) {
  return patch(items, id, { status: 'open', reason: undefined, closedBy: undefined, closedAt: undefined, remindedAt: undefined })
}

export function queue(items, id) {
  return patch(items, id, { status: 'queued', remindedAt: undefined })
}

export function setPriority(items, id, priority) {
  return PRIORITIES.includes(priority) ? patch(items, id, { priority }) : items
}

export function dueReminders(items) {
  return items.filter(i => i.status === 'queued' && !i.remindedAt)
}

export function markReminded(items, ids, now) {
  const set = new Set(ids)
  return items.map(i => (set.has(i.id) ? { ...i, remindedAt: now } : i))
}

export function expireReminded(items) {
  return items.map(i => (i.status === 'queued' && i.remindedAt ? { ...i, status: 'open', remindedAt: undefined } : i))
}

export function active(items) {
  return items
    .filter(i => ACTIVE.has(i.status))
    .sort((a, b) => (RANK[a.priority] ?? 1) - (RANK[b.priority] ?? 1) || Date.parse(a.createdAt) - Date.parse(b.createdAt))
}

export function counts(items, branch) {
  const mine = active(items).filter(i => !i.branch || i.branch === branch)
  return {
    open: mine.length,
    high: mine.filter(i => i.priority === 'high').length,
    queued: mine.filter(i => i.status === 'queued').length,
  }
}
