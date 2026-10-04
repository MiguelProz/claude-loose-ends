import { PRIORITIES } from './store.mjs'

export const SWEEP_MODEL = 'claude-haiku-4-5-20251001'
export const MIN_ANSWER = 300

export function shouldSweep(answer) {
  return typeof answer === 'string' && answer.length >= MIN_ANSWER
}

export function buildSweepPrompt(answer, openItems) {
  const list = openItems.length ? openItems.map(i => `- ${i.id}: ${i.text}`).join('\n') : '(ninguno)'
  return `Cabos abiertos:\n${list}\n\nRespuesta del asistente:\n<<<\n${answer.slice(0, 12000)}\n>>>`
}

export function parseSweepReply(text, openIds) {
  const match = typeof text === 'string' ? text.match(/\{[\s\S]*\}/) : null
  if (!match) return null
  let data
  try {
    data = JSON.parse(match[0])
  } catch {
    return null
  }
  const fresh = (Array.isArray(data.new) ? data.new : [])
    .filter(x => x && typeof x.text === 'string' && x.text.trim().length >= 3)
    .slice(0, 5)
    .map(x => ({
      text: x.text.trim().slice(0, 300),
      priority: PRIORITIES.includes(x.priority) ? x.priority : 'medium',
      evidence: typeof x.evidence === 'string' ? x.evidence.slice(0, 400) : undefined,
    }))
  const known = new Set(openIds)
  const resolved = (Array.isArray(data.resolved) ? data.resolved : []).filter(id => known.has(id))
  return { fresh, resolved }
}
