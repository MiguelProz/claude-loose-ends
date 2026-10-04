import { mock } from 'claude-code/testing'

export const ROOT = '/proj'
export const PATH = `${ROOT}/.claude/loose-ends.json`

export function world(on: any, files: Record<string, string> = {}, opts: { branch?: string; log?: string } = {}) {
  const fs: Record<string, string> = { ...files }
  const clock = mock.clock(on, { now: Date.parse('2026-10-04T10:00:00.000Z') })
  on('session.root', () => ({ value: ROOT }))
  on('session.usage', () => ({ value: { startedAt: clock.now(), context: { tokens: 0, window: 200000, percent: 0 }, rateLimits: [] } }))
  on('fs.exists', ($: any, e: any) => ({ value: e.path in fs }))
  on('fs.read', ($: any, e: any) => ({ value: fs[e.path] }))
  on('fs.write', ($: any, e: any) => { fs[e.path] = e.text; return { value: undefined } })
  on('process.run', ($: any, e: any) => ({
    value: { exitCode: 0, stdout: e.argv[1] === 'rev-parse' ? `${opts.branch ?? 'main'}\n` : opts.log ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('tool.register', ($: any, e: any) => ({ value: { tool: `mcp__loose-ends__${e.name}` } }))
  on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  const start = ($: any) => $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  const saved = () => JSON.parse(fs[PATH] ?? '{"items":[]}').items
  return { fs, clock, start, saved }
}
