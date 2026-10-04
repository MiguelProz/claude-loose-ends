import { mock } from 'claude-code/testing'

export const ROOT = '/proj'
export const PATH = `${ROOT}/.claude/loose-ends.json`
export const pathOf = (top: string) => `${top}/.claude/loose-ends.json`

type Opts = {
  branch?: string
  log?: string
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
}

// The test host runs on POSIX and resolves a drive-letter path against its cwd before the stub sees it; undo that.
const fsKey = (path: string) => path.replace(/^.*?\/(?=[A-Za-z]:\/)/, '')

export function world(on: any, files: Record<string, string> = {}, opts: Opts = {}) {
  let branch = opts.branch ?? 'main'
  let root = opts.root ?? ROOT
  const repos = opts.repos ?? { [ROOT]: ROOT }
  const flags = { failWrites: false, failGit: false, failLog: false, throwGit: false }
  const runs: string[][] = []
  const logs: string[] = []
  const toasts: string[] = []
  const writes: string[] = []
  const reads: string[] = []
  const commands: any[] = []
  const state = { invalidations: 0 }
  const fs: Record<string, string> = { ...files }
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00.000Z') })
  const topOf = (dir: string) => {
    // like real git: a file is not a directory, and neither is a path that does not exist
    if (dir in fs || /[^/]\.[A-Za-z0-9]+$/.test(dir)) return null
    if ((opts.missing ?? []).some(m => dir === m || dir.startsWith(`${m}/`))) return null
    const key = Object.keys(repos).filter(k => dir === k || dir.startsWith(`${k}/`)).sort((a, b) => b.length - a.length)[0]
    return key === undefined ? null : repos[key]
  }
  on('session.root', () => ({ value: root }))
  on('env.get', ($: any, e: any) => ({ value: e.name === 'USERPROFILE' ? opts.userProfile : opts.home === null ? undefined : opts.home ?? '/Users/m' }))
  on('session.usage', () => ({ value: { startedAt: opts.startedAt ?? clock.now(), context: { tokens: 0, window: 200000, percent: 0 }, rateLimits: [] } }))
  on('fs.exists', ($: any, e: any) => { reads.push(fsKey(e.path)); return { value: fsKey(e.path) in fs } })
  on('fs.read', ($: any, e: any) => { reads.push(fsKey(e.path)); return { value: fs[fsKey(e.path)] } })
  on('fs.write', ($: any, e: any) => { if (flags.failWrites) throw new Error('disco lleno'); writes.push(fsKey(e.path)); fs[fsKey(e.path)] = e.text; return { value: undefined } })
  on('process.run', ($: any, e: any) => {
    runs.push(e.argv)
    if (flags.throwGit) throw new Error('git no arranca')
    const result = (exitCode: number, stdout: string | undefined) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (flags.failGit) return result(0, undefined)
    const dashC = e.argv[1] === '-C'
    const dir = String(dashC ? e.argv[2] : e.init?.cwd ?? root).replace(/\\/g, '/')
    const args = dashC ? e.argv.slice(3) : e.argv.slice(1)
    const top = topOf(dir)
    if (top === null) return result(128, '')
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return result(0, `${top}\n`)
    if (args[0] === 'rev-parse') return result(0, `${opts.branches?.[top] ?? branch}\n`)
    return result(0, opts.log ?? '')
  })
  on('tool.register', ($: any, e: any) => ({ value: { tool: `mcp__loose-ends__${e.name}` } }))
  on('command.register', ($: any, e: any) => { commands.push(e); return { value: { command: e.name } } })
  on('ui.invalidate', () => { state.invalidations++; return { value: undefined } })
  on('ui.toast', ($: any, e: any) => { toasts.push(e.text); return { value: undefined } })
  on('ui.log', ($: any, e: any) => { if (flags.failLog) throw new Error('log roto'); logs.push(e.message ?? e.text ?? JSON.stringify(e)); return { value: undefined } })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  const start = ($: any) => $.session.start({ cwd: root, surface: 'desktop', isInteractive: true })
  const savedAt = (path: string) => JSON.parse(fs[path] ?? '{"items":[]}').items
  const saved = () => savedAt(PATH)
  const setBranch = (b: string) => { branch = b }
  const setRoot = (r: string) => { root = r }
  return { fs, clock, start, saved, savedAt, setBranch, setRoot, flags, runs, logs, toasts, writes, reads, commands, state }
}
