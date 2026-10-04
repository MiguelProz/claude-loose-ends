import { expect, test } from 'claude-code/testing'
import { PATH, world } from './world.ts'

const ok = (on: any) => on('tool.call', ($: any, e: any) => {
  if (e.tool === 'TaskCreate') return { result: { task: { id: 't1', subject: e.subject } } }
  if (e.tool === 'Bash') return e.command.includes('vitest') ? { isError: true, result: 'x', text: 'Tests 1 failed' } : { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
  return { result: {} }
})
const done = (on: any) => on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
const EVIDENCE = 'lo dejo para otro día'
// long enough to be swept (500+) and carrying the phrase the fake Haiku quotes as evidence
const longAnswer = (fill: string) => `${fill.repeat(500)} ${EVIDENCE}`
const answered = (text: string) => ({ value: { isAnswered: true, text, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })

test('sweep adds new loose ends and resolves open ones', async ($, on) => {
  const file = JSON.stringify({ version: 1, items: [{ id: 'a1', text: 'Tipar drafts', priority: 'medium', status: 'open', branch: 'main', createdAt: '2026-10-01T00:00:00.000Z' }] })
  const w = world(on, { [PATH]: file })
  let asked = ''
  on('model.complete', ($: any, e: any) => { asked = e.prompt; return answered('{"new":[{"text":"Comprimir foto 3","priority":"low","evidence":"lo dejo para otro día"}],"resolved":["a1"]}') })
  done(on)
  await w.start($)
  await $.turn.complete({ answer: longAnswer('y'), durationMs: 10, isAborted: false, turnId: 't', reason: 'answer' })
  await w.clock.settle()
  expect(asked).toContain('a1: Tipar drafts')
  const saved = w.saved()
  expect(saved.find((i: any) => i.id === 'a1')).toMatchObject({ status: 'done', closedBy: 'sweep' })
  expect(saved.find((i: any) => i.text === 'Comprimir foto 3')).toMatchObject({ source: 'sweep', priority: 'low' })
})

test('the sweep drops a new item whose evidence the answer never said', async ($, on) => {
  const w = world(on)
  on('model.complete', () => answered('{"new":[{"text":"Cabo inventado","priority":"high","evidence":"esto no aparece en la respuesta"},{"text":"Cabo real","priority":"low","evidence":"LO DEJO para  otro día"}],"resolved":[]}'))
  done(on)
  await w.start($)
  await $.turn.complete({ answer: longAnswer('y'), durationMs: 10, isAborted: false, turnId: 't', reason: 'answer' })
  await w.clock.settle()
  expect(w.saved().map((i: any) => i.text)).toEqual(['Cabo real'])
})

test('short answers are not swept; broken replies change nothing', async ($, on) => {
  const w = world(on)
  let calls = 0
  on('model.complete', () => { calls++; return answered('no es json') })
  done(on)
  await w.start($)
  await $.turn.complete({ answer: 'corto', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  await $.turn.complete({ answer: longAnswer('z'), durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  await w.clock.settle()
  expect(calls).toBe(1)
  expect(w.saved()).toEqual([])
})

test('tool calls still run through and are observed', async ($, on) => {
  const w = world(on)
  ok(on)
  await w.start($)
  const r = await $.tool.call({ tool: 'TaskCreate', subject: 'jsonld', description: 'd' })
  expect(r.result.task.id).toBe('t1')
  const b = await $.tool.call({ tool: 'Bash', command: 'npx vitest run' })
  expect(b.isError).toBe(true)
})

test('sweep never overwrites an item the user closed meanwhile', async ($, on) => {
  const item = { id: 'a1', text: 'Tipar drafts', priority: 'medium', status: 'open', branch: 'main', createdAt: '2026-10-01T00:00:00.000Z' }
  const w = world(on, { [PATH]: JSON.stringify({ version: 1, items: [item] }) })
  on('model.complete', () => {
    w.fs[PATH] = JSON.stringify({ version: 1, items: [{ ...item, status: 'dismissed', closedBy: 'user', closedAt: '2026-10-04T10:00:01.000Z' }] })
    return answered('{"new":[],"resolved":["a1"]}')
  })
  done(on)
  await w.start($)
  await $.turn.complete({ answer: longAnswer('y'), durationMs: 10, isAborted: false, turnId: 't', reason: 'answer' })
  await w.clock.settle()
  expect(w.saved()[0]).toMatchObject({ status: 'dismissed', closedBy: 'user' })
})

test('commits are bounded to today even for a resumed session', async ($, on) => {
  const w = world(on, {}, { startedAt: Date.parse('2026-10-01T08:00:00.000Z') })
  done(on)
  await w.start($)
  await $.turn.complete({ answer: 'corto', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  const midnight = new Date(Date.parse('2026-10-04T10:00:00.000Z'))
  midnight.setHours(0, 0, 0, 0)
  const log = w.runs.find(a => a[1] === 'log')
  expect(log).toContain(`--since=${midnight.toISOString()}`)
})

test('only an answered turn is swept', async ($, on) => {
  const w = world(on)
  let calls = 0
  on('model.complete', () => { calls++; return answered('{"new":[],"resolved":[]}') })
  done(on)
  await w.start($)
  await $.turn.complete({ answer: longAnswer('e'), durationMs: 1, isAborted: false, turnId: 't', reason: 'error' })
  await w.clock.settle()
  expect(calls).toBe(0)
  await $.turn.complete({ answer: longAnswer('e'), durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  await w.clock.settle()
  expect(calls).toBe(1)
})

test('a git failure after the turn does not reject the hook', async ($, on) => {
  const w = world(on)
  done(on)
  await w.start($)
  w.flags.failGit = true
  const r = await $.turn.complete({ answer: 'corto', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  expect(r.text).toBe('corto')
  expect(w.logs.some(l => l.includes('leer la rama tras el turno falló'))).toBe(true)
})

test('turn end refreshes the items from a file edited by hand', async ($, on) => {
  const w = world(on)
  done(on)
  on('prompt.context', ($: any, e: any) => ({ blocks: e.blocks }))
  await w.start($)
  w.fs[PATH] = JSON.stringify({ version: 1, items: [{ id: 'h1', text: 'Escrito a mano', priority: 'high', status: 'open', branch: 'main', createdAt: '2026-10-04T09:00:00.000Z' }] })
  await $.turn.complete({ answer: 'corto', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  const r = await $.prompt.context({ blocks: [] })
  expect(r.blocks.at(-1).text).toContain('Escrito a mano')
})

test('with git failing the items still refresh before the sweep', async ($, on) => {
  const w = world(on)
  let asked = ''
  on('model.complete', ($: any, e: any) => { asked = e.prompt; return answered('{"new":[],"resolved":[]}') })
  done(on)
  await w.start($)
  w.fs[PATH] = JSON.stringify({ version: 1, items: [{ id: 'n1', text: 'Añadido entre turnos', priority: 'low', status: 'open', branch: 'main', createdAt: '2026-10-04T09:00:00.000Z' }] })
  w.flags.failGit = true
  await $.turn.complete({ answer: longAnswer('y'), durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  await w.clock.settle()
  expect(w.logs.some(l => l.includes('leer la rama tras el turno falló'))).toBe(true)
  expect(w.logs.some(l => l.includes('leer los commits tras el turno falló'))).toBe(true)
  expect(asked).toContain('n1: Añadido entre turnos')
})
