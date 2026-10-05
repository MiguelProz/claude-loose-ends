export const SLEEP_AFTER_MS = 30 * 60 * 1000
export const FLASH_MS = 4000

// Chispa's state from the loose ends first and from Claude second; the first that applies wins. She sleeps only
// when the session is truly still: no activity for 30 min, nothing to review and nothing urgent.
export function chispaMood({ candidates = 0, urgent = 0, flashUntil = 0, working = false, lastActivity = 0, now }) {
  if (candidates > 0) return 'note'
  if (urgent > 0) return 'worried'
  if (now < flashUntil) return 'celebrate'
  if (working) return 'working'
  if (now - lastActivity >= SLEEP_AFTER_MS) return 'sleeping'
  return 'idle'
}

export const isCommit = (command, failed) => !failed && /\bgit\s+commit\b/.test(command)
export const isPush = (command, failed) => !failed && /\bgit\s+push\b/.test(command)

export function bashFailed(result) {
  if (!result) return false
  return result.isError === true || /\b[1-9]\d* failed\b/i.test(result.text ?? '')
}
