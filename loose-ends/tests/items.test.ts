import { describe, expect, test } from 'claude-code/testing'
import {
  CATEGORIES, addManual, candidates, closedRecently, confirmClose, counts, dismiss, editText, expireCandidates, isStale, keepOpen, live, nextItem,
  markDone, parseItems, propose, proposeClose, withdraw, unwithdraw, isWithdrawn, reject, rejectedTexts, reopen, restore, save, serializeItems, setPriority, start, suggestable, topUrgent, touch, upgrade, snapshot, recap, prune, CLOSED_RETENTION_MS, REJECTED_KEEP,
} from '../lib/items.mjs'

const T0 = '2026-10-04T10:00:00.000Z'
const T1 = '2026-10-04T11:00:00.000Z'
const DAY = 24 * 60 * 60 * 1000
const input = (over = {}) => ({ id: 'c1', text: 'Corregir el revalidatePath de la ficha', category: 'deuda', priority: 'medium', source: 'sweep', evidence: 'lo dejo para otro día', branch: 'main', now: T0, ...over })
const one = (over = {}) => propose([], input(over)).items
const get = (items: any[], id = 'c1') => items.find(i => i.id === id)

describe('parse and upgrade', () => {
  test('empty is an empty list; broken, conflicted or wrong shapes are refused', () => {
    expect(parseItems(undefined as any)).toEqual({ ok: true, items: [] })
    expect(parseItems('')).toEqual({ ok: true, items: [] })
    expect(parseItems('{ roto')).toEqual({ ok: false, error: 'json' })
    expect(parseItems('<<<<<<< HEAD\n{}\n=======\n>>>>>>> x\n')).toEqual({ ok: false, error: 'conflict' })
    expect(parseItems('{"items":{}}')).toEqual({ ok: false, error: 'shape' })
    expect(parseItems('{"items":[{"text":"sin id"}]}')).toEqual({ ok: false, error: 'shape' })
  })
  test('a 0.3 item comes back without the queue: queued is open, reason, closedBy and remindedAt go', () => {
    const old = { id: 'q1', text: 'Docs', priority: 'medium', status: 'queued', reason: 'x', closedBy: 'sweep', remindedAt: T0, createdAt: T0 }
    expect(upgrade(old)).toEqual({ id: 'q1', text: 'Docs', priority: 'medium', status: 'open', createdAt: T0, updatedAt: T0 })
    expect(upgrade({ id: 'z', text: 'Raro', status: 'nope', createdAt: T0 }).status).toBe('open')
    expect(upgrade({ id: 'd', text: 'Hecho', status: 'done', createdAt: T0, closedAt: T1 }).updatedAt).toBe(T1)
  })
  test('serialize writes version 2 and parse reads it back', () => {
    const items = one()
    const text = serializeItems(items)
    expect(JSON.parse(text).version).toBe(2)
    expect(text.endsWith('\n')).toBe(true)
    expect(parseItems(text)).toEqual({ ok: true, items })
  })
  test('a blob from a newer version is refused, so its states are never rewritten as open', () => {
    expect(parseItems('{"version":3,"items":[{"id":"a1","text":"x","status":"snoozed"}]}')).toEqual({ ok: false, error: 'version' })
    expect(parseItems('{"version":2,"items":[]}')).toEqual({ ok: true, items: [] })
    expect(parseItems('{"version":1,"items":[]}')).toEqual({ ok: true, items: [] })
    expect(parseItems('{"items":[]}')).toEqual({ ok: true, items: [] })
  })
})

describe('creating', () => {
  test('propose makes a candidate with its fields', () => {
    const { items, added } = propose([], input({ file: 'lib/a.ts' }))
    expect(added).toEqual({ id: 'c1', text: 'Corregir el revalidatePath de la ficha', category: 'deuda', priority: 'medium', source: 'sweep', evidence: 'lo dejo para otro día', file: 'lib/a.ts', branch: 'main', createdAt: T0, updatedAt: T0, status: 'candidate' })
    expect(items).toEqual([added])
  })
  test('propose cleans unknown category and priority and refuses a text shorter than 3', () => {
    const cleaned = propose([], input({ category: 'nope', priority: 'x' })).added
    expect(cleaned.category).toBeUndefined()
    expect(cleaned.priority).toBe('medium')
    expect(propose([], input({ text: ' a ' }))).toEqual({ items: [], added: null })
  })
  test('addManual opens at once as mejora, and refuses a text already live or waiting', () => {
    const { items, added } = addManual([], { id: 'm1', text: 'Apuntado a mano', branch: 'main', now: T0 })
    expect(added).toMatchObject({ status: 'open', source: 'manual', category: 'mejora', priority: 'medium' })
    expect(addManual(items, { id: 'm2', text: 'apuntado A MANO', branch: 'main', now: T0 }).added).toBe(null)
    expect(addManual(one(), { id: 'm3', text: 'Corregir el revalidatePath de la ficha', branch: 'main', now: T0 }).added).toBe(null)
  })
})

