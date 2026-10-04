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

const plugin = '/Users/m/.claude/plugins/cache/p'

test('outside git the band keeps the plan counter but shows no loose-end counters', async ($, on) => {
  const w = world(on, {}, { repos: REPOS, root: '/home/m' })
  on('ui.render', () => ({ type: 'Box', props: { children: [] } }))
  on('tool.call', ($: any, e: any) => (e.tool === 'TaskCreate' ? { result: { task: { id: 't1', subject: e.subject } } } : { result: {} }))
  await w.start($)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Primera tarea', description: 'd' })
  const band = await $.ui.mount({ plugin: 'loose-ends', surface: 'desktop', ...BAND })
  expect((await band.find({ type: 'Text', text: /plan/ }))?.text).toBe('◐ plan 0/1')
  expect(await band.find({ type: 'Text', text: /cabo|cola/ })).toBeUndefined()
  await band.unmount()
})

test('a repo under .claude is never a candidate nor written', async ($, on) => {
  const w = world(on, {}, { repos: { ...REPOS, [plugin]: plugin } })
  let asked = ''
  on('model.complete', ($: any, e: any) => { asked = e.prompt; return answered(`{"new":[{"text":"Cabo del plugin","priority":"low","repo":"${plugin}"}],"resolved":[]}`) })
  tools(on)
  turns(on)
  await w.start($)
  await startTurn($)
  await $.tool.call({ tool: 'Read', file_path: `${plugin}/skills/x/SKILL.md` })
  await $.tool.call({ tool: 'Bash', command: `cat ${plugin}/README.md` })
  await endTurn($)
  await w.clock.settle()
  expect(asked).not.toContain('Repos candidatos')
  expect(w.writes).toEqual([PATH])
  expect(w.saved().map((i: any) => i.text)).toEqual(['Cabo del plugin'])
})

test('the tool refuses a repo under .claude', async ($, on) => {
  const w = world(on, {}, { repos: { ...REPOS, [plugin]: plugin } })
  await w.start($)
  const r = await $.tool.call({ tool: TOOL, text: 'Cabo del plugin', priority: 'low', repo: `${plugin}/skills` })
  expect(r.result).toBe('La ruta no está dentro de un repo git: no se ha apuntado.')
  expect(w.writes).toEqual([])
})

test('a session whose repo is the home directory behaves as outside git', async ($, on) => {
  const w = world(on, {}, { repos: { '/Users/m': '/Users/m', '/other': '/other' }, root: '/Users/m/work' })
  on('model.complete', () => answered('{"new":[{"text":"Cabo suelto en casa","priority":"low"}],"resolved":[]}'))
  tools(on)
  turns(on)
  await w.start($)
  const r = await $.tool.call({ tool: TOOL, text: 'Cabo en casa', priority: 'low' })
  expect(String(r.result)).toContain('no está en un repo git')
  const home = await $.tool.call({ tool: TOOL, text: 'Cabo en casa', priority: 'low', repo: '/Users/m/x' })
  expect(home.result).toBe('La ruta no está dentro de un repo git: no se ha apuntado.')
  await startTurn($)
  await endTurn($)
  await w.clock.settle()
  expect(w.writes).toEqual([])
  expect(w.reads).toEqual([])
})

test('with HOME unknown only the .claude rule applies', async ($, on) => {
  const w = world(on, {}, { repos: { '/Users/m': '/Users/m' }, root: '/Users/m/work', home: null })
  await w.start($)
  await $.tool.call({ tool: TOOL, text: 'Cabo en casa', priority: 'low' })
  expect(w.writes).toEqual(['/Users/m/.claude/loose-ends.json'])
})

