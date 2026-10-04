import { FILE, active, addItem, dueReminders, expireReminded, markReminded, parseFile, serialize } from '../lib/store.mjs'
import { TOOL_DESCRIPTION, TOOL_GUIDE, TOOL_NAME, TOOL_SCHEMA, formatContext, reminderText } from '../lib/prompts.mjs'

let items = []
let fileError = null
let branch = null
let root = null
let sessionStart = 0
let working = false

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

export function register(on) {
  on('session.start', async ($, e, next) => {
    root = null
    sessionStart = (await $.session.usage()).startedAt
    await $.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA })
    await $.command.register({ name: 'pendientes', description: 'Abre el cuaderno: plan, cabos sueltos y hecho', immediate: true })
    branch = await readBranch($)
    await load($)
    return next(e)
  })

  on('tool.call', { tool: 'mcp__loose-ends__note_loose_end' }, async ($, e) => {
    const added = await note($, { text: e.text, priority: e.priority, evidence: e.evidence, source: 'tool' })
    if (added === undefined) return { result: `No se pudo apuntar: ${FILE} está ilegible (${fileError}).` }
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
