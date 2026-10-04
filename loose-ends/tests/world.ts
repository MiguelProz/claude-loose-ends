import { mock } from 'claude-code/testing'

export const ROOT = '/proj'
export const PATH = `${ROOT}/.claude/loose-ends.json`

export function world(on: any, files: Record<string, string> = {}, opts: { branch?: string; log?: string; startedAt?: number } = {}) {
  let branch = opts.branch ?? 'main'
  const flags = { failWrites: false, failGit: false, failLog: false }
  const runs: string[][] = []
  const logs: string[] = []
  const toasts: string[] = []
  const commands: any[] = []
  const state = { invalidations: 0 }
  const fs: Record<string, string> = { ...files }
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00.000Z') })
  on('session.root', () => ({ value: ROOT }))
  on('session.usage', () => ({ value: { startedAt: opts.startedAt ?? clock.now(), context: { tokens: 0, window: 200000, percent: 0 }, rateLimits: [] } }))
  on('fs.exists', ($: any, e: any) => ({ value: e.path in fs }))
  on('fs.read', ($: any, e: any) => ({ value: fs[e.path] }))
  on('fs.write', ($: any, e: any) => { if (flags.failWrites) throw new Error('disco lleno'); fs[e.path] = e.text; return { value: undefined } })
  on('process.run', ($: any, e: any) => {
    runs.push(e.argv)
    if (flags.failGit) return { value: { exitCode: 0, stdout: undefined, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 0, stdout: e.argv[1] === 'rev-parse' ? `${branch}\n` : opts.log ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.register', ($: any, e: any) => ({ value: { tool: `mcp__loose-ends__${e.name}` } }))
  on('command.register', ($: any, e: any) => { commands.push(e); return { value: { command: e.name } } })
  on('ui.invalidate', () => { state.invalidations++; return { value: undefined } })
  on('ui.toast', ($: any, e: any) => { toasts.push(e.text); return { value: undefined } })
  on('ui.log', ($: any, e: any) => { if (flags.failLog) throw new Error('log roto'); logs.push(e.message ?? e.text ?? JSON.stringify(e)); return { value: undefined } })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  const start = ($: any) => $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const saved = () => JSON.parse(fs[PATH] ?? '{"items":[]}').items
  const setBranch = (b: string) => { branch = b }
  return { fs, clock, start, saved, setBranch, flags, runs, logs, toasts, commands, state }
}
