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
// the box beneath the plugins: what reaches it is what the person would see
const suggestions = (on: any, isShown = true) => {
  const said: string[] = []
  on('prompt.suggest', ($: any, e: any) => { said.push(e.text); return { isShown } })
  return said
}
// the engine's own guess after a turn
const engineGuess = ($: any, text = 'Ejecuta los tests') => $.prompt.suggest({ text, origin: { kind: 'suggestion' } })

test('once the turn has ended the urgent item is proposed in the empty prompt', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(it('a1', 'Arreglar el login', { priority: 'high' }), it('b2', 'Otro')) } })
  const said = suggestions(on)
  turns(on)
  await w.start($)
  await endTurn($)
  await w.clock.settle()
  // not from inside turn.complete, where the box shows nothing while the turn runs
  expect(said).toEqual([])
  await w.clock.advance(500)
  expect(said).toEqual(['Resuelve el cabo: Arreglar el login'])
})

test('no suggestion without an urgent item, nor while candidates wait', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(it('a1', 'Normal')) } })
  const said = suggestions(on)
  turns(on)
  await w.start($)
  await endTurn($)
  await w.clock.advance(500)
  w.setRef(ROOT, blob(it('a1', 'Arreglar el login', { priority: 'high' }), it('c1', 'Candidato', { status: 'candidate' })))
  await endTurn($, 't2')
  await w.clock.advance(500)
  expect(said).toEqual([])
})

test('an urgent item already in progress, or with a closure waiting, is not suggested', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(it('a1', 'Arreglar el login', { priority: 'high', status: 'doing' })) } })
  const said = suggestions(on)
  turns(on)
  await w.start($)
  await endTurn($)
  await w.clock.advance(500)
  w.setRef(ROOT, blob(it('a1', 'Arreglar el login', { priority: 'high', proposal: { quote: 'ya está', at: T0 } })))
  await endTurn($, 't2')
  await w.clock.advance(500)
  expect(said).toEqual([])
  await engineGuess($)
  expect(said).toEqual(['Ejecuta los tests'])
})

test('the engine guess is replaced by the urgent item while one can be suggested, and left alone otherwise', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(it('a1', 'Arreglar el login', { priority: 'high' })) } })
  const said = suggestions(on)
  await w.start($)
  await engineGuess($)
  // another plugin's suggestion is its own business
  await $.prompt.suggest({ text: 'Revisa el PR', origin: { kind: 'plugin', name: 'otro' } })
  w.setRef(ROOT, blob(it('a1', 'Arreglar el login', { priority: 'high' }), it('c1', 'Candidato', { status: 'candidate' })))
  await w.start($)
  await engineGuess($)
  expect(said).toEqual(['Resuelve el cabo: Arreglar el login', 'Revisa el PR', 'Ejecuta los tests'])
})

test('a suggestion the box did not show leaves a line in the debug log', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(it('a1', 'Arreglar el login', { priority: 'high' })) } })
  suggestions(on, false)
  turns(on)
  await w.start($)
  await endTurn($)
  await w.clock.advance(500)
  expect(w.logs.some(l => l.includes('sugerencia') && l.includes('no se mostró'))).toBe(true)
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

const TOOL_PANE = { component: 'Pane', requestId: 'loose-ends', props: { title: 'Cuaderno', isFocused: true, bodyColumns: 60, placement: 'dock' } as any }

test('what this session wrote is not news for the next session', async ($, on) => {
  const w = world(on)
  on('ui.render', () => ({ type: 'Box', props: { children: [] } }))
  await w.start($)
  await w.clock.settle()
  const pane = await $.ui.mount({ plugin: 'loose-ends', surface: 'desktop', ...TOOL_PANE })
  await pane.input({ key: 'add-item', text: 'Cabo escrito a mano' })
  await w.clock.settle()
  await pane.unmount()
  expect(JSON.parse(w.fs[SEEN]).ids).toHaveLength(1)
  await w.start($)
  await w.clock.settle()
  const term = await $.ui.mount({ plugin: 'loose-ends', surface: 'terminal', ...BAND })
  expect(await term.find({ type: 'Text', text: '1 abierto' })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /Desde/ })).toBeUndefined()
  await term.unmount()
})

test('a close made in this session is not reported as closed in another session', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(it('a1', 'Abierto')) } })
  on('ui.render', () => ({ type: 'Box', props: { children: [] } }))
  await w.start($)
  await w.clock.settle()
  const pane = await $.ui.mount({ plugin: 'loose-ends', surface: 'desktop', ...TOOL_PANE })
  await pane.press({ key: 'done-a1' })
  await w.clock.settle()
  await pane.unmount()
  await w.start($)
  await w.clock.settle()
  const term = await $.ui.mount({ plugin: 'loose-ends', surface: 'terminal', ...BAND })
  expect(await term.find({ type: 'Text', text: /Desde/ })).toBeUndefined()
  await term.unmount()
})

test('an unreadable ref never overwrites what the last session saw', async ($, on) => {
  const seen = JSON.stringify({ at: '2026-10-03T10:00:00.000Z', ids: ['a1'], live: ['a1'] })
  const w = world(on, { [SEEN]: seen }, { refs: { [ROOT]: '{ roto' } })
  turns(on)
  await w.start($)
  await w.clock.settle()
  await endTurn($)
  await w.clock.settle()
  expect(w.fs[SEEN]).toBe(seen)
})

test('an errored tool call gets no loose ends and does not use up the file for the turn', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(it('a1', 'Arreglar el envío duplicado', { file: 'lib/facturas.ts' })) } })
  let calls = 0
  on('tool.call', () => (++calls === 1 ? { isError: true, result: 'x', text: 'File does not exist.' } : { result: {} }))
  turns(on)
  await w.start($)
  await $.turn.start({ text: 'hola', turnId: 't' })
  const failed = await $.tool.call({ tool: 'Read', file_path: '/proj/lib/facturas.ts' })
  expect(failed.context).toBeUndefined()
  const read = await $.tool.call({ tool: 'Read', file_path: '/proj/lib/facturas.ts' })
  expect(read.context).toEqual(['Cabos abiertos en este fichero: Arreglar el envío duplicado (a1).'])
})

test('a denied tool call does not use up the file for the turn', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(it('a1', 'Arreglar el envío duplicado', { file: 'lib/facturas.ts' })) } })
  let calls = 0
  on('tool.call', () => (++calls === 1 ? { deny: 'no' } : { result: {} }))
  turns(on)
  await w.start($)
  await $.turn.start({ text: 'hola', turnId: 't' })
  const denied = await $.tool.call({ tool: 'Read', file_path: '/proj/lib/facturas.ts' })
  expect(denied.context).toBeUndefined()
  const read = await $.tool.call({ tool: 'Read', file_path: '/proj/lib/facturas.ts' })
  expect(read.context).toEqual(['Cabos abiertos en este fichero: Arreglar el envío duplicado (a1).'])
})
