import {
  FETCH_ARGS, GIT_ENV, HASH_ARGS, LAST_COMMIT_ARGS, REF, REMOTE_ARGS, REMOTE_REF, SYNC_GET_ARGS, TREE_ARGS,
  blobArgs, commitArgs, firstLine, hasOrigin, mergeItems, pushArgs, shaArgs, syncSetArgs, trackArgs, treeInput, updateArgs,
} from '../lib/refstore.mjs'
import {
  LEGACY_FILE, addManual, candidates, closedRecently, confirmClose, counts, dismiss, editText, expireCandidates, isStale, keepOpen, live,
  markDone, parseItems, propose, proposeClose, reject, rejectedTexts, reopen, restore, save, serializeItems, setPriority, start, topUrgent, touch,
} from '../lib/items.mjs'
import { rejectReason } from '../lib/filter.mjs'
import { SWEEP_MODEL, buildSweepPrompt, containsQuote, parseSweepReply, shouldSweep } from '../lib/detect.mjs'
import {
  NOT_A_REPO, NO_GIT_NOTE, SWEEP_SYSTEM, TOOL_DESCRIPTION, TOOL_GUIDE, TOOL_NAME, TOOL_SCHEMA, TOOL_TOO_SHORT,
  doNowText, formatContext, toolProposed, toolRejected, toolUnreadable,
} from '../lib/texts.mjs'
import { FLASH_MS, bashFailed, chispaMood, isCommit, isPush } from '../lib/mood.mjs'
import { FILE_TOOLS, candidatePaths, candidateRepos, isAbsolutePath, isIgnoredRepo, normalizePath, parentPath, relativeTo, repoName } from '../lib/repos.mjs'
import { emphasize, renderBand, renderPane, renderTriage } from '../lib/screens.mjs'

const MAX_WALK = 3
const MAX_CACHE = 500
const MAX_PATHS_PER_CALL = 10
const MAX_TOUCHED = 6
const MAX_TRIES = 3
const NEXT_PRIORITY = { high: 'medium', medium: 'low', low: 'high' }
const SYNC_QUESTION = '¿Subo también los cabos sueltos de este repo a origin? Viajan en refs/loose-ends, fuera de tus ramas.'

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
let working = false
let lastActivity = 0
let flashUntil = 0
// The last item the person closed, as it was before, for the band's Deshacer while it lasts.
let justClosed = null
// The item whose text an Input edits, in the pane or in its card; one at a time.
let editing = null
// What the pane says once about the import of the 0.3 file.
let notice = null
// Where the session repo's ref stands against origin: 'local', 'synced', 'ahead' or 'failed'.
let sync = null
// A commit made during the current turn, the proof of what the sweep proposes to close.
let turnCommit = null
// Cards the person answered under a message: id -> { kind, quote, state, previous }.
const triage = new Map()
let refreshTimer = null

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

async function nowIso($) {
  return new Date(await $.clock.now()).toISOString()
}

// A repo's loose ends and the commit they came from; `sha` is null when the ref does not exist yet.
async function readRef($, root, ref = REF) {
  const head = await $.process.run(['git', '-C', root, ...shaArgs(ref)])
  if (head.exitCode !== 0) return { ok: true, items: [], sha: null }
  const sha = firstLine(head.stdout)
  if (!sha) return { ok: false, error: 'git' }
  const blob = await $.process.run(['git', '-C', root, ...blobArgs(sha)])
  if (blob.exitCode !== 0) return { ok: false, error: 'blob' }
  const parsed = parseItems(blob.stdout)
  return parsed.ok ? { ...parsed, sha } : parsed
}