describe('transitions', () => {
  test('save and reject act only on candidates', () => {
    expect(get(save(one(), 'c1', T1))).toMatchObject({ status: 'open', updatedAt: T1 })
    expect(get(reject(one(), 'c1', T1))).toMatchObject({ status: 'rejected', closedAt: T1 })
    const open = save(one(), 'c1', T1)
    expect(reject(open, 'c1', T1)).toEqual(open)
  })
  test('start, proposeClose, confirmClose keep the proof', () => {
    let items = start(save(one(), 'c1', T0), 'c1', T0)
    expect(get(items).status).toBe('doing')
    items = proposeClose(items, 'c1', { quote: 'ya no llama dos veces', commit: 'a3f9c21' }, T1)
    expect(get(items).proposal).toEqual({ quote: 'ya no llama dos veces', commit: 'a3f9c21', at: T1 })
    items = confirmClose(items, 'c1', T1)
    expect(get(items)).toMatchObject({ status: 'done', proof: { quote: 'ya no llama dos veces', commit: 'a3f9c21' }, closedAt: T1 })
    expect(get(items).proposal).toBeUndefined()
  })
  test('a proposal without commit stores none; confirmClose needs a proposal', () => {
    const items = proposeClose(save(one(), 'c1', T0), 'c1', { quote: 'hecho de verdad' }, T1)
    expect(get(items).proposal).toEqual({ quote: 'hecho de verdad', at: T1 })
    const plain = save(one(), 'c1', T0)
    expect(confirmClose(plain, 'c1', T1)).toEqual(plain)
  })
  test('keepOpen clears the proposal and goes back to open', () => {
    const items = keepOpen(proposeClose(start(save(one(), 'c1', T0), 'c1', T0), 'c1', { quote: 'q' }, T0), 'c1', T1)
    expect(get(items)).toMatchObject({ status: 'open' })
    expect(get(items).proposal).toBeUndefined()
  })
  test('markDone, dismiss and reopen', () => {
    const open = save(one(), 'c1', T0)
    expect(get(markDone(open, 'c1', T1))).toMatchObject({ status: 'done', closedAt: T1 })
    expect(get(dismiss(open, 'c1', T1))).toMatchObject({ status: 'dismissed', closedAt: T1 })
    const back = reopen(markDone(open, 'c1', T1), 'c1', T1)
    expect(get(back)).toMatchObject({ status: 'open' })
    expect(get(back).closedAt).toBeUndefined()
    expect(reopen(one(), 'c1', T1)).toEqual(one())
  })
  test('withdraw takes only a candidate, keeps the proof as expired, and unwithdraw brings it back', () => {
    const gone = withdraw(one(), 'c1', { quote: 'ya está arreglado', commit: 'abc1234' }, T1)
    expect(get(gone)).toMatchObject({ status: 'expired', withdrawn: true, proof: { quote: 'ya está arreglado', commit: 'abc1234' }, closedAt: T1 })
    expect(isWithdrawn(get(gone))).toBe(true)
    expect(closedRecently(gone, Date.parse(T1)).map(i => i.id)).toEqual(['c1'])
    expect(withdraw(save(one(), 'c1', T0), 'c1', { quote: 'q' }, T1)).toEqual(save(one(), 'c1', T0))
    const back = unwithdraw(gone, 'c1', T1)
    expect(get(back)).toMatchObject({ status: 'candidate' })
    expect(get(back).withdrawn).toBeUndefined()
    expect(get(back).proof).toBeUndefined()
    expect(unwithdraw(one(), 'c1', T1)).toEqual(one())
  })
  test('setPriority, editText and touch', () => {
    const open = save(one(), 'c1', T0)
    expect(get(setPriority(open, 'c1', 'high', T1)).priority).toBe('high')
    expect(setPriority(open, 'c1', 'nope', T1)).toEqual(open)
    expect(get(editText(open, 'c1', '  Texto nuevo  ', T1)).text).toBe('Texto nuevo')
    expect(editText(open, 'c1', 'x', T1)).toEqual(open)
    expect(get(touch(open, 'c1', T1)).updatedAt).toBe(T1)
  })
  test('restore puts back the item as it was, with a new updatedAt', () => {
    const before = get(one())
    const items = restore(save(one(), 'c1', T0), before, T1)
    expect(get(items)).toEqual({ ...before, updatedAt: T1 })
    expect(restore([], before, T1)).toEqual([{ ...before, updatedAt: T1 }])
  })
  test('candidates expire after 7 days', () => {
    const items = one({ now: '2026-09-27T10:00:00.000Z' })
    expect(get(expireCandidates(items, '2026-10-04T09:59:59.000Z')).status).toBe('candidate')
    expect(get(expireCandidates(items, '2026-10-04T10:00:00.000Z'))).toMatchObject({ status: 'expired', closedAt: '2026-10-04T10:00:00.000Z' })
  })
})

