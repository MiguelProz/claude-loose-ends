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

test('the first write creates the ref and commit-tree runs with its own identity', async ($, on) => {
  const w = world(on)
  await w.start($)
  await $.tool.call({ tool: TOOL, category: 'deuda', text: 'Primer cabo de la ref', priority: 'low' })
  expect(w.runs.find(a => a.includes('update-ref'))?.at(-1)).toBe('0'.repeat(40))
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

test('an unreadable blob is never overwritten', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: '{ roto' } })
  await w.start($)
  const r = await $.tool.call({ tool: TOOL, category: 'deuda', text: 'Cabo sobre roto', priority: 'low' })
  expect(String(r.result)).toContain('/proj (refs/loose-ends)')
  expect(String(r.result)).toContain('(json)')
  expect(w.refText(ROOT)).toBe('{ roto')
  expect(w.writes).toEqual([])
})
