import { expect, test } from 'claude-code/testing'
import { ROOT, world } from './world.ts'

const TOOL = 'mcp__loose-ends__note_loose_end'
const item = (id: string, text: string) => ({ id, text, priority: 'medium', status: 'open', branch: 'main', createdAt: '2026-10-04T09:00:00.000Z' })
const blob = (...items: any[]) => JSON.stringify({ version: 1, items })

test('a note lands in refs/loose-ends and never in the working tree', async ($, on) => {
  const w = world(on)
  await w.start($)
  await $.tool.call({ tool: TOOL, category: 'deuda', text: 'Cabo guardado en la ref', priority: 'low' })
  expect(w.saved().map((i: any) => i.text)).toEqual(['Cabo guardado en la ref'])
  expect(w.writes).toEqual([ROOT])
  // nothing in the working tree (Task 10 adds a file inside .git, which is not the working tree)
  expect(Object.keys(w.fs).filter(k => !k.includes('/.git/'))).toEqual([])
})

test('the first write creates the ref, guarded by an empty old value, and commit-tree runs with its own identity', async ($, on) => {
  const w = world(on)
  await w.start($)
  await $.tool.call({ tool: TOOL, category: 'deuda', text: 'Primer cabo de la ref', priority: 'low' })
  expect(w.runs.find(a => a.includes('update-ref'))?.slice(3)).toEqual(['update-ref', 'refs/loose-ends/items', expect.stringMatching(/^[0-9a-f]{40}$/), ''])
  expect(w.envs[0]).toMatchObject({ GIT_AUTHOR_NAME: 'loose-ends' })
})

test('a write that loses the race to another session rereads, merges and retries', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(item('a1', 'Cabo previo')) } })
  await w.start($)
  w.race(ROOT, blob(item('a1', 'Cabo previo'), item('b2', 'Cabo de otra sesión')))
  await $.tool.call({ tool: TOOL, category: 'deuda', text: 'Cabo de esta sesión', priority: 'low' })
  expect(w.saved().map((i: any) => i.text)).toEqual(['Cabo previo', 'Cabo de otra sesión', 'Cabo de esta sesión'])
})

test('after three lost races the note gives up and says so', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob() } })
  await w.start($)
  w.race(ROOT, blob(item('b2', 'Cabo de otra sesión')), 3)
  const r = await $.tool.call({ tool: TOOL, category: 'deuda', text: 'Cabo que no entra', priority: 'low' })
  expect(String(r.result)).toContain('(busy)')
  expect(w.saved().map((i: any) => i.text)).toEqual(['Cabo de otra sesión'])
})

test('when git cannot write the object, the note answers why instead of throwing', async ($, on) => {
  const w = world(on)
  await w.start($)
  w.flags.failWrites = true
  const r = await $.tool.call({ tool: TOOL, category: 'deuda', text: 'Cabo que git no escribe', priority: 'low' })
  expect(r.result).toBe('No se pudo proponer: los cabos de /proj (refs/loose-ends) no se pueden leer (git hash-object falló).')
  expect(w.writes).toEqual([])
})

test('an unreadable blob is never overwritten', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: '{ roto' } })
  await w.start($)
  const r = await $.tool.call({ tool: TOOL, category: 'deuda', text: 'Cabo sobre roto', priority: 'low' })
  expect(String(r.result)).toContain('/proj (refs/loose-ends)')
  expect(String(r.result)).toContain('(json)')
  expect(w.refText(ROOT)).toBe('{ roto')
  expect(w.writes).toEqual([])
})

test('a write leaves out closed items older than 30 days', async ($, on) => {
  const old = { ...item('d1', 'Cerrado hace mucho'), status: 'done', closedAt: '2026-08-01T00:00:00.000Z' }
  const recent = { ...item('d2', 'Cerrado ayer'), status: 'done', closedAt: '2026-10-03T00:00:00.000Z' }
  const w = world(on, {}, { refs: { [ROOT]: blob(old, recent, item('a1', 'Abierto')) } })
  await w.start($)
  await $.tool.call({ tool: TOOL, category: 'deuda', text: 'Cabo nuevo para escribir', priority: 'low' })
  expect(w.saved().map((i: any) => i.id).filter((id: string) => id.length === 2)).toEqual(['d2', 'a1'])
  expect(w.saved().some((i: any) => i.text === 'Cabo nuevo para escribir')).toBe(true)
})