describe('queries', () => {
  const build = () => {
    let items = propose([], input({ id: 'w1', now: '2026-10-04T09:00:00.000Z' })).items
    items = propose(items, input({ id: 'w0', text: 'Otro candidato', now: '2026-10-04T08:00:00.000Z' })).items
    items = save(propose(items, input({ id: 'l1', text: 'Baja antigua', priority: 'low', now: '2026-10-01T00:00:00.000Z' })).items, 'l1', '2026-10-01T00:00:00.000Z')
    items = save(propose(items, input({ id: 'h1', text: 'Urgente', priority: 'high' })).items, 'h1', T0)
    items = start(save(propose(items, input({ id: 'm1', text: 'En curso' })).items, 'm1', T0), 'm1', T0)
    items = reject(propose(items, input({ id: 'r1', text: 'Comprobar el CI' })).items, 'r1', '2026-10-03T00:00:00.000Z')
    items = reject(propose(items, input({ id: 'r2', text: 'Esperar el despliegue' })).items, 'r2', '2026-10-04T00:00:00.000Z')
    items = markDone(save(propose(items, input({ id: 'd1', text: 'Hecho hace poco' })).items, 'd1', T0), 'd1', '2026-10-03T00:00:00.000Z')
    items = markDone(save(propose(items, input({ id: 'd2', text: 'Hecho hace mucho' })).items, 'd2', T0), 'd2', '2026-09-20T00:00:00.000Z')
    return items
  }
  test('candidates by age; live by priority then age, doing included', () => {
    const items = build()
    expect(candidates(items).map(i => i.id)).toEqual(['w0', 'w1'])
    expect(live(items).map(i => i.id)).toEqual(['h1', 'm1', 'l1'])
  })
  test('counts and the top urgent item', () => {
    const items = build()
    expect(counts(items)).toEqual({ candidates: 2, live: 3, high: 1, medium: 1, low: 1 })
    expect(topUrgent(items)?.id).toBe('h1')
    expect(topUrgent([])).toBe(null)
  })
  test('the next item: the most urgent live one; at the same priority the one in progress, then the oldest', () => {
    expect(nextItem(build())?.id).toBe('h1')
    expect(nextItem([])).toBe(null)
    let items = save(propose([], input({ id: 'm1', text: 'Antiguo', now: '2026-10-01T00:00:00.000Z' })).items, 'm1', T0)
    items = save(propose(items, input({ id: 'm2', text: 'Nuevo', now: '2026-10-03T00:00:00.000Z' })).items, 'm2', T0)
    expect(nextItem(items)?.id).toBe('m1')
    expect(nextItem(start(items, 'm2', T1))?.id).toBe('m2')
    expect(nextItem(propose([], input({ id: 'c9' })).items)).toBe(null)
  })
  test('the next item: two in progress at the same priority, the oldest; an unknown priority ranks and counts as medium', () => {
    let items = save(propose([], input({ id: 'm1', text: 'Antiguo', now: '2026-10-01T00:00:00.000Z' })).items, 'm1', T0)
    items = save(propose(items, input({ id: 'm2', text: 'Nuevo', now: '2026-10-03T00:00:00.000Z' })).items, 'm2', T0)
    expect(nextItem(start(start(items, 'm2', T1), 'm1', T1))?.id).toBe('m1')
    const odd = { id: 'x1', text: 'Prioridad rara', priority: 'urgentisima', status: 'open', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: T0 }
    const low = { ...odd, id: 'l1', priority: 'low', createdAt: '2026-08-01T00:00:00.000Z' }
    expect(nextItem([low, odd])?.id).toBe('x1')
    expect(counts([low, odd])).toEqual({ candidates: 0, live: 2, high: 0, medium: 1, low: 1 })
  })
  test('the prompt suggests only an urgent item still open, without a proposed closure, and only while no candidate waits', () => {
    const urgent = (over = {}) => save(propose([], input({ id: 'h1', text: 'Urgente', priority: 'high', ...over })).items, 'h1', T0)
    expect(suggestable(urgent())?.id).toBe('h1')
    expect(suggestable(start(urgent(), 'h1', T1))).toBe(null)
    expect(suggestable(proposeClose(urgent(), 'h1', { quote: 'ya está hecho' }, T1))).toBe(null)
    expect(suggestable(save(propose([], input({ id: 'm1' })).items, 'm1', T0))).toBe(null)
    expect(suggestable(build())).toBe(null)
    expect(suggestable([])).toBe(null)
    // a doing urgent item does not hide an open one behind it
    const two = save(propose(start(urgent(), 'h1', T1), input({ id: 'h2', text: 'Otro urgente', priority: 'high', now: T1 })).items, 'h2', T1)
    expect(suggestable(two)?.id).toBe('h2')
  })
  test('closed in the last 7 days, newest first; rejected texts newest first', () => {
    const items = build()
    expect(closedRecently(items, Date.parse(T0)).map(i => i.id)).toEqual(['d1'])
    expect(rejectedTexts(items)).toEqual(['Esperar el despliegue', 'Comprobar el CI'])
    expect(rejectedTexts(items, 1)).toEqual(['Esperar el despliegue'])
  })
  test('an open item untouched for 14 days is stale; closed ones never are', () => {
    const items = build()
    expect(isStale(get(items, 'l1'), Date.parse('2026-10-15T00:00:00.000Z'))).toBe(true)
    expect(isStale(get(items, 'l1'), Date.parse('2026-10-14T23:59:59.000Z'))).toBe(false)
    expect(isStale(get(items, 'd2'), Date.parse('2026-12-01T00:00:00.000Z'))).toBe(false)
  })
  test('the categories', () => {
    expect(CATEGORIES).toEqual(['bug', 'deuda', 'test', 'aviso', 'mejora'])
  })
})

