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

test('English: the tool is described in English, takes English categories and stores the Spanish keys', EN, async ($, on) => {
  const w = world(on)
  await w.start($)
  const registered = w.tools.find((x: any) => x.name === 'note_loose_end')
  expect(registered.description).toBe("Proposes a loose end: concrete work on the code that you leave undone (a bug you see, debt, a test you skip, a warning you ignore, an out-of-scope improvement). The user decides whether it is kept; it is kept in the repo's refs/loose-ends.")
  expect(registered.inputSchema.properties.category.enum).toEqual(['bug', 'debt', 'test', 'warning', 'improvement'])
  const r = await $.tool.call({ tool: TOOL, text: 'Fix the duplicate invoice email', category: 'debt', priority: 'medium', evidence: 'I leave it out of scope', file: '/proj/lib/invoices.ts' })
  expect(String(r.result)).toMatch(/^Proposed as a loose end \(\w{8}\): Fix the duplicate invoice email\. The user will confirm it\.$/)
  await $.tool.call({ tool: TOOL, text: 'Silence the date warning properly', category: 'warning', priority: 'low' })
  await $.tool.call({ tool: TOOL, text: 'Cache the avatar thumbnails', category: 'improvement', priority: 'low' })
  await $.tool.call({ tool: TOOL, text: 'Corregir el parser de fechas', category: 'deuda', priority: 'low' })
  expect(w.saved().map((i: any) => i.category)).toEqual(['deuda', 'aviso', 'mejora', 'deuda'])
  expect(w.saved()[0]).toMatchObject({ status: 'candidate', file: 'lib/invoices.ts' })
  const short = await $.tool.call({ tool: TOOL, text: ' a ', category: 'bug', priority: 'low' })
  expect(short.result).toBe('Text too short: describe the loose end in one sentence.')
  const elsewhere = await $.tool.call({ tool: TOOL, text: 'Fix the other repo', category: 'bug', priority: 'low', repo: '/nowhere/file.ts' })
  expect(elsewhere.result).toBe('The path is not inside a git repo: nothing was proposed.')
})

test('English: the system prompt guide, the first message, the file reminder and the suggestion', EN, async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(it('a1', 'Fix the duplicate email', { priority: 'high', file: 'lib/invoices.ts' })) } })
  on('prompt.compose', () => ({ sections: [{ id: 'core', text: 'x', scope: 'shared' }] }))
  on('prompt.context', ($: any, e: any) => ({ blocks: e.blocks }))
  on('tool.call', () => ({ result: {} }))
  const said: string[] = []
  on('prompt.suggest', ($: any, e: any) => { said.push(e.text); return { isShown: true } })
  turns(on)
  await w.start($)
  const composed = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['desktop'], tools: [], outputStyle: null, traits: [] })
  expect(composed.sections.at(-1).text.split('\n')[0]).toBe('# Loose ends')
  const context = await $.prompt.context({ blocks: [] })
  expect(context.blocks.at(-1).text).toBe('Open loose ends from earlier sessions (refs/loose-ends). Keep them in mind; do not resolve them unless asked:\n- [high] Fix the duplicate email (a1, branch main)')
  await $.turn.start({ text: 'hello', turnId: 't' })
  const read = await $.tool.call({ tool: 'Read', file_path: '/proj/lib/invoices.ts' })
  expect(read.context).toEqual(['Open loose ends in this file: Fix the duplicate email (a1).'])
  await endTurn($, 'short')
  await w.clock.advance(500)
  expect(said).toEqual(['Resolve the loose end: Fix the duplicate email'])
  await $.turn.start({ text: 'Resolve the loose end: Fix the duplicate email', turnId: 't2' })
  await w.clock.settle()
  expect(find(w, 'a1').status).toBe('doing')
})

test('English: Do it sends the English prompt', EN, async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(it('a1', 'Type drafts', { evidence: 'drafts stay untyped' })) } })
  drawEngine(on)
  let sent = ''
  on('prompt.submit', ($: any, e: any) => { sent = e.text; return { text: e.text } })
  await w.start($)
  const ui = await pane($)
  await ui.press({ key: 'now-a1' })
  await w.clock.settle()
  expect(sent).toBe('Resolve this loose end (a1): Type drafts\nYou mentioned it like this: “drafts stay untyped”')
  await ui.unmount()
})

test('English: the sweep is asked in English and its English categories are stored with the Spanish keys', EN, async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(it('a1', 'Type drafts')) } })
  let system = ''
  let asked = ''
  on('model.complete', ($: any, e: any) => {
    system = e.system
    asked = e.prompt
    return answered(`{"new":[{"text":"Compress photo 3","category":"improvement","priority":"low","evidence":"${EVIDENCE}"}],"resolved":[]}`)
  })
  turns(on)
  await w.start($)
  await endTurn($)
  await w.clock.settle()
  expect(system.split('\n')[0]).toBe('You read the answer of a coding assistant and propose loose ends.')
  expect(asked).toContain('Open loose ends:\n- a1: Type drafts')
  expect(asked).toContain("Assistant's answer:\n<<<\n")
  expect(w.saved().find((i: any) => i.text === 'Compress photo 3')).toMatchObject({ status: 'candidate', source: 'sweep', category: 'mejora' })
})

