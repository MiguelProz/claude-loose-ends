import { mock } from 'claude-code/testing'
import { REF } from '../lib/refstore.mjs'

export const ROOT = '/proj'
// The file a 0.3 version kept in the working tree; only the import reads it.
export const legacyOf = (top: string) => `${top}/.claude/loose-ends.json`
export const LEGACY = legacyOf(ROOT)

type Opts = {
  branch?: string
  log?: string
  // what `git log -1 --format=%h` answers
  head?: string
  // when that commit was made (ISO): a `--since=` later than this finds no commit; without it HEAD always counts
  headAt?: string
  startedAt?: number
  root?: string
  // directory prefix -> git toplevel; a directory under none of them is not in a repo (exit 128)
  repos?: Record<string, string>
  // git toplevel -> current branch; the rest use `branch`
  branches?: Record<string, string>
  // directories (and everything under them) that do not exist: git -C fails there
  missing?: string[]
  // $HOME; null for unset
  home?: string | null
  // %USERPROFILE%, for when HOME is unset (Windows)
  userProfile?: string
  // LC_ALL, LC_MESSAGES and LANG; left out, LANG=es_ES.UTF-8, so `auto` picks the Spanish the older tests were
  // written in. `{}` means none is set.
  env?: Record<string, string>
  // git toplevel -> the blob text its data ref holds
  refs?: Record<string, string>
  // git toplevel -> origin's data ref blob text ('' for an origin without the ref); toplevels not listed have no origin
  remote?: Record<string, string>
  // git toplevel -> git config loose-ends.sync
  sync?: Record<string, string>
}

// The test host runs on POSIX and resolves a drive-letter path against its cwd before the stub sees it; undo that.
const fsKey = (path: string) => path.replace(/^.*?\/(?=[A-Za-z]:\/)/, '')