test('a directory that was not a repo is looked up again on the next turn, a repo is not', async ($, on) => {
  const repos: Record<string, string> = { '/proj': '/proj', '/other': '/other' }
  const w = world(on, {}, { repos })
  const asks: string[] = []
  on('model.complete', ($: any, e: any) => { asks.push(e.prompt); return answered('{"new":[],"resolved":[]}') })
  tools(on)
  turns(on)
  await w.start($)
  await startTurn($, 't1')
  await $.tool.call({ tool: 'Read', file_path: '/late/src/a.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/other/src/a.ts' })
  await endTurn($, 't1')
  await w.clock.settle()
  repos['/late'] = '/late'
  const before = w.runs.length
  await startTurn($, 't2')
  await $.tool.call({ tool: 'Read', file_path: '/late/src/a.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/other/src/a.ts' })
  await endTurn($, 't2')
  await w.clock.settle()
  expect(asks[0]).toContain('- other: /other')
  expect(asks[0]).not.toContain('late')
  expect(asks[1]).toContain('- late: /late')
  const lookups = w.runs.slice(before).filter(a => a.includes('--show-toplevel'))
  expect(lookups.some(a => a[2] === '/other/src')).toBe(false)
})

test('the failure message names the error of the repo it wrote to', async ($, on) => {
  const conflict = '<<<<<<< HEAD\n{}\n=======\n>>>>>>> x\n'
  const w = world(on, { [PATH]: conflict, [OTHER]: '{ roto' }, { repos: REPOS })
  await w.start($)
  const foreign = await $.tool.call({ tool: TOOL, text: 'Cabo en otro', priority: 'low', repo: '/other' })
  expect(String(foreign.result)).toContain('/other/.claude/loose-ends.json')
  expect(String(foreign.result)).toContain('(json)')
  const own = await $.tool.call({ tool: TOOL, text: 'Cabo en la sesión', priority: 'low' })
  expect(String(own.result)).toContain('(conflict)')
  expect(String(own.result)).not.toContain('/other')
  w.fs[OTHER] = JSON.stringify({ version: 1, items: [] })
  const fixed = await $.tool.call({ tool: TOOL, text: 'Cabo en otro', priority: 'low', repo: '/other' })
  expect(String(fixed.result)).toMatch(/^Apuntado/)
})

test('after the root moves, a note to the new session repo is a session note', async ($, on) => {
  const w = world(on, {}, { repos: REPOS })
  turns(on)
  await w.start($)
  w.setRoot('/other')
  await endTurn($)
  await w.clock.settle()
  await $.tool.call({ tool: TOOL, text: 'Cabo en la nueva raíz', priority: 'low', repo: '/other' })
  expect(w.toasts).toEqual(['Cabo suelto: Cabo en la nueva raíz'])
  expect(w.savedAt(OTHER)).toHaveLength(1)
})

test('git throwing at start leaves the session outside git, and the tool says the path is not a repo', async ($, on) => {
  const w = world(on, {}, { repos: REPOS })
  await w.start($)
  w.flags.throwGit = true
  const r = await $.tool.call({ tool: TOOL, text: 'Cabo sin git', priority: 'low', repo: '/other' })
  expect(r.result).toBe('La ruta no está dentro de un repo git: no se ha apuntado.')
  expect(w.writes).toEqual([])
})

test('git throwing during start leaves the session without a repo and nothing is persisted', async ($, on) => {
  const w = world(on, {}, { repos: REPOS })
  w.flags.throwGit = true
  await w.start($)
  const r = await $.tool.call({ tool: TOOL, text: 'Cabo sin git', priority: 'low' })
  expect(String(r.result)).toContain('no está en un repo git')
  expect(w.writes).toEqual([])
})

test('a folder that does not exist yet resolves through its nearest existing parent', async ($, on) => {
  const w = world(on, {}, { repos: REPOS, missing: ['/other/new'] })
  await w.start($)
  await $.tool.call({ tool: TOOL, text: 'Cabo en carpeta futura', priority: 'low', repo: '/other/new/deep' })
  expect(w.writes).toEqual([OTHER])
})

test('a file path given as repo resolves through its folder', async ($, on) => {
  const w = world(on, {}, { repos: REPOS })
  await w.start($)
  await $.tool.call({ tool: TOOL, text: 'Cabo por fichero', priority: 'low', repo: '/other/src/a.ts' })
  expect(w.runs.filter(a => a.includes('--show-toplevel')).map(a => a[2])).toContain('/other/src/a.ts')
  expect(w.writes).toEqual([OTHER])
})
