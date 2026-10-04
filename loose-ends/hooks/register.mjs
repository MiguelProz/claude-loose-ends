import { FILE, active, addItem, close, counts, dueReminders, expireReminded, markReminded, parseFile, queue, reopen, serialize, setPriority } from '../lib/store.mjs'
import { FLASH_MS, bashFailed, classifyBash, initialMood, moodAt, moodReduce, planProgress, planReduce } from '../lib/activity.mjs'
import { SWEEP_MODEL, buildSweepPrompt, parseSweepReply, shouldSweep } from '../lib/sweep.mjs'
import { SWEEP_SYSTEM, TOOL_DESCRIPTION, TOOL_GUIDE, TOOL_NAME, TOOL_SCHEMA, doNowText, formatContext, reminderText } from '../lib/prompts.mjs'
import { FILE_TOOLS, candidatePaths, candidateRepos, isAbsolutePath, isIgnoredRepo, normalizePath, parentPath, repoName } from '../lib/repos.mjs'
import { renderBand, renderPane } from '../lib/view.mjs'

const NO_GIT_NOTE = 'Esta sesión no está en un repo git: indica "repo" con la ruta del repo del cabo.'
const NOT_A_REPO = 'La ruta no está dentro de un repo git: no se ha apuntado.'
const MAX_WALK = 3
const MAX_CACHE = 500
const MAX_PATHS_PER_CALL = 10
const MAX_TOUCHED = 6

let items = []
let fileError = null
let branch = null
// Toplevel of the repo the session works in; null outside git, where nothing of the session is persisted.
let sessionRepo = null
let homePath
let touched = new Set()
let touchChain = Promise.resolve()
const repoCache = new Map()
let writeChain = Promise.resolve()
let sessionStart = 0
let working = false
let plan = []
let mood = initialMood(0)
let commits = []
let discarding = null
// The item whose evidence and secondary actions the pane shows; one at a time.
let expanded = null
let showOthers = false
let showDone = false
let refreshTimer = null

async function projectRoot($) {
  return await $.session.root()
}

async function logDebug($, message) {
  try {
    await $.ui.log(message, { to: 'debug' })
  } catch {}
}

function background($, promise, what) {
  promise.catch(err => logDebug($, `loose-ends: ${what} falló (${err?.message ?? err})`))
}

// Runs one step that must not break the hook: a failure is logged and the next step still runs.
async function guarded($, what, step) {
  try {
    await step()
  } catch (err) {
    await logDebug($, `loose-ends: ${what} falló (${err?.message ?? err})`)
  }
}

function clearDiscard(id) {
  if (discarding === id) discarding = null
  if (expanded === id) expanded = null
}

async function nowIso($) {
  return new Date(await $.clock.now()).toISOString()
}

async function readRepo($, root) {
  const path = `${root}/${FILE}`
  const text = (await $.fs.exists(path)) ? await $.fs.read(path) : null
  return parseFile(text)
}

// Loads the session repo's items into memory; outside git there is nothing to read and nothing is touched.
async function load($) {
  if (!sessionRepo) {
    items = []
    fileError = null
    return items
  }
  const parsed = await readRepo($, sessionRepo)
  if (!parsed.ok) {
    fileError = parsed.error
    return null
  }
  fileError = null
  items = parsed.items
  return items
}

// Read-modify-write on another repo's file: its items never enter memory.
async function mutateForeign($, fn, root, report) {
  const parsed = await readRepo($, root)
  if (!parsed.ok) {
    if (report) report.error = parsed.error
    return null
  }
  const result = fn(parsed.items, false)
  const nextItems = Array.isArray(result) ? result : result.items
  if (serialize(nextItems) !== serialize(parsed.items)) await $.fs.write(`${root}/${FILE}`, serialize(nextItems))
  return result
}

// Read-modify-write on a repo's file (the session's by default, resolved when the write runs); callers go through `mutate`, which serializes them.
// `fn(list, isSession)` says whether the file was the session's when it ran; `report.error` gets why an unreadable file was left alone.
async function mutateNow($, fn, root, report) {
  const target = root === undefined ? sessionRepo : root
  if (target === null) {
    await load($)
    $.ui.invalidate('ui.render')
    return null
  }
  if (target !== sessionRepo) return mutateForeign($, fn, target, report)
  const fresh = await load($)
  if (fresh === null) {
    if (report) report.error = fileError
    $.ui.invalidate('ui.render')
    return null
  }
  const result = fn(fresh, true)
  const nextItems = Array.isArray(result) ? result : result.items
  if (serialize(nextItems) !== serialize(fresh)) await $.fs.write(`${target}/${FILE}`, serialize(nextItems))
  items = nextItems
  if (discarding && !active(items).some(i => i.id === discarding)) discarding = null
  if (expanded && !active(items).some(i => i.id === expanded)) expanded = null
  $.ui.invalidate('ui.render')
  return result
}