test('English: the filter says why in English, and catches English and Spanish openings alike', EN, async ($, on) => {
  const w = world(on)
  await w.start($)
  const noCategory = await $.tool.call({ tool: TOOL, text: 'Fix the parser', priority: 'low' })
  expect(noCategory.result).toBe('Not proposed: no category (bug, debt, test, warning or improvement).')
  const waiting = await $.tool.call({ tool: TOOL, text: 'Wait for CI to finish', category: 'warning', priority: 'low' })
  expect(waiting.result).toBe('Not proposed: not work on the code (checking, waiting, deciding, notifying, pushing or deploying).')
  const spanish = await $.tool.call({ tool: TOOL, text: 'Comprobar el despliegue', category: 'warning', priority: 'low' })
  expect(spanish.result).toBe('Not proposed: not work on the code (checking, waiting, deciding, notifying, pushing or deploying).')
  await $.tool.call({ tool: TOOL, text: 'Fix the parser', category: 'bug', priority: 'low' })
  const again = await $.tool.call({ tool: TOOL, text: 'fix the PARSER', category: 'bug', priority: 'low' })
  expect(again.result).toBe('Not proposed: already noted.')
  expect(w.saved()).toHaveLength(1)
})

test('English: the command is /loose-ends, described in English, and opens the Notebook', EN, async ($, on) => {
  const w = world(on)
  let opened = ''
  let title = ''
  on('ui.open', ($: any, e: any) => { opened = e.id; title = e.title; return { value: { isPlaced: true } } })
  await w.start($)
  expect(w.commands.map((c: any) => c.name)).toEqual(['loose-ends'])
  expect(w.commands[0]).toMatchObject({ description: 'Opens the notebook: loose ends to review, open and closed', immediate: true })
  await $.command.run({ command: 'loose-ends', args: '' })
  expect([opened, title]).toEqual(['loose-ends', 'Notebook'])
})

test('English: Do it during a turn says it waits in English', EN, async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(it('a1', 'Fix the login', { priority: 'high' })) } })
  drawEngine(on)
  turns(on)
  on('prompt.submit', ($: any, e: any) => ({ text: e.text }))
  await w.start($)
  await $.turn.start({ text: 'hello', turnId: 't' })
  const desk = await band($)
  await desk.press({ key: 'band-act' })
  await w.clock.settle()
  expect(w.toasts).toEqual(["I'll start it when Claude finishes: Fix the login"])
  await desk.unmount()
})

test('English: after your push it asks in English, and Always pushes and remembers', EN, async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(it('a1', 'Local one')) }, remote: { [ROOT]: '' } })
  const asked: any[] = []
  on('tool.call', ($: any, e: any) => {
    if (e.tool === 'AskUserQuestion') {
      asked.push(e.questions[0])
      return { result: { questions: e.questions, answers: { [e.questions[0].question]: 'Always' } } }
    }
    return { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
  })
  await w.start($)
  await w.clock.settle()
  await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
  await w.clock.settle()
  expect(asked[0].question).toBe("Push this repo's loose ends to origin too? They travel in refs/loose-ends, outside your branches.")
  expect(asked[0].header).toBe('Loose ends')
  expect(asked[0].options.map((o: any) => o.label ?? o)).toEqual(['Always', 'This time', 'Never'])
  expect(w.pushes).toEqual([ROOT])
  expect(w.config[ROOT]).toBe('true')
})

test('English: the import notice of the 0.3 file', EN, async ($, on) => {
  const w = world(on, { '/proj/.claude/loose-ends.json': JSON.stringify({ version: 1, items: [it('q1', 'Docs for jsonld'), it('q2', 'Second one')] }) })
  drawEngine(on)
  await w.start($)
  await w.clock.settle()
  const ui = await pane($)
  expect(await ui.find({ type: 'Text', text: 'Imported 2 loose ends from .claude/loose-ends.json. You can now delete the file from the repo.' })).toBeDefined()
  await ui.unmount()
})

test('English: debug lines are English, with the reason in English', EN, async ($, on) => {
  const w = world(on)
  await w.start($)
  await $.tool.call({ tool: TOOL, text: 'Wait for CI to finish', category: 'warning', priority: 'low' })
  expect(w.logs).toContain('loose-ends: candidate rejected (not work on the code (checking, waiting, deciding, notifying, pushing or deploying)): Wait for CI to finish')
})
