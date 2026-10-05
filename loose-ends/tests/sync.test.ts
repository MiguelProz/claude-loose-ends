import { expect, test } from 'claude-code/testing'
import { LEGACY, ROOT, world } from './world.ts'

const TOOL = 'mcp__loose-ends__note_loose_end'
const item = (id: string, text: string, over = {}) => ({ id, text, priority: 'medium', status: 'open', branch: 'main', createdAt: '2026-10-04T09:00:00.000Z', ...over })
const blob = (...items: any[]) => JSON.stringify({ version: 1, items })
// $.ui.ask is a tool.call of AskUserQuestion: the stub answers it, and answers Bash like a git push that worked (or failed).
const tools = (on: any, { answer = 'Siempre', pushFails = false } = {}) => {
  const asked: string[] = []
  on('tool.call', ($: any, e: any) => {
    if (e.tool === 'AskUserQuestion') {
      const question = e.questions[0].question
      asked.push(question)
      return { result: { questions: e.questions, answers: { [question]: answer } } }
    }
    return pushFails ? { isError: true, result: 'x', text: 'error: failed to push' } : { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
  })
  return asked
}
const push = ($: any) => $.tool.call({ tool: 'Bash', command: 'git push origin main' })

test('the 0.3 file is imported once into the ref and left where it was', async ($, on) => {
  const legacy = blob(item('a1', 'Cabo antiguo'))
  const w = world(on, { [LEGACY]: legacy })
  await w.start($)
  await w.clock.settle()
  expect(w.saved().map((i: any) => i.id)).toEqual(['a1'])
  expect(w.fs[LEGACY]).toBe(legacy)
  await w.start($)
  await w.clock.settle()
  expect(w.saved()).toHaveLength(1)
  expect(w.writes).toEqual([ROOT])
})

test('the import keeps what the ref already has and adds only the ids it lacks', async ($, on) => {
  const w = world(on, { [LEGACY]: blob(item('a1', 'Versión vieja'), item('b2', 'Solo en el fichero')) }, { refs: { [ROOT]: blob(item('a1', 'Versión de la ref')) } })
  await w.start($)
  await w.clock.settle()
  expect(w.saved().map((i: any) => i.text)).toEqual(['Versión de la ref', 'Solo en el fichero'])
})

test('a broken 0.3 file imports nothing and breaks nothing', async ($, on) => {
  const w = world(on, { [LEGACY]: '{ roto' })
  await w.start($)
  await w.clock.settle()
  expect(w.saved()).toEqual([])
  expect(w.writes).toEqual([])
})

test('at start origin loose ends are merged into the local ref', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(item('a1', 'Local')) }, remote: { [ROOT]: blob(item('o1', 'De otro ordenador')) } })
  await w.start($)
  await w.clock.settle()
  expect(w.fetches).toEqual([ROOT])
  expect(w.saved().map((i: any) => i.text)).toEqual(['Local', 'De otro ordenador'])
})

test('a failed fetch at start leaves a line in the debug log', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(item('a1', 'Local')) }, remote: { [ROOT]: '' } })
  await w.start($)
  await w.clock.settle()
  expect(w.logs).toContain('loose-ends: no se pudieron traer los cabos de origin')
})

test('a failing import does not stop origin from being fetched, and says so in the log', async ($, on) => {
  const w = world(on, { [LEGACY]: blob(item('a1', 'Cabo antiguo')) }, { remote: { [ROOT]: blob(item('o1', 'Remoto')) } })
  w.flags.failWrites = true
  await w.start($)
  await w.clock.settle()
  expect(w.fetches).toEqual([ROOT])
  expect(w.logs.some(l => l.includes('importar .claude/loose-ends.json falló'))).toBe(true)
})

test('without origin nothing is fetched', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(item('a1', 'Local')) } })
  await w.start($)
  await w.clock.settle()
  expect(w.runs.some(a => a.includes('fetch'))).toBe(false)
})

test('after the person pushes, the first time asks; Siempre pushes and remembers', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(item('a1', 'Local')) }, remote: { [ROOT]: '' } })
  const asked = tools(on, { answer: 'Siempre' })
  await w.start($)
  await w.clock.settle()
  await push($)
  await w.clock.settle()
  expect(asked).toHaveLength(1)
  expect(w.pushes).toEqual([ROOT])
  expect(w.remoteText(ROOT)).toBe(w.refText(ROOT))
  expect(w.config[ROOT]).toBe('true')
  await $.tool.call({ tool: TOOL, category: 'deuda', text: 'Otro cabo más', priority: 'low' })
  await push($)
  await w.clock.settle()
  expect(asked).toHaveLength(1)
  expect(w.pushes).toEqual([ROOT, ROOT])
})

test('a push chained after a commit in one command still pushes the ref', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(item('a1', 'Local')) }, remote: { [ROOT]: '' }, sync: { [ROOT]: 'true' } })
  tools(on)
  await w.start($)
  await w.clock.settle()
  await $.tool.call({ tool: 'Bash', command: 'git add . && git commit -m x && git push' })
  await w.clock.settle()
  expect(w.pushes).toEqual([ROOT])
})

test('Nunca remembers and never pushes', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(item('a1', 'Local')) }, remote: { [ROOT]: '' } })
  const asked = tools(on, { answer: 'Nunca' })
  await w.start($)
  await w.clock.settle()
  await push($)
  await w.clock.settle()
  await push($)
  await w.clock.settle()
  expect(asked).toHaveLength(1)
  expect(w.pushes).toEqual([])
  expect(w.config[ROOT]).toBe('false')
})

test('Esta vez pushes without remembering', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(item('a1', 'Local')) }, remote: { [ROOT]: '' } })
  tools(on, { answer: 'Esta vez' })
  await w.start($)
  await w.clock.settle()
  await push($)
  await w.clock.settle()
  expect(w.pushes).toEqual([ROOT])
  expect(w.config[ROOT]).toBeUndefined()
})

test('with nothing to push nothing is asked', async ($, on) => {
  const w = world(on, {}, { remote: { [ROOT]: '' } })
  const asked = tools(on)
  await w.start($)
  await w.clock.settle()
  await push($)
  await w.clock.settle()
  expect(asked).toEqual([])
})

test('a failed git push of the person pushes nothing', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(item('a1', 'Local')) }, remote: { [ROOT]: '' } })
  const asked = tools(on, { pushFails: true })
  await w.start($)
  await w.clock.settle()
  await push($)
  await w.clock.settle()
  expect(asked).toEqual([])
  expect(w.pushes).toEqual([])
})

test('if origin moved after the fetch, the push is refused and nothing is overwritten', async ($, on) => {
  const w = world(on, {}, { refs: { [ROOT]: blob(item('a1', 'Local')) }, remote: { [ROOT]: blob(item('o1', 'Remoto')) }, sync: { [ROOT]: 'true' } })
  tools(on)
  await w.start($)
  await w.clock.settle()
  await $.tool.call({ tool: TOOL, category: 'deuda', text: 'Cambio local nuevo', priority: 'low' })
  w.remoteRace(ROOT, blob(item('o2', 'Empujado por otro')))
  await push($)
  await w.clock.settle()
  expect(w.pushes).toEqual([])
  expect(w.remoteText(ROOT)).toContain('Empujado por otro')
  expect(w.logs.some(l => l.includes('no se pudieron subir'))).toBe(true)
})
