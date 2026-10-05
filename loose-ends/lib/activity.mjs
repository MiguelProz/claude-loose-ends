export const SLEEP_AFTER_MS = 5 * 60 * 1000
export const FLASH_MS = 4000
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
const FLASHES = { 'test-fail': 'fail', commit: 'celebrate', worry: 'worried' }

export function planReduce(plan, ev) {
  if (ev.kind === 'create') {
    if (plan.some(t => t.id === ev.id)) return plan.map(t => (t.id === ev.id ? { ...t, subject: ev.subject } : t))
    return [...plan, { id: ev.id, subject: ev.subject, status: 'pending' }]
  }
  if (ev.kind === 'update') {
    return plan.map(t => (t.id === ev.id ? { ...t, ...(ev.status ? { status: ev.status } : {}), ...(ev.subject ? { subject: ev.subject } : {}) } : t))
  }
  if (ev.kind === 'todos') return ev.todos.map((t, k) => ({ id: `todo-${k}`, subject: t.content, status: t.status }))
  return plan
}

export function planProgress(plan) {
  const live = plan.filter(t => t.status !== 'deleted')
  return { done: live.filter(t => t.status === 'completed').length, total: live.length }
}

export function initialMood(now) {
  return { base: 'idle', flash: null, flashUntil: 0, lastActivity: now, working: false }
}

export function moodReduce(s, ev, now) {
  const touched = { ...s, lastActivity: now }
  if (ev.type === 'turn.start') return { ...touched, base: 'thinking', working: true }
  if (ev.type === 'tool') return { ...touched, base: EDIT_TOOLS.has(ev.tool) ? 'coding' : 'thinking' }
  if (ev.type === 'turn.end') {
    if (s.flash && s.flash !== 'talking' && now < s.flashUntil) return { ...touched, base: 'idle', working: false }
    return { ...touched, base: 'idle', working: false, flash: 'talking', flashUntil: now + FLASH_MS }
  }
  if (FLASHES[ev.type]) return { ...touched, flash: FLASHES[ev.type], flashUntil: now + FLASH_MS }
  return s
}

export function moodAt(s, now) {
  if (s.flash && now < s.flashUntil) return s.flash
  if (!s.working && now - s.lastActivity >= SLEEP_AFTER_MS) return 'sleeping'
  return s.base
}

export function classifyBash(command, failed) {
  if (/\bgit\s+commit\b/.test(command)) return failed ? null : 'commit'
  if (/\bgit\s+push\b/.test(command)) return failed ? null : 'push'
  if (/\bnpm\s+(run\s+)?test\b/.test(command) || /(?:^|[;&|])\s*(?:(?:npx|pnpm|yarn|bunx)\s+)?vitest(?![\w./-])/.test(command)) return failed ? 'test-fail' : null
  return null
}

export function bashFailed(result) {
  if (!result) return false
  return result.isError === true || /\b[1-9]\d* failed\b/i.test(result.text ?? '')
}
