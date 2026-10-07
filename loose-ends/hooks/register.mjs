import {
  COMMON_DIR_ARGS, FETCH_ARGS, GIT_ENV, HASH_ARGS, NET_ENV, REF, REMOTE_ARGS, REMOTE_REF, SYNC_GET_ARGS, TREE_ARGS,
  blobArgs, commitArgs, firstLine, hasOrigin, lastCommitArgs, turnLogArgs, mergeItems, pushArgs, sameItems, shaArgs, syncSetArgs, trackArgs, treeInput, updateArgs,
} from '../lib/refstore.mjs'
import {
  LEGACY_FILE, canonicalCategory, addManual, candidates, closedRecently, confirmClose, counts, dismiss, editText, expireCandidates, isStale, keepOpen, live,
  markDone, nextItem, parseItems, propose, proposeClose, prune, reject, rejectedTexts, reopen, restore, save, serializeItems, setPriority, start, suggestable, topUrgent, touch, recap, snapshot,
  heldCandidates, release, unwithdraw, withdraw,
} from '../lib/items.mjs'
import { rejectReason } from '../lib/filter.mjs'
import { SWEEP_MODEL, buildSweepPrompt, containsQuote, parseSweepReply, shouldSweep } from '../lib/detect.mjs'
import {
  TOOL_NAME, doNowText, formatContext, noGitNote, notARepo, passingText, suggestPrefix, suggestText, sweepSystem, toolDescription, toolGuide, toolProposed, toolRejected,
  toolSchema, toolTooShort, toolUnreadable,
} from '../lib/texts.mjs'
import { FLASH_MS, bashFailed, chispaMood, isCommit, isPush } from '../lib/mood.mjs'
import { FILE_TOOLS, candidatePaths, candidateRepos, isAbsolutePath, isIgnoredRepo, normalizePath, parentPath, relativeTo, repoName } from '../lib/repos.mjs'
import { emphasize, renderBand, renderPane, renderTriage, sinceText } from '../lib/screens.mjs'
import { pickLanguage } from '../lib/i18n.mjs'

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
// the item a Hacer pressed during a turn starts once that turn ends
let queuedNow = null
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
// When the current turn started (ISO); the commit the sweep offers as proof is the last one made since then.
let turnStartedAt = null
// Subagents whose turn started and has not ended; while any runs, what the sweep holds back stays held.
const runningAgents = new Set()
// Whether Claude noted a loose end by hand this turn; the sweep then only looks for closures.
let notedThisTurn = false
// How long the sweep holds a candidate back at most, whatever subagent still seems to run.
const HOLD_MAX_MS = 30 * 60 * 1000
// Cards the person answered under a message: id -> { kind, quote, state, previous }.
const triage = new Map()
let refreshTimer = null
// «Desde …» for the band during the first turn: { since, fresh, closed }, or null.
let recapNow = null
// Whether this session already compared with the last one; until then nothing overwrites the old snapshot.
let seenReady = false
// Whether a turn has ended in this session; a late compare then no longer shows «Desde …».
let firstTurnDone = false
// Files whose open loose ends Claude was already told about this turn, relative to the session repo.
const passed = new Set()
const SEEN_FILE = 'loose-ends-seen.json'
// The `language` option as register() receives it, and the language every text is drawn and sent in.
let languageOption = 'auto'
let lang = 'en'
let languageReady = false

// Fixes the language once per load: the option when it says es or en, otherwise (auto) the locale variables.
// Every hook awaits it first, so no text is drawn or sent before it is known; a change of option reloads the module.
async function resolveLanguage($) {
  if (languageReady) return
  let env = {}
  if (languageOption !== 'es' && languageOption !== 'en') {
    try {
      env = { LC_ALL: await $.env.get('LC_ALL'), LC_MESSAGES: await $.env.get('LC_MESSAGES'), LANG: await $.env.get('LANG') }
    } catch {}
  }
  lang = pickLanguage(languageOption, env)
  languageReady = true
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
  const now = await $.clock.now()
  for (let tries = 0; tries < MAX_TRIES; tries++) {
    const read = await readRef($, root)
    if (!read.ok) return { error: read.error }
    const result = fn(read.items)
    // every write also drops what the ref no longer keeps (old closed items, rejected beyond the newest 50)
    const nextItems = prune(Array.isArray(result) ? result : result.items, now)
    if (serializeItems(nextItems) === serializeItems(read.items)) return { result, items: read.items, written: false }
    if (await writeRef($, root, nextItems, read.sha)) return { result, items: nextItems, written: true }
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
    // a write moved the ref past what origin has
    if (done.written && sync === 'synced') sync = 'ahead'
    adopt($, done.items, done.written)
  }
  return done.result
}

