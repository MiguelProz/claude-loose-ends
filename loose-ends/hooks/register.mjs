import { FILE, active, addItem, close, dueReminders, expireReminded, markReminded, parseFile, serialize } from '../lib/store.mjs'
import { FLASH_MS, bashFailed, classifyBash, initialMood, moodReduce, planReduce } from '../lib/activity.mjs'
import { SWEEP_MODEL, buildSweepPrompt, parseSweepReply, shouldSweep } from '../lib/sweep.mjs'
import { SWEEP_SYSTEM, TOOL_DESCRIPTION, TOOL_GUIDE, TOOL_NAME, TOOL_SCHEMA, formatContext, reminderText } from '../lib/prompts.mjs'

let items = []
let fileError = null
let branch = null
let root = null
let sessionStart = 0
let working = false
let plan = []
let mood = initialMood(0)
let commits = []

async function projectRoot($) {
  if (!root) root = await $.session.root()
  return root
}

async function filePath($) {
  return `${await projectRoot($)}/${FILE}`
}

async function nowIso($) {
  return new Date(await $.clock.now()).toISOString()
}

async function load($) {
  const path = await filePath($)
  const text = (await $.fs.exists(path)) ? await $.fs.read(path) : null
  const parsed = parseFile(text)
  if (!parsed.ok) {
    fileError = parsed.error
    return null
  }
  fileError = null
  items = parsed.items
  return items
}

async function mutate($, fn) {
  const fresh = await load($)
  if (fresh === null) {
    $.ui.invalidate('ui.render')
    return null
  }
  const result = fn(fresh)
  const nextItems = Array.isArray(result) ? result : result.items
  if (serialize(nextItems) !== serialize(fresh)) await $.fs.write(await filePath($), serialize(nextItems))
  items = nextItems
  $.ui.invalidate('ui.render')
  return result
}

async function readBranch($) {
  const r = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd: await projectRoot($) })
  return r.exitCode === 0 ? r.stdout.trim() : null
}

async function note($, input) {
  const now = await nowIso($)
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  const res = await mutate($, list => addItem(list, { ...input, id, branch, now }))
  if (res && res.added) $.ui.toast(`Cabo suelto: ${res.added.text}`)
  return res ? res.added : undefined
}

async function feel($, ev) {
  const now = await $.clock.now()
  mood = moodReduce(mood, ev, now)
  $.ui.invalidate('ui.render')
  if (ev.type !== 'tool' && ev.type !== 'turn.start') $.clock.after(FLASH_MS + 50, () => $.ui.invalidate('ui.render'))
}

async function readCommits($) {
  if (!sessionStart) return []
  const since = new Date(sessionStart).toISOString()
  const r = await $.process.run(['git', 'log', `--since=${since}`, '--format=%h%x09%s'], { cwd: await projectRoot($) })
  if (r.exitCode !== 0) return []
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [hash, ...rest] = line.split('\t')
      return { hash, subject: rest.join('\t') }
    })
}

async function sweep($, answer) {
  const open = active(items)
  const r = await $.model.complete({ model: SWEEP_MODEL, system: SWEEP_SYSTEM, prompt: buildSweepPrompt(answer, open), maxTokens: 800, timeoutMs: 20000 })
  if (!r.isAnswered) {
    $.ui.log(`loose-ends: barrido omitido (${r.reason})`, { to: 'debug' })
    return
  }
  const parsed = parseSweepReply(r.text, open.map(i => i.id))
  if (!parsed) {
    $.ui.log('loose-ends: barrido con JSON inválido', { to: 'debug' })
    return
  }
  for (const fresh of parsed.fresh) {
    const added = await note($, { ...fresh, source: 'sweep' })
    if (added && added.priority === 'high') await feel($, { type: 'worry' })
  }
  if (parsed.resolved.length) {
    const now = await nowIso($)
    await mutate($, list => parsed.resolved.reduce((acc, id) => close(acc, id, { status: 'done', closedBy: 'sweep', now }), list))
  }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    root = null
    sessionStart = (await $.session.usage()).startedAt
    await $.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA })
    await $.command.register({ name: 'pendientes', description: 'Abre el cuaderno: plan, cabos sueltos y hecho', immediate: true })
    branch = await readBranch($)
    await load($)
    mood = initialMood(await $.clock.now())
    plan = []
    commits = []
    $.clock.every(60000, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e)
    await feel($, { type: 'tool', tool: e.tool })
    const r = await next(e)
    if (e.tool === 'TaskCreate' && r.result && r.result.task) plan = planReduce(plan, { kind: 'create', id: r.result.task.id, subject: e.subject })
    if (e.tool === 'TaskUpdate') plan = planReduce(plan, { kind: 'update', id: e.taskId, status: e.status, subject: e.subject })
    if (e.tool === 'TodoWrite' && Array.isArray(e.todos)) plan = planReduce(plan, { kind: 'todos', todos: e.todos })
    if (e.tool === 'Bash' && typeof e.command === 'string') {
      const kind = classifyBash(e.command, bashFailed(r))
      if (kind) await feel($, { type: kind })
      if (kind === 'commit') commits = await readCommits($)
    }
    return r
  })

  on('turn.start', async ($, e, next) => {
    working = true
    await feel($, { type: 'turn.start' })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    working = false
    await feel($, { type: 'turn.end' })
    commits = await readCommits($)
    if (!e.isAborted && shouldSweep(e.answer)) void sweep($, e.answer)
    return r
  })

  on('tool.call', { tool: 'mcp__loose-ends__note_loose_end' }, async ($, e) => {
    const added = await note($, { text: e.text, priority: e.priority, evidence: e.evidence, source: 'tool' })
    if (added === undefined) return { result: `No se pudo apuntar: ${FILE} está ilegible (${fileError}).` }
    if (added && added.priority === 'high') await feel($, { type: 'worry' })
    return { result: added ? `Apuntado (${added.id}): ${added.text}` : 'Ya estaba apuntado.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return { sections: [...r.sections, { id: 'loose-ends:guide', text: TOOL_GUIDE, scope: 'session' }] }
  })

  on('prompt.context', async ($, e, next) => {
    const r = await next(e)
    await load($)
    const text = formatContext(active(items))
    return text ? { ...r, blocks: [...r.blocks, { name: 'looseEnds', text }] } : r
  })

  on('classic.Stop', async ($, e, next) => {
    const r = await next(e)
    if (r.block) return r
    const now = await nowIso($)
    let due = []
    await mutate($, list => {
      const expired = expireReminded(list)
      due = dueReminders(expired)
      return markReminded(expired, due.map(i => i.id), now)
    })
    return due.length ? { ...r, block: reminderText(due) } : r
  })

  on('command.run', { command: 'pendientes' }, async () => ({ text: 'loose-ends cargado' }))
}
