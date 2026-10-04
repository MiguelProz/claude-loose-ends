import { describe, expect, test } from 'claude-code/testing'
import { chispaSvg, MOOD_LABELS, MOODS, TERMINAL_FACES } from '../lib/chispa.mjs'
import { ago, bandLine, progressBar, renderBand, renderPane } from '../lib/view.mjs'

const fake = new Proxy({}, { get: (_, type) => (props: any) => ({ type, props }) }) as any
const flat = (node: any): any[] => [node, ...([] as any[]).concat(node?.props?.children ?? []).flatMap(c => (typeof c === 'object' ? flat(c) : []))]
const noop = () => {}
const actions = { openPane: noop, doNow: noop, queue: noop, done: noop, startDiscard: noop, dismiss: noop, setPriority: noop, reopen: noop, toggleOthers: noop }

describe('chispa', () => {
  test('every mood has an animated SVG, a label and a face', () => {
    for (const mood of MOODS) {
      const svg = chispaSvg(mood)
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg.endsWith('</svg>')).toBe(true)
      expect(svg).toContain('repeatCount="indefinite"')
      expect(svg.length).toBeLessThan(131072)
      expect(MOOD_LABELS[mood]).toBeTruthy()
      expect(TERMINAL_FACES[mood]).toBeTruthy()
    }
  })
  test('unknown mood falls back to idle', () => {
    expect(chispaSvg('nope')).toBe(chispaSvg('idle'))
  })
  test('fail turns the body red', () => {
    expect(chispaSvg('fail')).toContain('#C2413A')
    expect(chispaSvg('idle')).not.toContain('#C2413A')
  })
})

describe('band', () => {
  const model = { mood: 'coding', plan: { done: 4, total: 7 }, counts: { open: 3, high: 1, queued: 2 }, fileError: null }
  test('line', () => {
    expect(bandLine(model)).toBe('◐ plan 4/7 · ⚠ 3 cabos (1 alta) · ⏳ 2 en cola')
    expect(bandLine({ plan: { done: 0, total: 0 }, counts: { open: 1, high: 2, queued: 0 } })).toBe('⚠ 1 cabo (2 altas)')
    expect(bandLine({ plan: { done: 0, total: 0 }, counts: { open: 0, high: 0, queued: 0 } })).toBe('')
  })
  test('desktop draws an interactive Svg, terminal a face', () => {
    const desk = flat(renderBand(fake, 'desktop', model, actions))
    expect(desk.find(n => n.type === 'Svg')?.props.isInteractive).toBe(true)
    const term = flat(renderBand(fake, 'terminal', model, actions))
    expect(term.some(n => n.type === 'Svg')).toBe(false)
    expect(term.find(n => n.type === 'Text')?.props.children).toBe(TERMINAL_FACES.coding)
  })
  test('file error replaces the counters', () => {
    const nodes = flat(renderBand(fake, 'desktop', { ...model, fileError: 'conflict' }, actions))
    expect(nodes.some(n => n.type === 'Text' && String(n.props.children).includes('ilegibles'))).toBe(true)
  })
})

describe('pane', () => {
  const now = Date.parse('2026-10-04T12:00:00.000Z')
  const item = { id: 'a1', text: 'Test de canonical', priority: 'high', status: 'open', branch: 'main', createdAt: '2026-10-04T11:48:00.000Z', evidence: 'lo dejo fuera' }
  const base = { now, branch: 'main', working: false, fileError: null, discarding: null, showOthers: false, plan: { items: [{ id: '1', subject: 'jsonld', status: 'completed' }], done: 1, total: 1 }, loose: [item], others: [], closedToday: [], commits: [{ hash: 'abc1234', subject: 'feat: x' }] }
  test('sections, item buttons and commits', () => {
    const nodes = flat(renderPane(fake, base, actions))
    const keys = nodes.map(n => n.props?.key).filter(Boolean)
    expect(keys).toEqual(expect.arrayContaining(['now-a1', 'queue-a1', 'done-a1', 'dismiss-a1', 'prio-a1']))
    expect(nodes.some(n => n.type === 'Text' && String(n.props.children).includes('hace 12 min'))).toBe(true)
    expect(nodes.some(n => n.type === 'Text' && n.props.children === '✓ abc1234 feat: x')).toBe(true)
  })
  test('discarding shows reason picker and free text', () => {
    const keys = flat(renderPane(fake, { ...base, discarding: 'a1' }, actions)).map(n => n.props?.key)
    expect(keys).toEqual(expect.arrayContaining(['reason-a1', 'reason-text-a1']))
  })
  test('helpers', () => {
    expect(ago('2026-10-04T11:59:40.000Z', now)).toBe('ahora')
    expect(ago('2026-10-04T09:00:00.000Z', now)).toBe('hace 3 h')
    expect(ago('2026-10-02T12:00:00.000Z', now)).toBe('hace 2 d')
    expect(progressBar(1, 2, 10)).toBe('━━━━━░░░░░')
    expect(progressBar(0, 0, 4)).toBe('░░░░')
  })
  test('ago gives nothing for unparseable dates; progressBar stays inside its width', () => {
    expect(ago('ayer', now)).toBe('')
    expect(ago(undefined as any, now)).toBe('')
    expect(progressBar(5, 2, 4)).toBe('━━━━')
    expect(progressBar(-1, 2, 4)).toBe('░░░░')
  })
})
