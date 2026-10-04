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
    const named = flat(renderBand(fake, 'desktop', { ...model, fileError: 'conflict', filePath: '/p/.claude/loose-ends.json' }, actions))
    expect(named.some(n => n.type === 'Text' && String(n.props.children).includes('revisa /p/.claude/loose-ends.json'))).toBe(true)
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
  const texts = (nodes: any[]) => nodes.filter(n => n.type === 'Text').map(n => String(n.props.children))
  test('a file error shows a banner in the pane', () => {
    expect(texts(flat(renderPane(fake, { ...base, fileError: 'json' }, actions))).some(t => t.includes('No puedo leer') && t.includes('(json)'))).toBe(true)
    expect(texts(flat(renderPane(fake, base, actions))).some(t => t.includes('No puedo leer'))).toBe(false)
    expect(texts(flat(renderPane(fake, { ...base, fileError: 'json', filePath: '/p/.claude/loose-ends.json' }, actions))).some(t => t.includes('No puedo leer /p/.claude/loose-ends.json (json)'))).toBe(true)
  })
  test('other branches sit behind a toggle', () => {
    const other = { ...item, id: 'b2', text: 'Otra rama', branch: 'feat/x' }
    const closed = flat(renderPane(fake, { ...base, others: [other] }, actions))
    const toggle = closed.find(n => n.props?.key === 'toggle-others')
    expect(toggle.props.label).toBe('▸ Otras ramas (1)')
    expect(texts(closed).some(t => t.includes('Otra rama'))).toBe(false)
    const open = flat(renderPane(fake, { ...base, others: [other], showOthers: true }, actions))
    expect(open.find(n => n.props?.key === 'toggle-others').props.label).toBe('▾ Otras ramas (1)')
    expect(texts(open)).toContain('● Otra rama  [feat/x]')
    expect(flat(renderPane(fake, base, actions)).some(n => n.props?.key === 'toggle-others')).toBe(false)
  })
  test('closed today: Haiku label, dismissed strikethrough, reopen key', () => {
    const swept = { id: 'c1', text: 'Cerrado por barrido', status: 'done', closedBy: 'sweep', closedAt: '2026-10-04T11:00:00.000Z' }
    const dropped = { id: 'd1', text: 'Descartado', status: 'dismissed', closedBy: 'user', reason: 'no aplica', closedAt: '2026-10-04T11:30:00.000Z' }
    const nodes = flat(renderPane(fake, { ...base, commits: [], closedToday: [swept, dropped] }, actions))
    expect(nodes.find(n => n.props?.children === '✓ cabo: Cerrado por barrido (Haiku)')?.props).toMatchObject({ dimColor: false, strikethrough: false })
    expect(nodes.find(n => n.props?.children === '✓ cabo: Descartado — no aplica')?.props).toMatchObject({ dimColor: true, strikethrough: true })
    expect(nodes.map(n => n.props?.key)).toEqual(expect.arrayContaining(['reopen-c1', 'reopen-d1']))
    expect(texts(nodes)).toContain('HECHO HOY  2')
  })
  test('empty plan and empty branch say so', () => {
    const t = texts(flat(renderPane(fake, { ...base, plan: { items: [], done: 0, total: 0 }, loose: [] }, actions)))
    expect(t).toContain('Sin plan en esta sesión.')
    expect(t).toContain('Nada colgando en esta rama.')
    expect(texts(flat(renderPane(fake, base, actions)))).not.toContain('Nada colgando en esta rama.')
  })
  test('Hazlo ahora is dimmed only while Claude works', () => {
    const now_ = (m: any) => flat(renderPane(fake, m, actions)).find(n => n.props?.key === 'now-a1').props
    expect(now_({ ...base, working: true }).dimColor).toBe(true)
    expect(now_(base).dimColor).toBe(false)
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
