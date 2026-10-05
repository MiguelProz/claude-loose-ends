import { describe, expect, test } from 'claude-code/testing'
import { bashFailed, classifyBash, FLASH_MS, initialMood, isPush, moodAt, moodReduce, planProgress, planReduce, SLEEP_AFTER_MS } from '../lib/activity.mjs'

describe('plan', () => {
  test('create, update, delete', () => {
    let plan = planReduce([], { kind: 'create', id: '1', subject: 'jsonld' })
    plan = planReduce(plan, { kind: 'create', id: '2', subject: 'tests' })
    plan = planReduce(plan, { kind: 'update', id: '1', status: 'completed' })
    plan = planReduce(plan, { kind: 'update', id: '2', status: 'deleted' })
    expect(plan[0]).toEqual({ id: '1', subject: 'jsonld', status: 'completed' })
    expect(planProgress(plan)).toEqual({ done: 1, total: 1 })
  })
  test('creating an existing id keeps its place and status', () => {
    let plan = planReduce([], { kind: 'create', id: '1', subject: 'jsonld' })
    plan = planReduce(plan, { kind: 'create', id: '2', subject: 'tests' })
    plan = planReduce(plan, { kind: 'update', id: '1', status: 'in_progress' })
    plan = planReduce(plan, { kind: 'create', id: '1', subject: 'jsonld v2' })
    expect(plan).toEqual([{ id: '1', subject: 'jsonld v2', status: 'in_progress' }, { id: '2', subject: 'tests', status: 'pending' }])
  })
  test('TodoWrite replaces the plan', () => {
    const plan = planReduce([{ id: 'x', subject: 'old', status: 'pending' }], { kind: 'todos', todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }] })
    expect(plan.map(t => t.subject)).toEqual(['a', 'b'])
    expect(planProgress(plan)).toEqual({ done: 1, total: 2 })
  })
})

describe('mood', () => {
  const t0 = 1_000_000
  test('turn flow: thinking, coding, talking flash, idle', () => {
    let s = initialMood(t0)
    s = moodReduce(s, { type: 'turn.start' }, t0)
    expect(moodAt(s, t0)).toBe('thinking')
    s = moodReduce(s, { type: 'tool', tool: 'Edit' }, t0 + 1)
    expect(moodAt(s, t0 + 1)).toBe('coding')
    s = moodReduce(s, { type: 'tool', tool: 'Read' }, t0 + 2)
    expect(moodAt(s, t0 + 2)).toBe('thinking')
    s = moodReduce(s, { type: 'turn.end' }, t0 + 3)
    expect(moodAt(s, t0 + 3)).toBe('talking')
    expect(moodAt(s, t0 + 3 + FLASH_MS)).toBe('idle')
  })
  test('flashes win while they last', () => {
    let s = moodReduce(initialMood(t0), { type: 'test-fail' }, t0)
    expect(moodAt(s, t0 + 10)).toBe('fail')
    s = moodReduce(s, { type: 'commit' }, t0 + 20)
    expect(moodAt(s, t0 + 30)).toBe('celebrate')
    s = moodReduce(s, { type: 'worry' }, t0 + 40)
    expect(moodAt(s, t0 + 50)).toBe('worried')
  })
  test('turn end keeps a live non-talking flash', () => {
    let s = moodReduce(initialMood(t0), { type: 'commit' }, t0)
    s = moodReduce(s, { type: 'turn.end' }, t0 + 10)
    expect(moodAt(s, t0 + 20)).toBe('celebrate')
    expect(s.working).toBe(false)
    expect(moodAt(s, t0 + FLASH_MS + 1)).toBe('idle')
  })
  test('sleeps when idle long enough, never while working', () => {
    const idle = initialMood(t0)
    expect(moodAt(idle, t0 + SLEEP_AFTER_MS)).toBe('sleeping')
    const busy = moodReduce(idle, { type: 'turn.start' }, t0)
    expect(moodAt(busy, t0 + SLEEP_AFTER_MS * 2)).toBe('thinking')
  })
})

describe('bash', () => {
  test('classifies commits and failing tests', () => {
    expect(classifyBash('git add . && git commit -m "x"', false)).toBe('commit')
    expect(classifyBash('git commit -m x', true)).toBe(null)
    expect(classifyBash('npm test', true)).toBe('test-fail')
    expect(classifyBash('npx vitest run src/a.test.ts', true)).toBe('test-fail')
    expect(classifyBash('npm run test -- foo', false)).toBe(null)
    expect(classifyBash('ls', true)).toBe(null)
  })
  test('a successful git push is recognized, a failed one is not', () => {
    expect(classifyBash('git push origin main', false)).toBe('push')
    expect(classifyBash('git push', true)).toBe(null)
    expect(classifyBash('git pushd', false)).toBe(null)
  })
  test('isPush sees a successful git push anywhere in the command, a failed one or a lookalike not', () => {
    expect(isPush('git push origin main', false)).toBe(true)
    expect(isPush('git add . && git commit -m x && git push', false)).toBe(true)
    expect(isPush('git add . && git commit -m x && git push', true)).toBe(false)
    expect(isPush('git commit -m x', false)).toBe(false)
    expect(isPush('git pushd', false)).toBe(false)
  })
  test('vitest only counts as a command, not as a word in a path', () => {
    expect(classifyBash('cat vitest.config.ts', true)).toBe(null)
    expect(classifyBash('grep -r vitest package.json', true)).toBe(null)
    expect(classifyBash('vitest run', true)).toBe('test-fail')
    expect(classifyBash('cd app && vitest', true)).toBe('test-fail')
    expect(classifyBash('lint; vitest run', true)).toBe('test-fail')
    expect(classifyBash('lint || pnpm vitest', true)).toBe('test-fail')
    expect(classifyBash('yarn vitest run', true)).toBe('test-fail')
    expect(classifyBash('bunx vitest', true)).toBe('test-fail')
    expect(classifyBash('npm run test', true)).toBe('test-fail')
  })
  test('detects failure from the result', () => {
    expect(bashFailed({ isError: true })).toBe(true)
    expect(bashFailed({ text: ' Tests  2 failed | 40 passed' })).toBe(true)
    expect(bashFailed({ text: 'all good' })).toBe(false)
    expect(bashFailed({ text: 'Tests  0 failed | 40 passed' })).toBe(false)
    expect(bashFailed(undefined)).toBe(false)
  })
})