// Points the ref at a new commit holding `list`; false when another session moved it since `prev` was read.
async function writeRef($, root, list, prev) {
  const blob = await $.process.run(['git', '-C', root, ...HASH_ARGS], { stdin: serializeItems(list) })
  const blobSha = blob.exitCode === 0 ? firstLine(blob.stdout) : null
  if (!blobSha) throw new Error('git hash-object falló')
  const tree = await $.process.run(['git', '-C', root, ...TREE_ARGS], { stdin: treeInput(blobSha) })
  const treeSha = tree.exitCode === 0 ? firstLine(tree.stdout) : null
  if (!treeSha) throw new Error('git mktree falló')
  const commit = await $.process.run(['git', '-C', root, ...commitArgs(treeSha, prev)], { env: GIT_ENV })
  const commitSha = commit.exitCode === 0 ? firstLine(commit.stdout) : null
  if (!commitSha) throw new Error('git commit-tree falló')
  const moved = await $.process.run(['git', '-C', root, ...updateArgs(commitSha, prev)])
  return moved.exitCode === 0
}

// Read-modify-write of a repo's loose ends, again from the top when another session moved the ref in between.
// `fn` may run more than once, so it must not have side effects beyond what it returns.
async function commitItems($, root, fn) {
  for (let tries = 0; tries < MAX_TRIES; tries++) {
    const read = await readRef($, root)
    if (!read.ok) return { error: read.error }
    const result = fn(read.items)
    const nextItems = Array.isArray(result) ? result : result.items
    if (serializeItems(nextItems) === serializeItems(read.items)) return { result, items: read.items }
    if (await writeRef($, root, nextItems, read.sha)) return { result, items: nextItems }
  }
  return { error: 'busy' }
}

// Loads the session repo's items into memory; outside git there is nothing to read and nothing is touched.
async function load($) {
  if (!sessionRepo) {
    items = []
    fileError = null
    return items
  }
  const parsed = await readRef($, sessionRepo)
  if (!parsed.ok) {
    fileError = parsed.error
    return null
  }
  fileError = null
  items = parsed.items
  return items
}

