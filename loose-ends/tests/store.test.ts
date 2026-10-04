import { describe, expect, test } from 'claude-code/testing'
import { addItem, active, close, counts, dueReminders, expireReminded, markReminded, normalize, parseFile, queue, reopen, serialize, setPriority } from '../lib/store.mjs'

const NOW = '2026-10-04T10:00:00.000Z'
const base = (over = {}) => ({ id: 'a1', text: 'Falta doc de jsonld', priority: 'medium', source: 'tool', branch: 'main', now: NOW, ...over })

describe('parseFile', () => {
  test('empty or missing file is an empty list', () => {
    expect(parseFile(null)).toEqual({ ok: true, items: [] })
    expect(parseFile('  ')).toEqual({ ok: true, items: [] })
  })
  test('conflict markers are refused', () => {
    expect(parseFile('{\n<<<<<<< HEAD\n}')).toEqual({ ok: false, error: 'conflict' })
  })
  test('broken JSON and wrong shape are refused', () => {
    expect(parseFile('{nope')).toEqual({ ok: false, error: 'json' })
    expect(parseFile('{"items": 3}')).toEqual({ ok: false, error: 'shape' })
  })
  test('round-trips through serialize', () => {
    const { items } = addItem([], base())
    const text = serialize(items)
    expect(text.endsWith('\n')).toBe(true)
    expect(parseFile(text)).toEqual({ ok: true, items })
  })
})

describe('addItem', () => {
  test('adds an open item with defaults', () => {
    const { items, added } = addItem([], base({ priority: 'urgent', evidence: 'x'.repeat(500) }))
    expect(added).toMatchObject({ id: 'a1', status: 'open', priority: 'medium', createdAt: NOW })
    expect(added.evidence.length).toBe(400)
    expect(items).toHaveLength(1)
  })
  test('dedupes against active items ignoring case, accents and punctuation', () => {
    const { items } = addItem([], base())
    const again = addItem(items, base({ id: 'b2', text: 'falta DOC de JSON-LD!' }))
    expect(normalize('Falta doc de jsonld')).toBe('faltadocdejsonld')
    expect(again.added).toBe(null)
    expect(addItem(items, base({ id: 'b2', text: 'Falta doc de jsonld.' })).added).toBe(null)
  })
  test('a closed duplicate does not block a new one', () => {
    const { items } = addItem([], base())
    const closed = close(items, 'a1', { status: 'done', closedBy: 'user', now: NOW })
    expect(addItem(closed, base({ id: 'b2' })).added?.id).toBe('b2')
  })
  test('ignores empty text', () => {
    expect(addItem([], base({ text: '  ' })).added).toBe(null)
  })
})

describe('transitions', () => {
  const start = addItem([], base()).items
  test('close, reopen, queue, priority', () => {
    const done = close(start, 'a1', { status: 'dismissed', reason: 'no aplica', closedBy: 'user', now: NOW })
    expect(done[0]).toMatchObject({ status: 'dismissed', reason: 'no aplica', closedBy: 'user', closedAt: NOW })
    const back = reopen(done, 'a1')
    expect(back[0].status).toBe('open')
    expect(JSON.parse(serialize(back)).items[0].reason).toBeUndefined()
    expect(queue(start, 'a1')[0].status).toBe('queued')
    expect(setPriority(start, 'a1', 'high')[0].priority).toBe('high')
    expect(setPriority(start, 'a1', 'nope')[0].priority).toBe('medium')
  })
  test('reminders fire once, then expire back to open', () => {
    const queued = queue(start, 'a1')
    expect(dueReminders(queued).map(i => i.id)).toEqual(['a1'])
    const reminded = markReminded(queued, ['a1'], NOW)
    expect(dueReminders(reminded)).toEqual([])
    const expired = expireReminded(reminded)
    expect(expired[0]).toMatchObject({ status: 'open' })
    expect(expired[0].remindedAt).toBeUndefined()
  })
})

describe('queries', () => {
  test('active sorts by priority then age; counts by branch', () => {
    let list = addItem([], base({ id: 'l', text: 'baja', priority: 'low', now: '2026-10-01T00:00:00.000Z' })).items
    list = addItem(list, base({ id: 'h', text: 'alta', priority: 'high', branch: 'feat/x' })).items
    list = addItem(list, base({ id: 'm', text: 'media', priority: 'medium' })).items
    list = close(list, 'm', { status: 'done', closedBy: 'sweep', now: NOW })
    expect(active(list).map(i => i.id)).toEqual(['h', 'l'])
    expect(counts(list, 'main')).toEqual({ open: 1, high: 0, queued: 0 })
    expect(counts(list, 'feat/x')).toEqual({ open: 1, high: 1, queued: 0 })
  })
})
