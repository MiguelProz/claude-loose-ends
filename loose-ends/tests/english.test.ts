import { expect, test } from 'claude-code/testing'
import { ROOT, world } from './world.ts'

// What the mod draws and says in English; the Spanish side is the rest of the suite.
const EN = { options: { language: 'en' } }
const TOOL = 'mcp__loose-ends__note_loose_end'
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as any }
const PANE = { component: 'Pane', requestId: 'loose-ends', props: { title: 'Notebook', isFocused: true, bodyColumns: 60, placement: 'dock' } as any }
const T0 = '2026-10-04T09:00:00.000Z'
const it = (id: string, text: string, over = {}) => ({ id, text, category: 'deuda', priority: 'medium', status: 'open', branch: 'main', createdAt: T0, ...over })
const blob = (...items: any[]) => JSON.stringify({ version: 2, items })
const EVIDENCE = 'I leave this for another day'
const EVIDENCE_2 = 'and I skip the test for now'
const longAnswer = () => `${'y'.repeat(500)} ${EVIDENCE}. ${EVIDENCE_2}`
const answered = (text: string) => ({ value: { isAnswered: true, text, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })
const drawEngine = (on: any) => on('ui.render', ($: any, e: any) => ({ type: 'Text', children: [e.props?.text ?? 'engine'] }))
const turns = (on: any) => {
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
}
const endTurn = ($: any, answer = longAnswer(), turnId = 't') => $.turn.complete({ answer, durationMs: 10, isAborted: false, turnId, reason: 'answer' })
const message = ($: any, text: string, surface = 'desktop') => $.ui.mount({ plugin: 'loose-ends', surface, component: 'AssistantMessage', props: { text, isFirstOfReply: true } as any })
const pane = ($: any, surface = 'desktop') => $.ui.mount({ plugin: 'loose-ends', surface, ...PANE })
const band = ($: any, surface = 'desktop') => $.ui.mount({ plugin: 'loose-ends', surface, ...BAND })
const withCandidate = () => blob(it('c1', 'Compress photo 3', { status: 'candidate', category: 'mejora', evidence: EVIDENCE }), it('a1', 'Type drafts'))
const find = (w: any, id: string) => w.saved().find((i: any) => i.id === id)

test('English by option: the band on both surfaces, the card under the message and the pane', EN, async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: withCandidate() } })
  drawEngine(on)
  await w.start($)
  await w.clock.settle()
  const desk = await band($)
  expect(await desk.find({ type: 'Text', text: '1 loose end awaits your OK' })).toBeDefined()
  expect((await desk.find({ key: 'band-act' }))?.props.label).toBe('Review')
  expect((await desk.find({ type: 'Svg' }))?.props.alt).toBe('Chispa holding a note: loose ends to review')
  await desk.unmount()
  const term = await band($, 'terminal')
  expect(await term.find({ type: 'Text', text: '1 to review · 1 open' })).toBeDefined()
  expect((await term.find({ key: 'open-pane' }))?.props.label).toBe('Review')
  await term.unmount()
  const msg = await message($, `Done. That said, ${EVIDENCE}.`)
  expect(await msg.find({ type: 'Text', text: 'Candidate loose end · improvement · normal' })).toBeDefined()
  expect((await msg.find({ key: 'tri-save-c1' }))?.props.label).toBe('Save')
  await msg.unmount()
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: 'To review' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'improvement · 1 h ago' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Only on this computer' })).toBeDefined()
  expect((await ui.find({ key: 'now-a1' }))?.props.label).toBe('Do it')
  await ui.unmount()
})

test('auto follows LANG when LC_ALL and LC_MESSAGES are unset', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: withCandidate() }, env: { LANG: 'en_US.UTF-8' } })
  await w.start($)
  const desk = await band($)
  expect(await desk.find({ type: 'Text', text: '1 loose end awaits your OK' })).toBeDefined()
  await desk.unmount()
})

test('auto with no locale variable set is English', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: withCandidate() }, env: {} })
  await w.start($)
  const desk = await band($)
  expect(await desk.find({ type: 'Text', text: '1 loose end awaits your OK' })).toBeDefined()
  await desk.unmount()
})

test('auto: LC_ALL wins over LANG', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: withCandidate() }, env: { LC_ALL: 'es_ES.UTF-8', LANG: 'en_US.UTF-8' } })
  await w.start($)
  const desk = await band($)
  expect(await desk.find({ type: 'Text', text: '1 cabo espera tu visto bueno' })).toBeDefined()
  await desk.unmount()
})

test('the option wins over the environment', { options: { language: 'es' } }, async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: withCandidate() }, env: { LANG: 'en_US.UTF-8' } })
  await w.start($)
  const term = await band($, 'terminal')
  expect(await term.find({ type: 'Text', text: '1 por revisar · 1 abierto' })).toBeDefined()
  await term.unmount()
})
