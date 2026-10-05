import { expect, test } from 'claude-code/testing'
import { ROOT, world } from './world.ts'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as any }
const T0 = '2026-10-04T09:00:00.000Z'
const it = (id: string, text: string, over = {}) => ({ id, text, category: 'deuda', priority: 'medium', status: 'open', branch: 'main', createdAt: T0, ...over })
const blob = (...items: any[]) => JSON.stringify({ version: 2, items })
const SEEN = '/proj/.git/loose-ends-seen.json'
const turns = (on: any) => {
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
}
const endTurn = ($: any, turnId = 't') => $.turn.complete({ answer: 'corto', durationMs: 10, isAborted: false, turnId, reason: 'answer' })
const suggestions = (on: any) => {
  const said: string[] = []
  on('prompt.suggest', ($: any, e: any) => { said.push(e.text); return { isShown: true } })
  return said
}

test('after a turn the urgent item is proposed in the empty prompt', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(it('a1', 'Arreglar el login', { priority: 'high' }), it('b2', 'Otro')) } })
  const said = suggestions(on)
  turns(on)
  await w.start($)
  await endTurn($)
  await w.clock.settle()
  expect(said).toEqual(['Resuelve el cabo: Arreglar el login'])
})

test('no suggestion without an urgent item, nor while candidates wait', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(it('a1', 'Normal')) } })
  const said = suggestions(on)
  turns(on)
  await w.start($)
  await endTurn($)
  await w.clock.settle()
  w.setRef(ROOT, blob(it('a1', 'Arreglar el login', { priority: 'high' }), it('c1', 'Candidato', { status: 'candidate' })))
  await endTurn($, 't2')
  await w.clock.settle()
  expect(said).toEqual([])
})

test('a prompt that takes the suggestion starts the item', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(it('a1', 'Arreglar el login', { priority: 'high' })) } })
  turns(on)
  await w.start($)
  await $.turn.start({ text: 'Resuelve el cabo: Arreglar el login', turnId: 't' })
  await w.clock.settle()
  expect(w.saved()[0].status).toBe('doing')
})

test('reading or editing a file with open loose ends tells Claude, once per file and turn', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(it('a1', 'Arreglar el envío duplicado', { file: 'lib/facturas.ts' }), it('b2', 'Cerrado ya', { file: 'lib/facturas.ts', status: 'done' })) } })
  on('tool.call', () => ({ result: {} }))
  turns(on)
  await w.start($)
  await $.turn.start({ text: 'hola', turnId: 't' })
  const first = await $.tool.call({ tool: 'Read', file_path: '/proj/lib/facturas.ts' })
  expect(first.context).toEqual(['Cabos abiertos en este fichero: Arreglar el envío duplicado (a1).'])
  const again = await $.tool.call({ tool: 'Edit', file_path: '/proj/lib/facturas.ts', old_string: 'a', new_string: 'b' })
  expect(again.context).toBeUndefined()
  const other = await $.tool.call({ tool: 'Read', file_path: '/proj/lib/otro.ts' })
  expect(other.context).toBeUndefined()
  await endTurn($)
  await $.turn.start({ text: 'sigue', turnId: 't2' })
  const nextTurn = await $.tool.call({ tool: 'Read', file_path: '/proj/lib/facturas.ts' })
  expect(nextTurn.context).toEqual(['Cabos abiertos en este fichero: Arreglar el envío duplicado (a1).'])
})

test('the band says what changed since the last session, until the first turn ends', async ($, on) => {
  const seen = JSON.stringify({ at: '2026-10-03T10:00:00.000Z', ids: ['a1', 'b2'], live: ['a1', 'b2'] })
  const w = world(on, { [SEEN]: seen }, { refs: { [ROOT]: blob(it('a1', 'Sigue abierto'), it('b2', 'Cerrado en otra sesión', { status: 'done', closedAt: T0 }), it('n1', 'Nuevo uno'), it('n2', 'Nuevo dos')) } })
  on('ui.render', () => ({ type: 'Box', props: { children: [] } }))
  turns(on)
  await w.start($)
  await w.clock.settle()
  const term = await $.ui.mount({ plugin: 'loose-ends', surface: 'terminal', ...BAND })
  expect(await term.find({ type: 'Text', text: 'Desde ayer: 2 nuevos · 1 cerrado en otra sesión' })).toBeDefined()
  await endTurn($)
  await w.clock.settle()
  await term.redraw()
  expect(await term.find({ type: 'Text', text: '3 abiertos' })).toBeDefined()
  expect(JSON.parse(w.fs[SEEN]).ids).toEqual(['a1', 'b2', 'n1', 'n2'])
  await term.unmount()
})

test('the first session in a repo records what it sees and says nothing about it', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(it('a1', 'Abierto')) } })
  on('ui.render', () => ({ type: 'Box', props: { children: [] } }))
  await w.start($)
  await w.clock.settle()
  expect(JSON.parse(w.fs[SEEN])).toEqual({ at: '2026-10-04T10:00:00.000Z', ids: ['a1'], live: ['a1'] })
  const term = await $.ui.mount({ plugin: 'loose-ends', surface: 'terminal', ...BAND })
  expect(await term.find({ type: 'Text', text: '1 abierto' })).toBeDefined()
  await term.unmount()
})