export function world(on: any, files: Record<string, string> = {}, opts: Opts = {}) {
  let branch = opts.branch ?? 'main'
  let root = opts.root ?? ROOT
  const repos = opts.repos ?? { [ROOT]: ROOT }
  // timeoutNet: fetch and push reject, as $.process.run does when a network call outlasts its timeoutMs
  const flags = { failWrites: false, failGit: false, failLog: false, throwGit: false, timeoutNet: false }
  const runs: string[][] = []
  const logs: string[] = []
  const toasts: string[] = []
  // toplevels whose data ref moved, in order
  const writes: string[] = []
  // toplevels whose data ref was read
  const gitReads: string[] = []
  const reads: string[] = []
  const pushes: string[] = []
  const fetches: string[] = []
  // the environment each commit-tree ran with
  const envs: any[] = []
  // the environment each fetch and push ran with
  const netEnvs: any[] = []
  const commands: any[] = []
  const tools: any[] = []
  const state = { invalidations: 0 }
  const fs: Record<string, string> = { ...files }
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00.000Z') })

  // Object store: sha -> body. A blob's body is its text, a tree's the sha of its one blob, a commit's the sha of its tree.
  let count = 0
  const objects = new Map<string, string>()
  const put = (body: string) => {
    const sha = (++count).toString(16).padStart(40, '0')
    objects.set(sha, body)
    return sha
  }
  const commitOf = (text: string) => put(put(put(text)))
  const blobOf = (commit?: string | null) => {
    const tree = commit ? objects.get(commit) : undefined
    const blob = tree ? objects.get(tree) : undefined
    return blob ? objects.get(blob) : undefined
  }
  const refsOf: Record<string, Record<string, string>> = {}
  const git = (top: string) => (refsOf[top] ??= {})
  for (const [top, text] of Object.entries(opts.refs ?? {})) git(top)[REF] = commitOf(text)
  // toplevel -> sha of origin's data ref (null: origin exists without it)
  const remotes: Record<string, string | null> = {}
  for (const [top, text] of Object.entries(opts.remote ?? {})) remotes[top] = text === '' ? null : commitOf(text)
  const config: Record<string, string> = { ...(opts.sync ?? {}) }
  // another session moving the data ref right before the next update-ref (`times` updates in a row)
  const races: Record<string, { text: string; times: number }> = {}
  // another machine pushing to origin right before the next push
  const remoteRaces: Record<string, string> = {}

  const topOf = (dir: string) => {
    // like real git: a file is not a directory, and neither is a path that does not exist
    if (dir in fs || /[^/]\.[A-Za-z0-9]+$/.test(dir)) return null
    if ((opts.missing ?? []).some(m => dir === m || dir.startsWith(`${m}/`))) return null
    const key = Object.keys(repos).filter(k => dir === k || dir.startsWith(`${k}/`)).sort((a, b) => b.length - a.length)[0]
    return key === undefined ? null : repos[key]
  }
  on('session.root', () => ({ value: root }))
  const locale = opts.env ?? { LANG: 'es_ES.UTF-8' }
  on('env.get', ($: any, e: any) => {
    if (e.name === 'USERPROFILE') return { value: opts.userProfile }
    if (e.name === 'HOME') return { value: opts.home === null ? undefined : opts.home ?? '/Users/m' }
    return { value: locale[e.name] }
  })
  on('session.usage', () => ({ value: { startedAt: opts.startedAt ?? clock.now(), context: { tokens: 0, window: 200000, percent: 0 }, rateLimits: [] } }))
  on('fs.exists', ($: any, e: any) => { reads.push(fsKey(e.path)); return { value: fsKey(e.path) in fs } })
  on('fs.read', ($: any, e: any) => { reads.push(fsKey(e.path)); return { value: fs[fsKey(e.path)] } })
  on('fs.write', ($: any, e: any) => { if (flags.failWrites) throw new Error('disco lleno'); fs[fsKey(e.path)] = e.text; return { value: undefined } })
  on('process.run', ($: any, e: any) => {
    runs.push(e.argv)
    if (flags.throwGit) throw new Error('git no arranca')
    const result = (exitCode: number, stdout: string | undefined) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (flags.failGit) return result(0, undefined)
    const dashC = e.argv[1] === '-C'
    const dir = String(dashC ? e.argv[2] : e.init?.cwd ?? root).replace(/\\/g, '/')
    const args: string[] = dashC ? e.argv.slice(3) : e.argv.slice(1)
    const top = topOf(dir)
    if (top === null) return result(128, '')
    const refs = git(top)
    const stdin = String(e.init?.stdin ?? '')
    switch (args[0]) {
      case 'rev-parse': {
        if (args.includes('--show-toplevel')) return result(0, `${top}\n`)
        if (args.includes('--git-common-dir')) return result(0, `${top}/.git\n`)
        if (args.includes('--verify')) {
          if (args.at(-1) === REF) gitReads.push(top)
          const sha = refs[args.at(-1) as string]
          return sha ? result(0, `${sha}\n`) : result(1, '')
        }
        return result(0, `${opts.branches?.[top] ?? branch}\n`)
      }
      case 'cat-file': {
        const text = blobOf(args[2].split(':')[0])
        return text === undefined ? result(128, '') : result(0, text)
      }
      case 'hash-object':
        return flags.failWrites ? result(1, '') : result(0, `${put(stdin)}\n`)
      case 'mktree':
        return result(0, `${put(stdin.split(/\s+/)[2])}\n`)
      case 'commit-tree':
        envs.push(e.init?.env)
        return result(0, `${put(args[1])}\n`)
      case 'update-ref': {
        const [, ref, next, prev] = args
        if (prev === undefined) {
          refs[ref] = next
          return result(0, '')
        }
        const race = races[top]
        if (race) {
          refs[REF] = commitOf(race.text)
          if (--race.times === 0) delete races[top]
        }
        // like real git, an empty old value means the ref must not exist yet
        if ((refs[ref] ?? '') !== prev) return result(1, '')
        refs[ref] = next
        writes.push(top)
        return result(0, '')
      }
      case 'remote':
        return result(0, top in remotes ? 'origin\n' : '')
      case 'fetch': {
        netEnvs.push(e.init?.env)
        if (flags.timeoutNet) throw new Error('git fetch superó el tiempo')
        // origin holds only the data ref: `+<src>:<dst>`
        const [src, dst] = String(args.at(-1)).replace(/^\+/, '').split(':')
        if (!(top in remotes) || remotes[top] === null || src !== REF) return result(128, '')
        fetches.push(top)
        refs[dst] = remotes[top] as string
        return result(0, '')
      }
      case 'push': {
        netEnvs.push(e.init?.env)
        if (flags.timeoutNet) throw new Error('git push superó el tiempo')
        if (!(top in remotes)) return result(128, '')
        const [src, dst] = String(args.at(-1)).split(':')
        // like real git's receive-pack: a ref with one component under refs/ is a "funny refname"
        if (/^refs\/[^/]+$/.test(dst)) return result(1, '')
        const sha = /^[0-9a-f]{40}$/.test(src) ? src : refs[src]
        if (!sha) return result(1, '')
        if (remoteRaces[top] !== undefined) {
          remotes[top] = commitOf(remoteRaces[top])
          delete remoteRaces[top]
        }
        const lease = args.find(a => a.startsWith('--force-with-lease='))
        const expect = lease === undefined ? undefined : lease.slice(lease.indexOf(':') + 1)
        if (expect !== undefined && (remotes[top] ?? '') !== expect) return result(1, '')
        remotes[top] = sha
        pushes.push(top)
        return result(0, '')
      }
      case 'config': {
        if (args[1] === '--get') return config[top] === undefined ? result(1, '') : result(0, `${config[top]}\n`)
        config[top] = args[2]
        return result(0, '')
      }
      case 'log': {
        if (!args.includes('-1')) return result(0, opts.log ?? '')
        const since = args.find(a => a.startsWith('--since='))
        if (opts.headAt !== undefined && since !== undefined && Date.parse(since.slice('--since='.length)) > Date.parse(opts.headAt)) return result(0, '')
        return result(0, `${opts.head ?? 'abc1234'}\n`)
      }
      default:
        return result(0, opts.log ?? '')
    }
  })
  on('tool.register', ($: any, e: any) => { tools.push(e); return { value: { tool: `mcp__loose-ends__${e.name}` } } })
  on('command.register', ($: any, e: any) => { commands.push(e); return { value: { command: e.name } } })
  on('ui.invalidate', () => { state.invalidations++; return { value: undefined } })
  on('ui.toast', ($: any, e: any) => { toasts.push(e.text); return { value: undefined } })
  on('ui.log', ($: any, e: any) => { if (flags.failLog) throw new Error('log roto'); logs.push(e.message ?? e.text ?? JSON.stringify(e)); return { value: undefined } })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  const start = ($: any) => $.session.start({ cwd: root, surface: 'desktop', isInteractive: true })
  const refText = (top: string) => blobOf(refsOf[top]?.[REF])
  const savedAt = (top: string) => JSON.parse(refText(top) ?? '{"items":[]}').items
  const saved = () => savedAt(ROOT)
  // another session writing the ref directly
  const setRef = (top: string, text: string) => { git(top)[REF] = commitOf(text) }
  const race = (top: string, text: string, times = 1) => { races[top] = { text, times } }
  const remoteRace = (top: string, text: string) => { remoteRaces[top] = text }
  const remoteText = (top: string) => blobOf(remotes[top])
  // origin's data ref changed by another machine
  const setRemote = (top: string, text: string) => { remotes[top] = text === '' ? null : commitOf(text) }
  // the commits the local and origin's data refs point at
  const refSha = (top: string) => refsOf[top]?.[REF]
  const remoteSha = (top: string) => remotes[top]
  const setBranch = (b: string) => { branch = b }
  const setRoot = (r: string) => { root = r }
  return { fs, clock, start, saved, savedAt, refText, setRef, race, remoteRace, remoteText, setRemote, refSha, remoteSha, setBranch, setRoot, flags, runs, logs, toasts, writes, gitReads, reads, pushes, fetches, envs, netEnvs, config, commands, tools, state }
}
