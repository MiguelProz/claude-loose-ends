import { describe, expect, test } from 'claude-code/testing'
import { FLASH_MS, SLEEP_AFTER_MS, bashFailed, chispaMood, isCommit, isPush } from '../lib/mood.mjs'
import { MOOD_LABELS, MOODS, TERMINAL_FACES, chispaSvg } from '../lib/chispa.mjs'

const NOW = 1_000_000_000
const base = { candidates: 0, urgent: 0, flashUntil: 0, working: false, lastActivity: NOW, now: NOW }

describe('chispaMood', () => {
  test('the first that applies wins: note, worried, celebrate, working, idle', () => {
    expect(chispaMood({ ...base, candidates: 1, urgent: 1, flashUntil: NOW + 1, working: true })).toBe('note')
    expect(chispaMood({ ...base, urgent: 1, flashUntil: NOW + 1, working: true })).toBe('worried')
    expect(chispaMood({ ...base, flashUntil: NOW + 1, working: true })).toBe('celebrate')
    expect(chispaMood({ ...base, working: true })).toBe('working')
    expect(chispaMood(base)).toBe('idle')
  })
  test('a flash ends at flashUntil', () => {
    expect(chispaMood({ ...base, flashUntil: NOW })).toBe('idle')
  })
  test('sleeps only after 30 min with nothing to review and nothing urgent, never while working', () => {
    const later = NOW + SLEEP_AFTER_MS
    expect(SLEEP_AFTER_MS).toBe(30 * 60 * 1000)
    expect(chispaMood({ ...base, now: later - 1 })).toBe('idle')
    expect(chispaMood({ ...base, now: later })).toBe('sleeping')
    expect(chispaMood({ ...base, now: later, candidates: 2 })).toBe('note')
    expect(chispaMood({ ...base, now: later, urgent: 1 })).toBe('worried')
    expect(chispaMood({ ...base, now: later, working: true })).toBe('working')
  })
  test('flashes last 4 s', () => {
    expect(FLASH_MS).toBe(4000)
  })
})

describe('bash', () => {
  test('commits and pushes count only when they worked', () => {
    expect(isCommit('git commit -m "x"', false)).toBe(true)
    expect(isCommit('git commit -m "x"', true)).toBe(false)
    expect(isCommit('git status', false)).toBe(false)
    expect(isPush('git push origin main', false)).toBe(true)
    expect(isPush('git push', true)).toBe(false)
    expect(isPush('git pushd', false)).toBe(false)
  })
  test('failure comes from isError or a failed count in the text', () => {
    expect(bashFailed({ isError: true })).toBe(true)
    expect(bashFailed({ text: 'Tests 2 failed' })).toBe(true)
    expect(bashFailed({ text: '0 failed' })).toBe(false)
    expect(bashFailed(undefined)).toBe(false)
  })
})

describe('chispa poses', () => {
  test('note and working are moods with an animated SVG, a label and a face', () => {
    for (const mood of ['note', 'working']) {
      expect(MOODS).toContain(mood)
      const svg = chispaSvg(mood)
      expect(svg).toContain('repeatCount="indefinite"')
      expect(svg.length).toBeLessThan(131072)
      expect(MOOD_LABELS[mood]).toBeTruthy()
      expect(TERMINAL_FACES[mood]).toBeTruthy()
    }
  })
  test('exactly six moods; note holds a card; working types on a keyboard; unknown falls back to idle', () => {
    expect(MOODS).toEqual(['note', 'worried', 'celebrate', 'working', 'idle', 'sleeping'])
    for (const mood of MOODS) {
      expect(chispaSvg(mood)).toContain('repeatCount="indefinite"')
      expect(MOOD_LABELS[mood]).toBeTruthy()
      expect(TERMINAL_FACES[mood]).toBeTruthy()
    }
    expect(chispaSvg('note')).toContain('#FDCBB2')
    expect(chispaSvg('idle')).not.toContain('#FDCBB2')
    expect(chispaSvg('working')).toContain('#4B5058')
    expect(chispaSvg('coding')).toBe(chispaSvg('idle'))
  })
})