// The session repo's items, as its ref holds them after a write or a move; `moved` says whether the ref changed.
function adopt($, list, moved) {
  fileError = null
  items = list
  if (moved && seenReady) background($, recordSeen($, sessionRepo, { compare: false }), 'apuntar lo visto del repo')
  if (editing && !items.some(i => i.id === editing)) editing = null
  $.ui.invalidate('ui.render')
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

// On the write chain: brings origin's items (`theirs`, read from its copy) into the local ref. When the local ref
// holds nothing origin lacks, it moves to origin's commit, so both sides end on the same commit and read «Al día»;
// otherwise, or when another session moved it in between, the merge is written as a new commit.
// Answers whether the local ref now holds origin's items.
async function mergeRemoteNow($, root, theirs) {
  const local = await readRef($, root)
  if (local.ok && theirs.sha && sameItems(mergeItems(local.items, theirs.items), theirs.items)) {
    if (local.sha === theirs.sha) return true
    const moved = await $.process.run(['git', '-C', root, ...updateArgs(theirs.sha, local.sha)])
    if (moved.exitCode === 0) {
      if (root === sessionRepo) adopt($, theirs.items, true)
      return true
    }
  }
  const report = {}
  await mutateNow($, list => mergeItems(list, theirs.items), root, report)
  return !report.error
}

// Brings origin's loose ends into the local ref. Answers null without origin; otherwise whether the merge went well
// (`ok`) and the sha fetched (`lease`, for a push), null when origin has no ref yet or the fetch failed.
async function pullRemote($, root) {
  if (!(await hasRemote($, root))) return null
  let fetched
  try {
    fetched = await $.process.run(['git', '-C', root, ...FETCH_ARGS], { timeoutMs: 20000, env: NET_ENV })
  } catch (err) {
    // a fetch that outlasts its timeout rejects; it counts as one that failed
    await logDebug($, `loose-ends: no se pudieron traer los cabos de origin (${err?.message ?? err})`)
    return { ok: true, lease: null }
  }
  if (fetched.exitCode !== 0) {
    await logDebug($, 'loose-ends: no se pudieron traer los cabos de origin')
    return { ok: true, lease: null }
  }
  const theirs = await readRef($, root, REMOTE_REF)
  if (!theirs.ok) {
    await logDebug($, `loose-ends: los cabos de origin no se pueden leer (${theirs.error})`)
    return { ok: false, lease: null }
  }
  const run = writeChain.then(() => mergeRemoteNow($, root, theirs))
  writeChain = run.catch(() => {})
  let ok = false
  try {
    ok = await run
  } catch (err) {
    await logDebug($, `loose-ends: fusionar los cabos de origin falló (${err?.message ?? err})`)
  }
  return { ok, lease: theirs.sha }
}

// Merges origin first, then pushes the commit the local ref holds, refused if origin moved after the fetch. A merge
// that failed pushes nothing: the local ref may lack what origin has.
async function pushRemote($, root) {
  if (!root) return
  const pulled = await pullRemote($, root)
  if (pulled && !pulled.ok) {
    if (root === sessionRepo) {
      sync = 'failed'
      $.ui.invalidate('ui.render')
    }
    await logDebug($, 'loose-ends: no se suben los cabos porque no se pudieron fusionar con los de origin')
    return
  }
  const lease = pulled?.lease ?? null
  const mine = await readSha($, root, REF)
  if (!mine) return
  if (mine !== lease) {
    let pushed
    let why = ''
    try {
      pushed = await $.process.run(['git', '-C', root, ...pushArgs(lease, mine)], { timeoutMs: 30000, env: NET_ENV })
    } catch (err) {
      // a push that outlasts its timeout rejects; it counts as one that failed
      why = ` (${err?.message ?? err})`
    }
    if (!pushed || pushed.exitCode !== 0) {
      if (root === sessionRepo) {
        sync = 'failed'
        $.ui.invalidate('ui.render')
      }
      await logDebug($, `loose-ends: no se pudieron subir los cabos a origin${why}`)
      return
    }
    await $.process.run(['git', '-C', root, ...trackArgs(mine)])
  }
  if (root === sessionRepo) {
    // a write that landed after `mine` was read is still to push
    sync = await refreshSync($, root)
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
  if (root === sessionRepo) await guarded($, 'comparar con lo que vio la última sesión', () => recordSeen($, root, { compare: true }))
}

async function seenPath($, root) {
  const r = await $.process.run(['git', '-C', root, ...COMMON_DIR_ARGS])
  const dir = r.exitCode === 0 ? firstLine(r.stdout) : null
  return dir ? `${normalizePath(dir)}/${SEEN_FILE}` : null
}

// Records what this session sees of the repo; with `compare`, first sets the band's «Desde …» against what the
// last session saw.
async function recordSeen($, root, { compare }) {
  if (fileError) return
  const path = await seenPath($, root)
  if (!path) return
  const now = await $.clock.now()
  if (compare) {
    if (await $.fs.exists(path)) {
      let seen = null
      try {
        seen = JSON.parse(await $.fs.read(path))
      } catch {}
      const r = recap(items, seen)
      if (!firstTurnDone) recapNow = r && (r.fresh || r.closed) ? { since: sinceText(lang, r.at, now), fresh: r.fresh, closed: r.closed } : null
      $.ui.invalidate('ui.render')
    }
    seenReady = true
  } else if (!seenReady) return
  await $.fs.write(path, JSON.stringify(snapshot(items, new Date(now).toISOString())))
}

// The open loose ends anchored to the file a main-loop tool reads or edits, as a line for Claude; once per file
// and turn, and only for the session repo, whose items live in memory.
function passingFor(e) {
  if (!sessionRepo || !FILE_TOOLS.has(e.tool)) return null
  const path = e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path
  const rel = isAbsolutePath(path) ? relativeTo(sessionRepo, path) : undefined
  if (!rel || passed.has(rel)) return null
  const here = live(items).filter(i => i.file === rel)
  if (!here.length) return null
  return { rel, text: passingText(lang, here) }
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

// The last commit of the session repo made since `since` (ISO), or null when there is none, no repo, or git fails.
async function commitSince($, since) {
  if (!sessionRepo || !since) return null
  const r = await $.process.run(['git', '-C', sessionRepo, ...lastCommitArgs(since)])
  return r.exitCode === 0 ? firstLine(r.stdout) : null
}

// The commits of the session repo made since `since`, as «sha subject» lines; empty when there are none or git fails.
async function logSince($, since) {
  if (!sessionRepo || !since) return ''
  const r = await $.process.run(['git', '-C', sessionRepo, ...turnLogArgs(since)])
  return r.exitCode === 0 && typeof r.stdout === 'string' ? r.stdout.trim() : ''
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

// Haiku reads the answer: new candidates only from long answers and only when Claude noted nothing by hand; in any
// answer, closures for the live items and the candidates still waiting, which a later answer often shows done. What
// the sweep proposes is held back one turn: the next sweep withdraws it if it was done meanwhile, or shows it.
async function sweep($, answer, touchedNow, commit, { allowNew, log = '' }) {
  const held = heldCandidates(items).map(i => i.id)
  const resolvedIds = new Set()
  try {
    await sweepAnswer($, answer, touchedNow, commit, { allowNew, log }, resolvedIds)
  } finally {
    await releaseHeld($, held.filter(id => !resolvedIds.has(id)))
  }
}

// The held candidates go to the person, unless a subagent still runs and they are younger than HOLD_MAX_MS.
async function releaseHeld($, ids) {
  if (!ids.length || !sessionRepo) return
  const nowMs = await $.clock.now()
  const ready = ids.filter(id => {
    const item = items.find(i => i.id === id)
    return item && (!runningAgents.size || nowMs - (Date.parse(item.createdAt) || 0) >= HOLD_MAX_MS)
  })
  if (!ready.length) return
  const now = await nowIso($)
  await guarded($, 'mostrar los candidatos del barrido', () => mutate($, list => release(list, ready, now)))
}

async function sweepAnswer($, answer, touchedNow, commit, { allowNew, log }, resolvedIds) {
  const others = (await touchedNow).filter(repo => repo !== sessionRepo)
  if (!sessionRepo && !others.length) return
  const repos = others.length ? candidateRepos(sessionRepo, others) : []
  const open = live(items)
  const waiting = [...candidates(items), ...heldCandidates(items)]
  const r = await $.model.complete({
    model: SWEEP_MODEL,
    system: sweepSystem(lang),
    prompt: buildSweepPrompt(lang, answer, open, waiting, repos, rejectedTexts(items), log),
    maxTokens: 800,
    timeoutMs: 20000,
  })
  if (!r.isAnswered) {
    await logDebug($, `loose-ends: barrido omitido (${r.reason})`)
    return
  }
  const parsed = parseSweepReply(r.text, [...open, ...waiting].map(i => i.id), repos, answer, { allowNew, log })
  if (!parsed) {
    await logDebug($, 'loose-ends: barrido con JSON inválido')
    return
  }
  if (parsed.dropped) await logDebug($, `loose-ends: ${parsed.dropped} ${parsed.dropped === 1 ? 'propuesta descartada' : 'propuestas descartadas'} por cita no literal`)
  for (const { text, reason } of parsed.skipped) await logDebug($, `loose-ends: candidato del barrido descartado (${reason}): ${text}`)
  for (const { repo, ...fresh } of parsed.fresh) {
    const target = repo ?? sessionRepo
    if (!target) continue
    await guarded($, `proponer en ${target}`, async () => {
      const out = await offer($, { ...fresh, source: 'sweep', held: true }, target)
      if (out.error) await logDebug($, `loose-ends: no se pudo proponer en ${target} (${out.error})`)
    })
  }
  if (parsed.resolved.length && sessionRepo) {
    const now = await nowIso($)
    await guarded($, 'proponer los cierres', async () => {
      const res = await mutate($, list => {
        // a live item gets a closure for the person to confirm; a candidate nobody accepted yet goes away by itself
        const next = parsed.resolved.reduce((acc, r) => withdraw(proposeClose(acc, r.id, { quote: r.quote, commit }, now), r.id, { quote: r.quote, commit }, now), list)
        const changed = parsed.resolved.map(r => ({ before: list.find(i => i.id === r.id), after: next.find(i => i.id === r.id) })).filter(c => c.before && c.after !== c.before)
        return { items: next, changed }
      })
      for (const { before, after } of res?.changed ?? []) {
        resolvedIds.add(before.id)
        // a card's Deshacer would put back the item without the closure just proposed
        triage.delete(before.id)
        // the withdrawn candidate's card says so under its message, and Deshacer brings it back to review; a held one
        // was never shown, so it goes without a word
        if (before.status === 'candidate' && after.status !== 'candidate' && before.held) {
          await logDebug($, `loose-ends: candidato retenido retirado, resuelto después: ${before.text}`)
        } else if (before.status === 'candidate' && after.status !== 'candidate' && before.evidence) {
          triage.set(before.id, { kind: 'candidate', quote: before.evidence, state: 'withdrawn', previous: before })
          await logDebug($, `loose-ends: candidato retirado, resuelto después: ${before.text}`)
        }
      }
    })
  }
}

function bandModel(now) {
  const c = counts(items)
  return {
    lang,
    mood: chispaMood({ candidates: c.candidates, urgent: c.high, flashUntil, working, lastActivity, now }),
    counts: c,
    urgent: topUrgent(items),
    justClosed: justClosed && now < justClosed.until ? justClosed : null,
    recap: recapNow,
    fileError,
    next: nextItem(items),
    sync,
    working,
  }
}

function paneModel(now) {
  return {
    now,
    lang,
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
    if (item.status === 'candidate' && !item.held && item.evidence && containsQuote(text, item.evidence)) cards.push({ kind: 'candidate', item, quote: item.evidence, state: null })
    else if (item.proposal && containsQuote(text, item.proposal.quote)) cards.push({ kind: 'proposal', item, quote: item.proposal.quote, state: null })
  }
  return cards.map(c => ({ ...c, lang, repoName: repoName(sessionRepo), editing: editing === c.item.id }))
}

// One change the person makes to an item. With `state`, the card under its message remembers the answer and how
// the item was before, so Deshacer can put it back. Answers the item as it was, or null when nothing changed.
async function act($, id, change, state) {
  const before = items.find(i => i.id === id)
  if (!before) return null
  lastActivity = await $.clock.now()
  const now = await nowIso($)
  // transitions keep the items they do not touch as the same objects, so a changed one is a different object
  const res = await mutate($, list => {
    const next = change(list, id, now)
    return { items: next, changed: next.find(i => i.id === id) !== list.find(i => i.id === id) }
  })
  if (!res?.changed) return null
  // a later action from the pane replaces the answer the card remembered
  triage.delete(id)
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

// The card's Deshacer: the item goes back to how it was before the person answered the card.
async function undo($, id) {
  const previous = triage.get(id)?.previous
  if (!previous) return
  triage.delete(id)
  if (justClosed?.item.id === id) justClosed = null
  const now = await nowIso($)
  await mutate($, list => restore(list, previous, now))
}

// The band's Deshacer: the item goes back to how it was before the last close, whatever happened to it since.
async function undoClosed($) {
  const previous = justClosed?.item
  if (!previous) return
  justClosed = null
  triage.delete(previous.id)
  const now = await nowIso($)
  await mutate($, list => restore(list, previous, now))
}

// Hacer, from the pane or the band: starts the item in the background and logs a failure.
function pressNow($, id) {
  background($, doNow($, id), 'Hacer')
}

async function doNow($, id) {
  const item = items.find(i => i.id === id)
  if (!item) return
  if (working) {
    queuedNow = id
    await $.ui.toast(`Lo empiezo cuando Claude termine: ${item.text}`)
    return
  }
  const now = await nowIso($)
  const res = await mutate($, list => start(list, id, now))
  if (res === null) return
  // a card's Deshacer would put back the item as it was before Hacer
  triage.delete(id)
  await $.prompt.submit({ text: doNowText(lang, item) })
}

// The urgent item as the prompt's suggestion, sent once the turn has ended: while a turn runs the box shows none.
async function suggestUrgent($) {
  const item = suggestable(items)
  if (!item || working) return
  const r = await $.prompt.suggest({ text: suggestText(lang, item) })
  if (!r?.isShown) await logDebug($, 'loose-ends: la sugerencia del cabo urgente no se mostró')
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
    doNow: id => pressNow($, id),
    done: id => background($, closeWith($, id, markDone, null), 'cerrar el cabo'),
    dismiss: id => background($, act($, id, dismiss), 'descartar el cabo'),
    // ↺ reopens a closed item, or brings a withdrawn candidate back to review
    reopen: id => background($, act($, id, (list, target, now) => unwithdraw(reopen(list, target, now), target, now)), 'reabrir el cabo'),
    cyclePriority: id =>
      background($, act($, id, (list, target, now) => setPriority(list, target, NEXT_PRIORITY[list.find(i => i.id === target)?.priority] ?? 'medium', now)), 'cambiar la prioridad'),
    keepFresh: id => background($, act($, id, touch), 'mantener el cabo'),
    add: text => background($, addByHand($, text), 'apuntar un cabo'),
    push: () => background($, pushRemote($, sessionRepo), 'subir los cabos'),
    dismissNotice: () => {
      notice = null
      $.ui.invalidate('ui.render')
    },
  }
}

export function register(on, options = {}) {
  languageOption = options.language ?? 'auto'
  languageReady = false
  on('session.start', async ($, e, next) => {
    await resolveLanguage($)
    editing = null
    recapNow = null
    seenReady = false
    firstTurnDone = false
    passed.clear()
    justClosed = null
    triage.clear()
    working = false
    flashUntil = 0
    turnStartedAt = null
    runningAgents.clear()
    notedThisTurn = false
    lastActivity = await $.clock.now()
    await $.tool.register({ name: TOOL_NAME, description: toolDescription(lang), inputSchema: toolSchema(lang) })
    await $.command.register({ name: 'pendientes', description: 'Abre el cuaderno: cabos por revisar, abiertos y cerrados', immediate: true })
    touched = new Set()
    sessionRepo = null
    await guarded($, 'resolver el repo de la sesión', () => refreshSessionRepo($))
    branch = null
    await guarded($, 'leer la rama', async () => {
      branch = await readBranch($)
    })
    await guarded($, 'leer los cabos', () => load($))
    // what an earlier session's sweep held back has had its turn: it goes to the person now
    await releaseHeld($, heldCandidates(items).map(i => i.id))
    notice = null
    sync = null
    if (sessionRepo) background($, startSync($, sessionRepo), 'traer los cabos de origin')
    if (refreshTimer) refreshTimer.cancel()
    refreshTimer = $.clock.every(60000, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e)
    await resolveLanguage($)
    lastActivity = await $.clock.now()
    const r = await next(e)
    trackRepos($, e)
    if (e.tool === 'Bash' && typeof e.command === 'string') {
      const failed = bashFailed(r)
      if (isCommit(e.command, failed)) {
        flashUntil = (await $.clock.now()) + FLASH_MS
        $.ui.invalidate('ui.render')
        $.clock.after(FLASH_MS + 50, () => $.ui.invalidate('ui.render'))
      }
      if (isPush(e.command, failed)) background($, afterUserPush($), 'subir los cabos tras tu push')
    }
    const passing = passingFor(e)
    if (passing && r && !r.deny && !r.isError) {
      passed.add(passing.rel)
      return { ...r, context: [...(r.context ?? []), passing.text] }
    }
    return r
  })

  on('turn.start', async ($, e, next) => {
    await resolveLanguage($)
    working = true
    if (e.agentId) runningAgents.add(e.agentId)
    else notedThisTurn = false
    if (!e.agentId) turnStartedAt = await nowIso($)
    lastActivity = await $.clock.now()
    touched = new Set()
    if (!e.agentId) {
      passed.clear()
      const prefix = suggestPrefix(lang)
      if (typeof e.text === 'string' && e.text.startsWith(prefix)) {
        const wanted = e.text.slice(prefix.length).trim()
        const item = live(items).find(i => i.text === wanted)
        if (item) background($, act($, item.id, start), 'empezar el cabo sugerido')
      }
    }
    for (const [dir, top] of repoCache) if (top === null) repoCache.delete(dir)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await resolveLanguage($)
    const r = await next(e)
    if (e.agentId) {
      runningAgents.delete(e.agentId)
      return r
    }
    working = false
    recapNow = null
    firstTurnDone = true
    lastActivity = await $.clock.now()
    $.ui.invalidate('ui.render')
    await guarded($, 'resolver el repo de la sesión tras el turno', () => refreshSessionRepo($))
    await guarded($, 'leer la rama tras el turno', async () => {
      branch = await readBranch($)
    })
    const now = await nowIso($)
    await guarded($, 'refrescar los cabos tras el turno', () => mutate($, list => expireCandidates(list, now)))
    if (sessionRepo) await guarded($, 'apuntar lo visto del repo', () => recordSeen($, sessionRepo, { compare: false }))
    if (queuedNow) {
      const id = queuedNow
      queuedNow = null
      $.clock.after(500, () => pressNow($, id))
    } else if (suggestable(items)) $.clock.after(500, () => background($, suggestUrgent($), 'sugerir el cabo urgente'))
    if (e.reason === 'answer' && typeof e.answer === 'string' && e.answer.trim()) {
      const allowNew = shouldSweep(e.answer) && !notedThisTurn
      if (allowNew || live(items).some(i => i.status === 'doing') || items.some(i => i.status === 'candidate')) {
        const set = touched
        let commit = null
        let log = ''
        await guarded($, 'leer el commit del turno', async () => {
          commit = await commitSince($, turnStartedAt)
          if (commit) log = await logSince($, turnStartedAt)
        })
        background($, sweep($, e.answer, touchChain.then(() => [...set]), commit, { allowNew, log }), 'el barrido')
      }
    }
    return r
  })

  on('tool.call', { tool: 'mcp__loose-ends__note_loose_end' }, async ($, e) => {
    await resolveLanguage($)
    notedThisTurn = true
    if (String(e.text ?? '').trim().length < 3) return { result: toolTooShort(lang) }
    let target = sessionRepo
    if (typeof e.repo === 'string' && e.repo.trim()) {
      target = await repoOf($, e.repo.trim(), { fresh: true })
      if (!target) return { result: notARepo(lang) }
    } else if (!target) return { result: noGitNote(lang) }
    let out
    try {
      out = await offer($, { text: e.text, category: canonicalCategory(e.category), priority: e.priority, evidence: e.evidence, file: relativeTo(target, e.file), source: 'tool' }, target)
    } catch (err) {
      return { result: toolUnreadable(lang, target, err?.message ?? String(err)) }
    }
    if (out.error) return { result: toolUnreadable(lang, target, out.error) }
    if (out.reason) return { result: toolRejected(lang, out.reason) }
    return { result: toolProposed(lang, out.added) }
  })

  on('prompt.suggest', async ($, e, next) => {
    await resolveLanguage($)
    if (e.origin?.kind !== 'suggestion') return next(e)
    const item = suggestable(items)
    return item ? next({ ...e, text: suggestText(lang, item) }) : next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    await resolveLanguage($)
    const r = await next(e)
    return { sections: [...r.sections, { id: 'loose-ends:guide', text: toolGuide(lang), scope: 'session' }] }
  })

  on('prompt.context', async ($, e, next) => {
    await resolveLanguage($)
    const r = await next(e)
    await load($)
    const text = formatContext(lang, live(items))
    return text ? { ...r, blocks: [...r.blocks, { name: 'looseEnds', text }] } : r
  })

  on('command.run', { command: 'pendientes' }, async ($) => {
    await resolveLanguage($)
    await $.ui.open({ id: 'loose-ends', title: 'Cuaderno' })
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await resolveLanguage($)
    if (e.props.hasSurvey) return next(e)
    const el = $.ui.resolve(e)
    const now = await $.clock.now()
    return renderBand(el, e.surface, bandModel(now), {
      openPane: () => {
        background($, $.ui.open({ id: 'loose-ends', title: 'Cuaderno' }), 'abrir el cuaderno')
      },
      undoClose: () => {
        background($, undoClosed($), 'deshacer el cierre')
      },
      doNow: id => pressNow($, id),
    })
  })

  on('ui.render', { component: 'Pane', requestId: 'loose-ends' }, async ($, e) => {
    await resolveLanguage($)
    const el = $.ui.resolve(e)
    const now = await $.clock.now()
    return renderPane(el, e.surface, paneModel(now), itemActions($))
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    await resolveLanguage($)
    const cards = triageCards(e.props.text)
    if (!cards.length) return next(e)
    const text = cards.reduce((t, c) => emphasize(t, c.quote), e.props.text)
    const drawn = await next({ ...e, props: { ...e.props, text } })
    const el = $.ui.resolve(e)
    const actions = itemActions($)
    return el.Box({ flexDirection: 'column', gap: 1, children: [drawn, ...cards.map(c => renderTriage(el, e.surface, c, actions))] })
  })
}