describe('snapshot and recap', () => {
  const T = '2026-10-04T10:00:00.000Z'
  const mk = (id: string, status: string) => ({ id, text: id, status, priority: 'medium', createdAt: T })
  test('snapshot keeps every id and the live ones', () => {
    expect(snapshot([mk('a', 'open'), mk('b', 'doing'), mk('c', 'done'), mk('d', 'candidate')], T)).toEqual({ at: T, ids: ['a', 'b', 'c', 'd'], live: ['a', 'b'] })
  })
  test('recap counts what is new and waiting or to do, and what was live and is closed now', () => {
    const seen = { at: '2026-10-03T10:00:00.000Z', ids: ['a', 'b', 'c'], live: ['a', 'b'] }
    const now = [mk('a', 'open'), mk('b', 'done'), mk('c', 'dismissed'), mk('n', 'open'), mk('w', 'candidate'), mk('x', 'rejected')]
    expect(recap(now, seen)).toEqual({ at: '2026-10-03T10:00:00.000Z', fresh: 2, closed: 1 })
  })
  test('without a usable snapshot there is no recap', () => {
    expect(recap([], null)).toBe(null)
    expect(recap([], { at: 'x' })).toBe(null)
  })
})

describe('prune', () => {
  const NOW = Date.parse('2026-10-04T10:00:00.000Z')
  const mk = (id: string, status: string, closedAt?: string) => ({ id, text: id, status, priority: 'medium', createdAt: '2026-08-01T00:00:00.000Z', ...(closedAt ? { closedAt } : {}) })
  test('closed, dismissed and expired items go 30 days after closing; live ones and candidates stay', () => {
    expect(CLOSED_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000)
    const items = [
      mk('old-done', 'done', '2026-09-04T09:59:59.000Z'),
      mk('edge-done', 'done', '2026-09-04T10:00:00.000Z'),
      mk('old-dismissed', 'dismissed', '2026-08-01T00:00:00.000Z'),
      mk('old-expired', 'expired', '2026-08-01T00:00:00.000Z'),
      mk('open', 'open'),
      mk('doing', 'doing'),
      mk('candidate', 'candidate'),
    ]
    expect(prune(items, NOW).map(i => i.id)).toEqual(['edge-done', 'open', 'doing', 'candidate'])
  })
  test('only the 50 newest rejected stay, whatever their age', () => {
    expect(REJECTED_KEEP).toBe(50)
    const rejected = Array.from({ length: 52 }, (_, k) => mk(`r${k}`, 'rejected', new Date(Date.parse('2026-01-01T00:00:00.000Z') + k * 60000).toISOString()))
    expect(prune(rejected, NOW).map(i => i.id)).toEqual(rejected.slice(2).map(i => i.id))
  })
  test('a closed item without a readable closedAt is kept', () => {
    const items = [mk('no-date', 'done'), { ...mk('bad-date', 'dismissed'), closedAt: 'ayer' }]
    expect(prune(items, NOW).map(i => i.id)).toEqual(['no-date', 'bad-date'])
  })
  test('the same array comes back when nothing goes', () => {
    const items = [mk('open', 'open'), mk('done', 'done', '2026-10-03T00:00:00.000Z')]
    expect(prune(items, NOW)).toBe(items)
  })
})
