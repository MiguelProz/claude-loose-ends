import { expect, test } from 'claude-code/testing'
import { PATH, world } from './world.ts'

const ok = (on: any) => on('tool.call', ($: any, e: any) => {
  if (e.tool === 'TaskCreate') return { result: { task: { id: 't1', subject: e.subject } } }
  if (e.tool === 'Bash') return e.command.includes('vitest') ? { isError: true, result: 'x', text: 'Tests 1 failed' } : { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
  return { result: {} }
})
const done = (on: any) => on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
const answered = (text: string) => ({ value: { isAnswered: true, text, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })

test('sweep adds new loose ends and resolves open ones', async ($, on) => {
  const file = JSON.stringify({ version: 1, items: [{ id: 'a1', text: 'Tipar drafts', priority: 'medium', status: 'open', branch: 'main', createdAt: '2026-10-01T00:00:00.000Z' }] })
  const w = world(on, { [PATH]: file })
  let asked = ''
  on('model.complete', ($: any, e: any) => { asked = e.prompt; return answered('{"new":[{"text":"Comprimir foto 3","priority":"low"}],"resolved":["a1"]}') })
  done(on)
  await w.start($)
  await $.turn.complete({ answer: 'y'.repeat(400), durationMs: 10, isAborted: false, turnId: 't', reason: 'answer' })
  await w.clock.settle()
  expect(asked).toContain('a1: Tipar drafts')
  const saved = w.saved()
  expect(saved.find((i: any) => i.id === 'a1')).toMatchObject({ status: 'done', closedBy: 'sweep' })
  expect(saved.find((i: any) => i.text === 'Comprimir foto 3')).toMatchObject({ source: 'sweep', priority: 'low' })
})

test('short answers are not swept; broken replies change nothing', async ($, on) => {
  const w = world(on)
  let calls = 0
  on('model.complete', () => { calls++; return answered('no es json') })
  done(on)
  await w.start($)
  await $.turn.complete({ answer: 'corto', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
  await $.turn.complete({ answer: 'z'.repeat(400), durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
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
