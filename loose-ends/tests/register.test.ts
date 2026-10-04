import { expect, test } from 'claude-code/testing'
import { PATH, world } from './world.ts'

const TOOL = 'mcp__loose-ends__note_loose_end'
const stopBottom = (on: any, block?: string) => on('classic.Stop', () => (block ? { block } : {}))

test('the tool writes the file and dedupes', async ($, on) => {
  const w = world(on)
  await w.start($)
  const first = await $.tool.call({ tool: TOOL, text: 'Añadir test de canonical', priority: 'high', evidence: 'lo dejo fuera' })
  expect(String(first.result)).toMatch(/^Apuntado \(\w{8}\): Añadir test de canonical$/)
  const again = await $.tool.call({ tool: TOOL, text: 'añadir TEST de canonical', priority: 'low' })
  expect(again.result).toBe('Ya estaba apuntado.')
  expect(w.saved()).toHaveLength(1)
  expect(w.saved()[0]).toMatchObject({ priority: 'high', source: 'tool', branch: 'main', status: 'open' })
})

test('a file with conflict markers is never overwritten', async ($, on) => {
  const broken = '{\n<<<<<<< HEAD\n"items": []\n=======\n>>>>>>> x\n}'
  const w = world(on, { [PATH]: broken })
  await w.start($)
  const r = await $.tool.call({ tool: TOOL, text: 'algo', priority: 'low' })
  expect(String(r.result)).toContain('ilegible')
  expect(w.fs[PATH]).toBe(broken)
})

test('the system prompt gets the guide section', async ($, on) => {
  world(on)
  on('prompt.compose', () => ({ sections: [{ id: 'core', text: 'x', scope: 'shared' }] }))
  const r = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['desktop'], tools: [], outputStyle: null, traits: [] })
  expect(r.sections.at(-1)).toMatchObject({ id: 'loose-ends:guide', scope: 'session' })
})

test('context carries open items', async ($, on) => {
  const file = JSON.stringify({ version: 1, items: [{ id: 'a1', text: 'Tipar drafts', priority: 'high', status: 'open', branch: 'main', createdAt: '2026-10-01T00:00:00.000Z' }] })
  const w = world(on, { [PATH]: file })
  on('prompt.context', ($: any, e: any) => ({ blocks: e.blocks }))
  await w.start($)
  const r = await $.prompt.context({ blocks: [] })
  expect(r.blocks.at(-1)).toMatchObject({ name: 'looseEnds' })
  expect(r.blocks.at(-1).text).toContain('Tipar drafts (a1')
})

test('Stop reminds queued items once, then they go back to open', async ($, on) => {
  const file = JSON.stringify({ version: 1, items: [{ id: 'q1', text: 'Docs de jsonld', priority: 'medium', status: 'queued', branch: 'main', createdAt: '2026-10-01T00:00:00.000Z' }] })
  const w = world(on, { [PATH]: file })
  stopBottom(on)
  await w.start($)
  const first = await $.classic.Stop({ stop_hook_active: false })
  expect(first.block).toContain('- Docs de jsonld (q1)')
  const second = await $.classic.Stop({ stop_hook_active: true })
  expect(second.block).toBeUndefined()
  expect(w.saved()[0]).toMatchObject({ status: 'open' })
})

test('Stop stays quiet when another Stop hook blocks', async ($, on) => {
  const file = JSON.stringify({ version: 1, items: [{ id: 'q1', text: 'Docs', priority: 'medium', status: 'queued', branch: 'main', createdAt: '2026-10-01T00:00:00.000Z' }] })
  const w = world(on, { [PATH]: file })
  stopBottom(on, 'typecheck falla')
  await w.start($)
  const r = await $.classic.Stop({ stop_hook_active: false })
  expect(r.block).toBe('typecheck falla')
  expect(w.saved()[0].remindedAt).toBeUndefined()
})
