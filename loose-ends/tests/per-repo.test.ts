import { expect, test } from 'claude-code/testing'
import { PATH, pathOf, world } from './world.ts'

const TOOL = 'mcp__loose-ends__note_loose_end'
const REPOS = { '/proj': '/proj', '/other': '/other' }
const OTHER = pathOf('/other')
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as any }
const PANE = { component: 'Pane', requestId: 'loose-ends', props: { title: 'Cuaderno', isFocused: true, bodyColumns: 60, placement: 'dock' } as any }
const own = JSON.stringify({ version: 1, items: [{ id: 'a1', text: 'Cabo de la sesión', priority: 'medium', status: 'open', branch: 'main', createdAt: '2026-10-04T09:00:00.000Z' }] })
const answered = (text: string) => ({ value: { isAnswered: true, text, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })
const tools = (on: any) => on('tool.call', () => ({ result: {} }))
const turns = (on: any) => {
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
}
const startTurn = ($: any, turnId = 't') => $.turn.start({ text: 'hola', turnId })
const endTurn = ($: any, turnId = 't') => $.turn.complete({ answer: 'y'.repeat(400), durationMs: 10, isAborted: false, turnId, reason: 'answer' })

test('a note with repo goes to that repo, not to the session file', async ($, on) => {
  const w = world(on, { [PATH]: own }, { repos: REPOS, branches: { '/other': 'feat/o' } })
  on('ui.render', () => ({ type: 'Box', props: { children: [] } }))
  await w.start($)
  const r = await $.tool.call({ tool: TOOL, text: 'Cabo del otro repo', priority: 'low', repo: '/other/src/a.ts' })
  expect(String(r.result)).toMatch(/^Apuntado \(\w{8}\): Cabo del otro repo$/)
  expect(w.savedAt(OTHER)).toHaveLength(1)
  expect(w.savedAt(OTHER)[0]).toMatchObject({ text: 'Cabo del otro repo', source: 'tool', branch: 'feat/o', status: 'open' })
  expect(w.fs[PATH]).toBe(own)
  expect(w.writes).toEqual([OTHER])
  expect(w.toasts).toEqual(['Cabo suelto (other): Cabo del otro repo'])
  const band = await $.ui.mount({ plugin: 'loose-ends', surface: 'desktop', ...BAND })
  expect((await band.find({ type: 'Text', text: /cabo/ }))?.text).toBe('⚠ 1 cabo')
  await band.unmount()
})

test('repo pointing at a folder of the session repo writes the session file', async ($, on) => {
  const w = world(on, {}, { repos: REPOS })
  await w.start($)
  await $.tool.call({ tool: TOOL, text: 'Cabo de la sesión', priority: 'low', repo: '/proj/src' })
  expect(w.saved()).toHaveLength(1)
  expect(w.toasts).toEqual(['Cabo suelto: Cabo de la sesión'])
})

test('a repo that is not in git writes nothing and says so', async ($, on) => {
  const w = world(on, { [PATH]: own }, { repos: REPOS })
  await w.start($)
  for (const repo of ['/nowhere/x', 'relative/dir']) {
    const r = await $.tool.call({ tool: TOOL, text: 'Cabo perdido', priority: 'low', repo })
    expect(r.result).toBe('La ruta no está dentro de un repo git: no se ha apuntado.')
  }
  expect(w.writes).toEqual([])
  expect(w.toasts).toEqual([])
})

test('an unreadable file in the other repo is not overwritten', async ($, on) => {
  const broken = '<<<<<<< HEAD\n{}\n=======\n>>>>>>> x\n'
  const w = world(on, { [OTHER]: broken }, { repos: REPOS })
  await w.start($)
  const r = await $.tool.call({ tool: TOOL, text: 'Cabo en otro', priority: 'low', repo: '/other' })
  expect(String(r.result)).toContain('ilegible')
  expect(w.fs[OTHER]).toBe(broken)
})

test('the session repo is the toplevel of the root, not the root itself', async ($, on) => {
  const w = world(on, {}, { repos: REPOS, root: '/proj/packages/app' })
  await w.start($)
  await $.tool.call({ tool: TOOL, text: 'Cabo desde un subdirectorio', priority: 'low' })
  expect(w.writes).toEqual([PATH])
})

test('the session repo is refreshed after each turn', async ($, on) => {
  const w = world(on, { [PATH]: own, [OTHER]: JSON.stringify({ version: 1, items: [{ id: 'o1', text: 'Cabo del otro', priority: 'high', status: 'open', branch: 'main', createdAt: '2026-10-04T09:00:00.000Z' }] }) }, { repos: REPOS })
  on('prompt.context', ($: any, e: any) => ({ blocks: e.blocks }))
  turns(on)
  await w.start($)
  expect((await $.prompt.context({ blocks: [] })).blocks.at(-1).text).toContain('Cabo de la sesión')
  w.setRoot('/other')
  await endTurn($)
  await w.clock.settle()
  const text = (await $.prompt.context({ blocks: [] })).blocks.at(-1).text
  expect(text).toContain('Cabo del otro')
  expect(text).not.toContain('Cabo de la sesión')
})

test('the sweep files a new item in a repo touched this turn when Haiku names it', async ($, on) => {
  const w = world(on, { [PATH]: own }, { repos: REPOS, branches: { '/other': 'feat/o' } })
  let asked = ''
  on('model.complete', ($: any, e: any) => { asked = e.prompt; return answered('{"new":[{"text":"Cabo para el otro","priority":"low","repo":"/other"},{"text":"Cabo para la sesión","priority":"low"}],"resolved":["a1"]}') })
  tools(on)
  turns(on)
  await w.start($)
  await startTurn($)
  await $.tool.call({ tool: 'Edit', file_path: '/other/src/a.ts' })
  await endTurn($)
  await w.clock.settle()
  expect(asked).toContain('Repos candidatos:\n- proj: /proj\n- other: /other')
  expect(w.savedAt(OTHER).map((i: any) => [i.text, i.branch, i.source])).toEqual([['Cabo para el otro', 'feat/o', 'sweep']])
  expect(w.saved().map((i: any) => [i.text, i.status])).toEqual([['Cabo de la sesión', 'done'], ['Cabo para la sesión', 'open']])
  expect(w.toasts).toContain('Cabo suelto (other): Cabo para el otro')
})

test('the sweep falls back to the session repo when the path is not a candidate', async ($, on) => {
  const w = world(on, {}, { repos: REPOS })
  on('model.complete', () => answered('{"new":[{"text":"Cabo con repo inventado","priority":"low","repo":"/other"}],"resolved":[]}'))
  tools(on)
  turns(on)
  await w.start($)
  await startTurn($)
  await endTurn($)
  await w.clock.settle()
  expect(w.saved().map((i: any) => i.text)).toEqual(['Cabo con repo inventado'])
  expect(w.writes).toEqual([PATH])
})

test('a prompt with only the session repo carries no repo section', async ($, on) => {
  const w = world(on, {}, { repos: REPOS })
  let asked = ''
  on('model.complete', ($: any, e: any) => { asked = e.prompt; return answered('{"new":[],"resolved":[]}') })
  tools(on)
  turns(on)
  await w.start($)
  await startTurn($)
  await $.tool.call({ tool: 'Edit', file_path: '/proj/src/a.ts' })
  await endTurn($)
  await w.clock.settle()
  expect(asked).not.toContain('Repos candidatos')
})

test('touched repos are reset on turn.start', async ($, on) => {
  const w = world(on, {}, { repos: REPOS })
  const asks: string[] = []
  on('model.complete', ($: any, e: any) => { asks.push(e.prompt); return answered('{"new":[],"resolved":[]}') })
  tools(on)
  turns(on)
  await w.start($)
  await startTurn($, 't1')
  await $.tool.call({ tool: 'Read', file_path: '/other/x.ts' })
  await endTurn($, 't1')
  await w.clock.settle()
  await startTurn($, 't2')
  await endTurn($, 't2')
  await w.clock.settle()
  expect(asks[0]).toContain('- other: /other')
  expect(asks[1]).not.toContain('Repos candidatos')
})

test('Bash cd and git -C targets and absolute tokens mark repos as touched', async ($, on) => {
  const w = world(on, {}, { repos: { ...REPOS, '/third': '/third', '/fourth': '/fourth' } })
  let asked = ''
  on('model.complete', ($: any, e: any) => { asked = e.prompt; return answered('{"new":[],"resolved":[]}') })
  tools(on)
  turns(on)
  await w.start($)
  await startTurn($)
  await $.tool.call({ tool: 'Bash', command: 'cd /other && npm test' })
  await $.tool.call({ tool: 'Bash', command: 'git -C /third status' })
  await $.tool.call({ tool: 'Bash', command: 'cat /fourth/README.md /tmp/x' })
  await $.tool.call({ tool: 'Grep', pattern: 'x', path: '/fourth/src' })
  await endTurn($)
  await w.clock.settle()
  expect(asked).toContain('Repos candidatos:\n- proj: /proj\n- other: /other\n- third: /third\n- fourth: /fourth')
})

test('a file path is resolved through its directory, once per directory', async ($, on) => {
  const w = world(on, {}, { repos: REPOS })
  tools(on)
  turns(on)
  await w.start($)
  await startTurn($)
  const before = w.runs.length
  await $.tool.call({ tool: 'Edit', file_path: '/other/src/a.ts' })
  await $.tool.call({ tool: 'Write', file_path: '/other/src/b.ts' })
  await w.clock.settle()
  const calls = w.runs.slice(before)
  expect(calls).toEqual([['git', '-C', '/other/src', 'rev-parse', '--show-toplevel']])
})

test('subagent tool calls do not mark repos', async ($, on) => {
  const w = world(on, {}, { repos: REPOS })
  tools(on)
  await w.start($)
  const before = w.runs.length
  await $.tool.call({ tool: 'Edit', file_path: '/other/src/a.ts', agentId: 'sub1' })
  await w.clock.settle()
  expect(w.runs.length).toBe(before)
})

test('outside git nothing touches the session filesystem', async ($, on) => {
  const w = world(on, {}, { repos: REPOS, root: '/home/m' })
  let asked = ''
  on('model.complete', ($: any, e: any) => { asked = e.prompt; return answered('{"new":[{"text":"Cabo sin repo","priority":"high"}],"resolved":[]}') })
  on('classic.Stop', () => ({}))
  on('prompt.context', ($: any, e: any) => ({ blocks: e.blocks }))
  on('ui.render', () => ({ type: 'Box', props: { children: [] } }))
  tools(on)
  turns(on)
  await w.start($)
  const r = await $.tool.call({ tool: TOOL, text: 'Cabo sin sitio', priority: 'low' })
  expect(r.result).toBe('Esta sesión no está en un repo git: indica "repo" con la ruta del repo del cabo.')
  await startTurn($)
  await endTurn($)
  await w.clock.settle()
  expect(asked).toBe('')
  expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
  expect((await $.prompt.context({ blocks: [] })).blocks).toEqual([])
  expect(w.writes).toEqual([])
  expect(w.reads).toEqual([])
  expect(w.toasts).toEqual([])
  const band = await $.ui.mount({ plugin: 'loose-ends', surface: 'desktop', ...BAND })
  expect(await band.find({ type: 'Svg' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /cabo|cola|plan/ })).toBeUndefined()
  await band.unmount()
})

test('outside git the sweep writes only items whose repo is a touched one', async ($, on) => {
  const w = world(on, {}, { repos: REPOS, root: '/home/m' })
  let asked = ''
  on('model.complete', ($: any, e: any) => { asked = e.prompt; return answered('{"new":[{"text":"Cabo para el otro","priority":"low","repo":"/other"},{"text":"Cabo sin repo","priority":"low"}],"resolved":[]}') })
  tools(on)
  turns(on)
  await w.start($)
  await startTurn($)
  await $.tool.call({ tool: 'Edit', file_path: '/other/src/a.ts' })
  await endTurn($)
  await w.clock.settle()
  expect(asked).toContain('Repos candidatos:\n- other: /other')
  expect(w.writes).toEqual([OTHER])
  expect(w.savedAt(OTHER).map((i: any) => i.text)).toEqual(['Cabo para el otro'])
})

test('outside git a note with a valid repo writes only there', async ($, on) => {
  const w = world(on, {}, { repos: REPOS, root: '/home/m' })
  await w.start($)
  const r = await $.tool.call({ tool: TOOL, text: 'Cabo con ruta', priority: 'low', repo: '/other' })
  expect(String(r.result)).toMatch(/^Apuntado/)
  expect(w.writes).toEqual([OTHER])
  expect(w.reads).not.toContain(PATH)
})

test('outside git the pane says so in place of the lists', async ($, on) => {
  const w = world(on, {}, { repos: REPOS, root: '/home/m' })
  on('ui.render', () => ({ type: 'Box', props: { children: [] } }))
  await w.start($)
  const ui = await $.ui.mount({ plugin: 'loose-ends', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: 'Esta sesión no está dentro de un repo git.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /CABOS SUELTOS/ })).toBeUndefined()
  await ui.unmount()
})

test('in a repo the pane keeps its lists', async ($, on) => {
  const w = world(on, {}, { repos: REPOS })
  on('ui.render', () => ({ type: 'Box', props: { children: [] } }))
  await w.start($)
  const ui = await $.ui.mount({ plugin: 'loose-ends', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /CABOS SUELTOS/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /no está dentro de un repo git/ })).toBeUndefined()
  await ui.unmount()
})

test('when git cannot answer after a turn the session keeps its repo', async ($, on) => {
  const w = world(on, { [PATH]: own }, { repos: REPOS })
  on('prompt.context', ($: any, e: any) => ({ blocks: e.blocks }))
  turns(on)
  await w.start($)
  w.flags.failGit = true
  await endTurn($)
  await w.clock.settle()
  expect((await $.prompt.context({ blocks: [] })).blocks.at(-1).text).toContain('Cabo de la sesión')
})