// Read-modify-write on a repo's ref (the session's by default, resolved when the write runs); callers go through
// `mutate`, which serializes them. `fn(list, isSession)` says whether the ref was the session's when it ran;
// `report.error` gets why an unreadable or busy ref was left alone. Only the session repo's items live in memory.
async function mutateNow($, fn, root, report) {
  const target = root === undefined ? sessionRepo : root
  if (target === null) {
    await load($)
    $.ui.invalidate('ui.render')
    return null
  }
  const isSession = target === sessionRepo
  const done = await commitItems($, target, list => fn(list, isSession))
  if (done.error) {
    if (report) report.error = done.error
    if (isSession) {
      fileError = done.error
      $.ui.invalidate('ui.render')
    }
    return null
  }
  if (isSession) {
    fileError = null
    items = done.items
    if (editing && !items.some(i => i.id === editing)) editing = null
    $.ui.invalidate('ui.render')
  }
  return done.result
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
  const session = await $.session.root()
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
    editing = null
    justClosed = null
    notice = null
    sync = null
    triage.clear()
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

async function readSha($, root, ref) {
  const r = await $.process.run(['git', '-C', root, ...shaArgs(ref)])
  return r.exitCode === 0 ? firstLine(r.stdout) : null
}

async function hasRemote($, root) {
  const r = await $.process.run(['git', '-C', root, ...REMOTE_ARGS])
  return r.exitCode === 0 && hasOrigin(r.stdout)
}

// Where the ref stands against origin, from the local ref and the copy of origin's that the last fetch left.
async function refreshSync($, root) {
  if (!(await hasRemote($, root))) return 'local'
  const mine = await readSha($, root, REF)
  const theirs = await readSha($, root, REMOTE_REF)
  return !mine || mine === theirs ? 'synced' : 'ahead'
}

// Brings origin's loose ends into the local ref. Answers the sha it fetched, the lease for a push; null when
// there is no origin, origin has no ref yet, or the fetch failed.
async function pullRemote($, root) {
  if (!(await hasRemote($, root))) return null
  const fetched = await $.process.run(['git', '-C', root, ...FETCH_ARGS], { timeoutMs: 20000 })
  if (fetched.exitCode !== 0) {
    await logDebug($, 'loose-ends: no se pudieron traer los cabos de origin')
    return null
  }
  const theirs = await readRef($, root, REMOTE_REF)
  if (!theirs.ok) return null
  await mutate($, list => mergeItems(list, theirs.items), root)
  return theirs.sha
}

// Merges origin first, then pushes the ref, refused if origin moved after the fetch.
async function pushRemote($, root) {
  if (!root) return
  const lease = await pullRemote($, root)
  const mine = await readSha($, root, REF)
  if (!mine) return
  const pushed = await $.process.run(['git', '-C', root, ...pushArgs(lease)], { timeoutMs: 30000 })
  if (pushed.exitCode !== 0) {
    if (root === sessionRepo) {
      sync = 'failed'
      $.ui.invalidate('ui.render')
    }
    await logDebug($, 'loose-ends: no se pudieron subir los cabos a origin')
    return
  }
  await $.process.run(['git', '-C', root, ...trackArgs(mine)])
  if (root === sessionRepo) {
    sync = 'synced'
    $.ui.invalidate('ui.render')
  }
}

// After the person's own git push: pushes the ref too, asking the first time (Siempre and Nunca are remembered).
async function afterUserPush($) {
  const root = sessionRepo
  if (!root) return
  if ((await refreshSync($, root)) !== 'ahead') return
  const pref = await $.process.run(['git', '-C', root, ...SYNC_GET_ARGS])
  const mode = pref.exitCode === 0 ? firstLine(pref.stdout) : null
  if (mode === 'false') return
  if (mode !== 'true') {
    const answer = await $.ui.ask(SYNC_QUESTION, { options: ['Siempre', 'Esta vez', 'Nunca'], header: 'Cabos' })
    if (answer === 'Nunca') {
      await $.process.run(['git', '-C', root, ...syncSetArgs(false)])
      return
    }
    if (answer === 'Siempre') await $.process.run(['git', '-C', root, ...syncSetArgs(true)])
    else if (answer !== 'Esta vez') return
  }
  await pushRemote($, root)
}

// Imports the items a 0.3 version left in <root>/.claude/loose-ends.json whose ids the ref lacks; the file stays.
async function importLegacy($, root) {
  const path = `${root}/${LEGACY_FILE}`
  if (!(await $.fs.exists(path))) return
  const parsed = parseItems(await $.fs.read(path))
  if (!parsed.ok || !parsed.items.length) return
  const res = await mutate($, list => {
    const known = new Set(list.map(i => i.id))
    const fresh = parsed.items.filter(i => !known.has(i.id))
    return { items: fresh.length ? [...list, ...fresh] : list, added: fresh.length }
  }, root)
  // only an import that was written may tell the person to delete the file
  if (res?.added && root === sessionRepo) notice = `Importados ${res.added} ${res.added === 1 ? 'cabo' : 'cabos'} de ${LEGACY_FILE}. Ya puedes borrar el fichero del repo.`
}

// At session start: the 0.3 file, then origin, then where the ref stands; a failing step does not skip the next.
async function startSync($, root) {
  await guarded($, 'importar .claude/loose-ends.json', () => importLegacy($, root))
  await guarded($, 'traer los cabos de origin', () => pullRemote($, root))
  await guarded($, 'ver si hay cabos sin subir', async () => {
    if (root !== sessionRepo) return
    sync = await refreshSync($, root)
    $.ui.invalidate('ui.render')
  })
}

// Runs the filter and files a candidate in `target`. `reason` says why the filter refused it, `error` why the
// repo could not be read or written.
async function offer($, input, target) {
  const now = await nowIso($)
  const noteBranch = await branchOf($, target)
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  const report = {}
  let reason = null
  const res = await mutate($, (list, isSession) => {
    if (isSession) branch = noteBranch
    reason = rejectReason(input, list)
    return reason ? { items: list, added: null } : propose(list, { ...input, id, branch: noteBranch, now })
  }, target, report)
  if (report.error) return { error: report.error }
  if (reason) {
    await logDebug($, `loose-ends: candidato rechazado (${reason}): ${input.text}`)
    return { reason }
  }
  return res?.added ? { added: res.added } : { reason: 'texto demasiado corto' }
}

async function lastCommit($) {
  if (!sessionRepo) return null
  const r = await $.process.run(['git', '-C', sessionRepo, ...LAST_COMMIT_ARGS])
  return r.exitCode === 0 ? firstLine(r.stdout) : null
}

// Repos the main loop touched this turn, once the lookups queued by `trackRepos` have finished.
async function collectTouched($, set, paths, isFile) {
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
  touchChain = touchChain.then(() => collectTouched($, set, paths, isFile)).catch(err => logDebug($, `loose-ends: resolver los repos tocados falló (${err?.message ?? err})`))
}

// Haiku reads the answer: new candidates only from long answers, closures for the live items in any answer.
async function sweep($, answer, touchedNow, commit) {
  const others = (await touchedNow).filter(repo => repo !== sessionRepo)
  if (!sessionRepo && !others.length) return
  const repos = others.length ? candidateRepos(sessionRepo, others) : []
  const open = live(items)
  const r = await $.model.complete({
    model: SWEEP_MODEL,
    system: SWEEP_SYSTEM,
    prompt: buildSweepPrompt(answer, open, candidates(items), repos, rejectedTexts(items)),
    maxTokens: 800,
    timeoutMs: 20000,
  })
  if (!r.isAnswered) {
    await logDebug($, `loose-ends: barrido omitido (${r.reason})`)
    return
  }
  const parsed = parseSweepReply(r.text, open.map(i => i.id), repos, answer, { allowNew: shouldSweep(answer) })
  if (!parsed) {
    await logDebug($, 'loose-ends: barrido con JSON inválido')
    return
  }
  if (parsed.dropped) await logDebug($, `loose-ends: ${parsed.dropped} ${parsed.dropped === 1 ? 'propuesta descartada' : 'propuestas descartadas'} por cita no literal`)
  for (const { repo, ...fresh } of parsed.fresh) {
    const target = repo ?? sessionRepo
    if (target) await offer($, { ...fresh, source: 'sweep' }, target)
  }
  if (parsed.resolved.length && sessionRepo) {
    const now = await nowIso($)
    await mutate($, list => parsed.resolved.reduce((acc, r) => proposeClose(acc, r.id, { quote: r.quote, commit }, now), list))
  }
}

function bandModel(now) {
  const c = counts(items)
  return {
    mood: chispaMood({ candidates: c.candidates, urgent: c.high, flashUntil, working, lastActivity, now }),
    counts: c,
    urgent: topUrgent(items),
    justClosed: justClosed && now < justClosed.until ? justClosed : null,
    recap: null,
    fileError,
  }
}

function paneModel(now) {
  return {
    now,
    branch,
    working,
    fileError,
    noRepo: sessionRepo === null,
    repoName: sessionRepo ? repoName(sessionRepo) : '',
    repoPath: sessionRepo ?? '',
    notice,
    sync,
    editing,
    waiting: candidates(items),
    live: live(items).map(i => ({ ...i, stale: isStale(i, now) })),
    closed: closedRecently(items, now),
    learned: items.filter(i => i.status === 'rejected').length,
  }
}

// The cards a message of the assistant carries: the candidates and proposed closures it quotes, and the ones the
// person already answered there.
function triageCards(text) {
  if (!sessionRepo || typeof text !== 'string') return []
  const cards = []
  for (const item of items) {
    const answered = triage.get(item.id)
    if (answered && containsQuote(text, answered.quote)) {
      cards.push({ kind: answered.kind, item, quote: answered.quote, state: answered.state })
      continue
    }
    if (item.status === 'candidate' && item.evidence && containsQuote(text, item.evidence)) cards.push({ kind: 'candidate', item, quote: item.evidence, state: null })
    else if (item.proposal && containsQuote(text, item.proposal.quote)) cards.push({ kind: 'proposal', item, quote: item.proposal.quote, state: null })
  }
  return cards.map(c => ({ ...c, repoName: repoName(sessionRepo), editing: editing === c.item.id }))
}

// One change the person makes to an item. With `state`, the card under its message remembers the answer and how
// the item was before, so Deshacer can put it back. Answers the item as it was, or null when nothing changed.
async function act($, id, change, state) {
  const before = items.find(i => i.id === id)
  if (!before) return null
  lastActivity = await $.clock.now()
  const now = await nowIso($)
  const res = await mutate($, list => change(list, id, now))
  if (res === null) return null
  if (state) {
    const closing = state === 'closed' || state === 'kept'
    const quote = closing ? before.proposal?.quote : before.evidence
    if (quote) triage.set(id, { kind: closing ? 'proposal' : 'candidate', quote, state, previous: before })
  }
  return before
}

// A close: the band says so for 4 s with Deshacer, and Chispa celebrates.
async function closeWith($, id, change, state) {
  const before = await act($, id, change, state)
  if (!before || items.find(i => i.id === id)?.status !== 'done') return
  const now = await $.clock.now()
  justClosed = { item: before, text: before.text, until: now + FLASH_MS }
  flashUntil = now + FLASH_MS
  $.ui.invalidate('ui.render')
  $.clock.after(FLASH_MS + 50, () => $.ui.invalidate('ui.render'))
}

async function undo($, id) {
  const previous = triage.get(id)?.previous ?? (justClosed?.item.id === id ? justClosed.item : null)
  if (!previous) return
  triage.delete(id)
  if (justClosed?.item.id === id) justClosed = null
  const now = await nowIso($)
  await mutate($, list => restore(list, previous, now))
}

async function doNow($, id) {
  if (working) return
  const item = items.find(i => i.id === id)
  if (!item) return
  const now = await nowIso($)
  const res = await mutate($, list => start(list, id, now))
  if (res === null) return
  await $.prompt.submit({ text: doNowText(item) })
}

async function addByHand($, text) {
  if (!sessionRepo) return
  const now = await nowIso($)
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  await mutate($, list => addManual(list, { text, id, branch, now }))
}

// What the card and the pane can do; every write runs in the background and logs its failure.
function itemActions($) {
  return {
    save: id => background($, act($, id, save, 'saved'), 'guardar el cabo'),
    reject: id => background($, act($, id, reject, 'rejected'), 'rechazar el candidato'),
    confirm: id => background($, closeWith($, id, confirmClose, 'closed'), 'cerrar el cabo'),
    keep: id => background($, act($, id, keepOpen, 'kept'), 'dejar abierto el cabo'),
    undo: id => background($, undo($, id), 'deshacer'),
    startEdit: id => {
      editing = editing === id ? null : id
      $.ui.invalidate('ui.render')
    },
    saveEdited: (id, text) => {
      editing = null
      background($, act($, id, (list, target, now) => editText(list, target, text, now)), 'editar el cabo')
    },
    doNow: id => background($, doNow($, id), 'Hacer'),
    done: id => background($, closeWith($, id, markDone, null), 'cerrar el cabo'),
    dismiss: id => background($, act($, id, dismiss), 'descartar el cabo'),
    reopen: id => background($, act($, id, reopen), 'reabrir el cabo'),
    cyclePriority: id =>
      background($, act($, id, (list, target, now) => setPriority(list, target, NEXT_PRIORITY[list.find(i => i.id === target)?.priority] ?? 'medium', now)), 'cambiar la prioridad'),
    keepFresh: id => background($, act($, id, touch), 'mantener el cabo'),
    add: text => background($, addByHand($, text), 'apuntar un cabo'),
    push: () => background($, pushRemote($, sessionRepo), 'subir los cabos'),
  }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    editing = null
    justClosed = null
    triage.clear()
    working = false
    flashUntil = 0
    turnCommit = null
    lastActivity = await $.clock.now()
    await $.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA })
    await $.command.register({ name: 'pendientes', description: 'Abre el cuaderno: cabos por revisar, abiertos y cerrados', immediate: true })
    touched = new Set()
    sessionRepo = null
    await guarded($, 'resolver el repo de la sesión', () => refreshSessionRepo($))
    branch = await readBranch($)
    await load($)
    notice = null
    sync = null
    if (sessionRepo) background($, startSync($, sessionRepo), 'traer los cabos de origin')
    if (refreshTimer) refreshTimer.cancel()
    refreshTimer = $.clock.every(60000, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e)
    lastActivity = await $.clock.now()
    const r = await next(e)
    trackRepos($, e)
    if (e.tool === 'Bash' && typeof e.command === 'string') {
      const failed = bashFailed(r)
      if (isCommit(e.command, failed)) {
        turnCommit = await lastCommit($)
        flashUntil = (await $.clock.now()) + FLASH_MS
        $.ui.invalidate('ui.render')
        $.clock.after(FLASH_MS + 50, () => $.ui.invalidate('ui.render'))
      }
      if (isPush(e.command, failed)) background($, afterUserPush($), 'subir los cabos tras tu push')
    }
    return r
  })

  on('turn.start', async ($, e, next) => {
    working = true
    turnCommit = null
    lastActivity = await $.clock.now()
    touched = new Set()
    for (const [dir, top] of repoCache) if (top === null) repoCache.delete(dir)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    working = false
    lastActivity = await $.clock.now()
    $.ui.invalidate('ui.render')
    await guarded($, 'resolver el repo de la sesión tras el turno', () => refreshSessionRepo($))
    await guarded($, 'leer la rama tras el turno', async () => {
      branch = await readBranch($)
    })
    const now = await nowIso($)
    await guarded($, 'refrescar los cabos tras el turno', () => mutate($, list => expireCandidates(list, now)))
    if (e.reason === 'answer' && typeof e.answer === 'string' && e.answer.trim()) {
      if (shouldSweep(e.answer) || live(items).some(i => i.status === 'doing')) {
        const set = touched
        background($, sweep($, e.answer, touchChain.then(() => [...set]), turnCommit), 'el barrido')
      }
    }
    return r
  })

  on('tool.call', { tool: 'mcp__loose-ends__note_loose_end' }, async ($, e) => {
    if (String(e.text ?? '').trim().length < 3) return { result: TOOL_TOO_SHORT }
    let target = sessionRepo
    if (typeof e.repo === 'string' && e.repo.trim()) {
      target = await repoOf($, e.repo.trim(), { fresh: true })
      if (!target) return { result: NOT_A_REPO }
    } else if (!target) return { result: NO_GIT_NOTE }
    const out = await offer($, { text: e.text, category: e.category, priority: e.priority, evidence: e.evidence, file: relativeTo(target, e.file), source: 'tool' }, target)
    if (out.error) return { result: toolUnreadable(target, out.error) }
    if (out.reason) return { result: toolRejected(out.reason) }
    return { result: toolProposed(out.added) }
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return { sections: [...r.sections, { id: 'loose-ends:guide', text: TOOL_GUIDE, scope: 'session' }] }
  })

  on('prompt.context', async ($, e, next) => {
    const r = await next(e)
    await load($)
    const text = formatContext(live(items))
    return text ? { ...r, blocks: [...r.blocks, { name: 'looseEnds', text }] } : r
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
      openPane: () => {
        background($, $.ui.open({ id: 'loose-ends', title: 'Cuaderno' }), 'abrir el cuaderno')
      },
      undoClose: () => {
        if (justClosed) background($, undo($, justClosed.item.id), 'deshacer el cierre')
      },
    })
  })

  on('ui.render', { component: 'Pane', requestId: 'loose-ends' }, async ($, e) => {
    const el = $.ui.resolve(e)
    const now = await $.clock.now()
    return renderPane(el, e.surface, paneModel(now), itemActions($))
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const cards = triageCards(e.props.text)
    if (!cards.length) return next(e)
    const text = cards.reduce((t, c) => emphasize(t, c.quote), e.props.text)
    const drawn = await next({ ...e, props: { ...e.props, text } })
    const el = $.ui.resolve(e)
    const actions = itemActions($)
    return el.Box({ flexDirection: 'column', gap: 1, children: [drawn, ...cards.map(c => renderTriage(el, e.surface, c, actions))] })
  })
}