async function mutate($, fn, root, report) {
  const run = writeChain.then(() => mutateNow($, fn, root, report))
  writeChain = run.catch(() => {})
  return run
}

async function toplevelOf($, dir) {
  const r = await $.process.run(['git', '-C', dir, 'rev-parse', '--show-toplevel'])
  if (r.exitCode !== 0) return null
  const top = typeof r.stdout === 'string' ? r.stdout.trim() : ''
  if (!isAbsolutePath(top)) throw new Error('git no dio la raíz del repo')
  return normalizePath(top)
}

// Toplevel of the git repo a path belongs to, or null (also when git cannot run). A file path starts at its
// directory; anything else starts at itself. Climbs a few levels for folders that do not exist yet.
async function repoOf($, path, { file = false, fresh = false } = {}) {
  if (!isAbsolutePath(path)) return null
  let dir = normalizePath(path)
  if (file) dir = parentPath(dir)
  const tried = []
  for (let depth = 0; depth < MAX_WALK; depth++) {
    if (fresh) repoCache.delete(dir)
    let top = repoCache.get(dir)
    if (top === undefined) {
      try {
        top = await toplevelOf($, dir)
      } catch {
        return null
      }
      if (repoCache.size >= MAX_CACHE) repoCache.clear()
      repoCache.set(dir, top)
    }
    if (top) {
      for (const d of tried) repoCache.set(d, top)
      return isIgnoredRepo(top, await homeDir($)) ? null : top
    }
    tried.push(dir)
    const parent = parentPath(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

async function homeDir($) {
  if (homePath === undefined) {
    try {
      const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
      homePath = home ? normalizePath(home) : null
    } catch {
      homePath = null
    }
  }
  return homePath
}

// The session's repo from its root, read afresh; throws when git cannot say, so callers keep the last answer.
// A repo under `.claude` or the home directory counts as no repo.
async function resolveSessionRepo($) {
  const session = await projectRoot($)
  const root = isAbsolutePath(session) ? normalizePath(session) : session
  repoCache.delete(root)
  const top = await toplevelOf($, root)
  repoCache.set(root, top)
  const before = sessionRepo
  sessionRepo = top && !isIgnoredRepo(top, await homeDir($)) ? top : null
  if (sessionRepo !== before) {
    // nothing of the old repo may be drawn while the new one loads
    items = []
    fileError = null
    discarding = null
    expanded = null
    showOthers = false
    showDone = false
    $.ui.invalidate('ui.render')
  }
}

// On the write chain, so a write never straddles a change of session repo.
async function refreshSessionRepo($) {
  const run = writeChain.then(() => resolveSessionRepo($))
  writeChain = run.catch(() => {})
  return run
}

async function branchOf($, dir) {
  const r = await $.process.run(['git', '-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'])
  return r.exitCode === 0 ? r.stdout.trim() : null
}

async function readBranch($) {
  return sessionRepo ? branchOf($, sessionRepo) : null
}

// Files a loose end in `target`, the toplevel of the repo it belongs to. Only the session repo's items live in memory.
// `added` is undefined when that repo's file is unreadable (`error` says why).
async function note($, input, target) {
  const now = await nowIso($)
  const noteBranch = await branchOf($, target)
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  const report = {}
  let wasSession = false
  const res = await mutate($, (list, isSession) => {
    wasSession = isSession
    if (isSession) branch = noteBranch
    return addItem(list, { ...input, id, branch: noteBranch, now })
  }, target, report)
  if (res && res.added) $.ui.toast(wasSession ? `Cabo suelto: ${res.added.text}` : `Cabo suelto (${repoName(target)}): ${res.added.text}`)
  return { added: res ? res.added : undefined, error: report.error, target }
}

async function feel($, ev) {
  const now = await $.clock.now()
  mood = moodReduce(mood, ev, now)
  $.ui.invalidate('ui.render')
  if (ev.type !== 'tool' && ev.type !== 'turn.start') $.clock.after(FLASH_MS + 50, () => $.ui.invalidate('ui.render'))
}

async function readCommits($) {
  if (!sessionStart || !sessionRepo) return []
  const midnight = new Date(await $.clock.now())
  midnight.setHours(0, 0, 0, 0)
  const since = new Date(Math.max(sessionStart, midnight.getTime())).toISOString()
  const r = await $.process.run(['git', 'log', `--since=${since}`, '--format=%h%x09%s'], { cwd: sessionRepo })
  if (r.exitCode !== 0) return []
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [hash, ...rest] = line.split('\t')
      return { hash, subject: rest.join('\t') }
    })
}

// Repos the main loop touched this turn, once the lookups queued by `trackRepos` have finished.
async function touch($, set, paths, isFile) {
  for (const path of paths) {
    const top = await repoOf($, path, { file: isFile })
    if (top && set.size < MAX_TOUCHED) set.add(top)
  }
}

function trackRepos($, e) {
  const paths = candidatePaths(e.tool, e).slice(0, MAX_PATHS_PER_CALL)
  if (!paths.length) return
  const set = touched
  const isFile = FILE_TOOLS.has(e.tool)
  touchChain = touchChain.then(() => touch($, set, paths, isFile)).catch(err => logDebug($, `loose-ends: resolver los repos tocados falló (${err?.message ?? err})`))
}

async function sweep($, answer, touchedNow) {
  const others = (await touchedNow).filter(repo => repo !== sessionRepo)
  if (!sessionRepo && !others.length) return
  const candidates = others.length ? candidateRepos(sessionRepo, others) : []
  const open = active(items)
  const r = await $.model.complete({ model: SWEEP_MODEL, system: SWEEP_SYSTEM, prompt: buildSweepPrompt(answer, open, candidates), maxTokens: 800, timeoutMs: 20000 })
  if (!r.isAnswered) {
    $.ui.log(`loose-ends: barrido omitido (${r.reason})`, { to: 'debug' })
    return
  }
  const parsed = parseSweepReply(r.text, open.map(i => i.id), candidates, answer)
  if (!parsed) {
    $.ui.log('loose-ends: barrido con JSON inválido', { to: 'debug' })
    return
  }
  if (parsed.dropped) $.ui.log(`loose-ends: ${parsed.dropped} ${parsed.dropped === 1 ? 'cabo descartado' : 'cabos descartados'} por evidencia no literal`, { to: 'debug' })
  for (const { repo, ...fresh } of parsed.fresh) {
    const target = repo ?? sessionRepo
    if (!target) continue
    const { added } = await note($, { ...fresh, source: 'sweep' }, target)
    if (added && added.priority === 'high') await feel($, { type: 'worry' })
  }
  if (parsed.resolved.length) {
    const now = await nowIso($)
    await mutate($, list =>
      parsed.resolved.reduce((acc, id) => (active(acc).some(i => i.id === id) ? close(acc, id, { status: 'done', closedBy: 'sweep', now }) : acc), list),
    )
  }
}

function bandModel(now) {
  return { mood: moodAt(mood, now), plan: planProgress(plan), counts: counts(items, branch), fileError, filePath: sessionRepo ? `${sessionRepo}/${FILE}` : FILE }
}

function paneModel(now) {
  const list = active(items)
  const today = new Date(now).toDateString()
  return {
    now,
    branch,
    working,
    fileError,
    filePath: sessionRepo ? `${sessionRepo}/${FILE}` : FILE,
    noRepo: sessionRepo === null,
    discarding,
    expanded,
    showOthers,
    showDone,
    plan: { items: plan, ...planProgress(plan) },
    loose: list.filter(i => !i.branch || i.branch === branch),
    others: list.filter(i => i.branch && i.branch !== branch),
    closedToday: items.filter(i => (i.status === 'done' || i.status === 'dismissed') && i.closedAt && new Date(i.closedAt).toDateString() === today),
    commits,
  }
}

async function doNow($, id) {
  if (working) return
  const item = items.find(i => i.id === id)
  if (!item) return
  const now = await nowIso($)
  clearDiscard(id)
  const res = await mutate($, list => markReminded(queue(list, id), [id], now))
  if (res === null) return
  await $.prompt.submit({ text: doNowText(item) })
}

async function closeAs($, id, status, reason) {
  clearDiscard(id)
  const now = await nowIso($)
  await mutate($, list => close(list, id, { status, reason, closedBy: 'user', now }))
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    discarding = null
    expanded = null
    showOthers = false
    showDone = false
    sessionStart = (await $.session.usage()).startedAt
    await $.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA })
    await $.command.register({ name: 'pendientes', description: 'Abre el cuaderno: plan, cabos sueltos y hecho', immediate: true })
    touched = new Set()
    sessionRepo = null
    await guarded($, 'resolver el repo de la sesión', () => refreshSessionRepo($))
    branch = await readBranch($)
    await load($)
    mood = initialMood(await $.clock.now())
    plan = []
    commits = []
    if (refreshTimer) refreshTimer.cancel()
    refreshTimer = $.clock.every(60000, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e)
    await feel($, { type: 'tool', tool: e.tool })
    const r = await next(e)
    if (e.tool === 'TaskCreate' && r.result && r.result.task) plan = planReduce(plan, { kind: 'create', id: r.result.task.id, subject: e.subject })
    if (e.tool === 'TaskUpdate') plan = planReduce(plan, { kind: 'update', id: e.taskId, status: e.status, subject: e.subject })
    if (e.tool === 'TodoWrite' && Array.isArray(e.todos)) plan = planReduce(plan, { kind: 'todos', todos: e.todos })
    trackRepos($, e)
    if (e.tool === 'Bash' && typeof e.command === 'string') {
      const kind = classifyBash(e.command, bashFailed(r))
      if (kind) await feel($, { type: kind })
      if (kind === 'commit') commits = await readCommits($)
    }
    return r
  })

  on('turn.start', async ($, e, next) => {
    working = true
    touched = new Set()
    for (const [dir, top] of repoCache) if (top === null) repoCache.delete(dir)
    await feel($, { type: 'turn.start' })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    working = false
    await feel($, { type: 'turn.end' })
    await guarded($, 'resolver el repo de la sesión tras el turno', () => refreshSessionRepo($))
    await guarded($, 'leer la rama tras el turno', async () => { branch = await readBranch($) })
    await guarded($, 'refrescar los cabos tras el turno', () => mutate($, list => list))
    await guarded($, 'leer los commits tras el turno', async () => { commits = await readCommits($) })
    if (e.reason === 'answer' && shouldSweep(e.answer)) {
      const set = touched
      background($, sweep($, e.answer, touchChain.then(() => [...set])), 'el barrido')
    }
    return r
  })

  on('tool.call', { tool: 'mcp__loose-ends__note_loose_end' }, async ($, e) => {
    if (String(e.text ?? '').trim().length < 3) return { result: 'Texto demasiado corto: describe el cabo en una frase.' }
    let target = sessionRepo
    if (typeof e.repo === 'string' && e.repo.trim()) {
      target = await repoOf($, e.repo.trim(), { fresh: true })
      if (!target) return { result: NOT_A_REPO }
    } else if (!target) return { result: NO_GIT_NOTE }
    const { added, error } = await note($, { text: e.text, priority: e.priority, evidence: e.evidence, source: 'tool' }, target)
    if (added === undefined) return { result: `No se pudo apuntar: ${target}/${FILE} está ilegible (${error}).` }
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

  on('command.run', { command: 'pendientes' }, async ($) => {
    await $.ui.open({ id: 'loose-ends', title: 'Cuaderno' })
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const el = $.ui.resolve(e)
    const now = await $.clock.now()
    return renderBand(el, e.surface, bandModel(now), {
      openPane: () => { background($, $.ui.open({ id: 'loose-ends', title: 'Cuaderno' }), 'abrir el cuaderno') },
    })
  })

  on('ui.render', { component: 'Pane', requestId: 'loose-ends' }, async ($, e, next) => {
    if (e.surface === 'mobile') return next(e)
    const el = $.ui.resolve(e)
    const now = await $.clock.now()
    return renderPane(el, paneModel(now), {
      doNow: id => { background($, doNow($, id), 'Hacer') },
      queue: id => { clearDiscard(id); background($, mutate($, list => queue(list, id)), 'poner en cola') },
      done: id => { background($, closeAs($, id, 'done', undefined), 'cerrar el cabo') },
      toggleMore: id => { discarding = null; expanded = expanded === id ? null : id; $.ui.invalidate('ui.render') },
      startDiscard: id => { discarding = discarding === id ? null : id; $.ui.invalidate('ui.render') },
      dismiss: (id, reason) => { background($, closeAs($, id, 'dismissed', reason), 'descartar el cabo') },
      setPriority: (id, p) => { background($, mutate($, list => setPriority(list, id, p)), 'cambiar la prioridad') },
      reopen: id => { clearDiscard(id); background($, mutate($, list => reopen(list, id)), 'reabrir el cabo') },
      toggleOthers: () => { showOthers = !showOthers; $.ui.invalidate('ui.render') },
      toggleDone: () => { showDone = !showDone; $.ui.invalidate('ui.render') },
    })
  })
}
