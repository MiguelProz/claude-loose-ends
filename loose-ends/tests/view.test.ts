import { describe, expect, test } from 'claude-code/testing'
import { chispaSvg, MOOD_LABELS, MOODS, TERMINAL_FACES } from '../lib/chispa.mjs'
import { ago, bandLine, renderBand, renderPane } from '../lib/view.mjs'

const fake = new Proxy({}, { get: (_, type) => (props: any) => ({ type, props }) }) as any
const flat = (node: any): any[] => [node, ...([] as any[]).concat(node?.props?.children ?? []).flatMap(c => (typeof c === 'object' ? flat(c) : []))]
const noop = () => {}
const actions = { openPane: noop, doNow: noop, queue: noop, done: noop, startDiscard: noop, dismiss: noop, setPriority: noop, reopen: noop, toggleOthers: noop, toggleMore: noop, toggleDone: noop }

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
  const model = { mood: 'coding', plan: { done: 4, total: 7 }, counts: { open: 3, high: 1, queued: 0 }, fileError: null }
  const empty = { mood: 'idle', plan: { done: 0, total: 0 }, counts: { open: 0, high: 0, queued: 0 }, fileError: null }
  test('line', () => {
    expect(bandLine(model)).toBe('3 pendientes (1 urgente) · plan 4/7')
    expect(bandLine({ plan: { done: 0, total: 0 }, counts: { open: 1, high: 0, queued: 0 } })).toBe('1 pendiente')
    expect(bandLine({ plan: { done: 0, total: 0 }, counts: { open: 2, high: 0, queued: 1 } })).toBe('2 pendientes · 1 en cola')
    expect(bandLine({ plan: { done: 0, total: 0 }, counts: { open: 4, high: 2, queued: 3 } })).toBe('4 pendientes (2 urgentes) · 3 en cola')
    expect(bandLine({ plan: { done: 1, total: 3 }, counts: { open: 0, high: 0, queued: 0 } })).toBe('plan 1/3')
    expect(bandLine({ plan: { done: 0, total: 0 }, counts: { open: 0, high: 0, queued: 0 } })).toBe('')
  })
  test('the line carries no glyphs', () => {
    expect(bandLine({ plan: { done: 4, total: 7 }, counts: { open: 3, high: 1, queued: 2 } })).not.toMatch(/[◐⚠⏳]/)
  })
  test('one centered row: Chispa, one dim summary, a plain dim Ver button', () => {
    const root = renderBand(fake, 'desktop', model, actions) as any
    expect(root.type).toBe('Box')
    expect(root.props).toMatchObject({ flexDirection: 'row', alignItems: 'center', gap: 1 })
    expect(root.props.children.map((n: any) => n.type)).toEqual(['Svg', 'Text', 'Button'])
    expect(root.props.children[1].props).toMatchObject({ dimColor: true, children: '3 pendientes (1 urgente) · plan 4/7' })
    expect(root.props.children[2].props).toMatchObject({ key: 'open-pane', label: 'Ver', plain: true, dimColor: true })
  })
  test('desktop draws an interactive 28x24 Svg, terminal a dim face', () => {
    const desk = flat(renderBand(fake, 'desktop', model, actions))
    expect(desk.find(n => n.type === 'Svg')?.props).toMatchObject({ isInteractive: true, width: 28, height: 24 })
    const term = flat(renderBand(fake, 'terminal', model, actions))
    expect(term.some(n => n.type === 'Svg')).toBe(false)
    const face = term.find(n => n.type === 'Text')
    expect(face?.props.children).toBe(TERMINAL_FACES.coding)
    expect(face?.props.dimColor).toBe(true)
  })
  test('with nothing to say the band is only Chispa', () => {
    for (const surface of ['desktop', 'terminal']) {
      const root = renderBand(fake, surface, empty, actions) as any
      expect(root.props.children).toHaveLength(1)
      expect(flat(root).some(n => n.type === 'Button')).toBe(false)
    }
    expect(flat(renderBand(fake, 'desktop', empty, actions)).some(n => n.type === 'Text')).toBe(false)
  })
  test('file error is one dim warning line plus Ver; the detail lives in the pane', () => {
    const root = renderBand(fake, 'desktop', { ...model, fileError: 'conflict', filePath: '/p/.claude/loose-ends.json' }, actions) as any
    expect(root.props.children.map((n: any) => n.type)).toEqual(['Svg', 'Text', 'Button'])
    expect(root.props.children[1].props).toMatchObject({ color: 'warning', dimColor: true, children: 'No puedo leer loose-ends.json' })
    expect(root.props.children[2].props.key).toBe('open-pane')
  })
})

describe('pane', () => {
  const now = Date.parse('2026-10-04T12:00:00.000Z')
  const item = { id: 'a1', text: 'Test de canonical', priority: 'high', status: 'open', branch: 'main', createdAt: '2026-10-04T11:48:00.000Z', evidence: 'lo dejo fuera' }
  const base = { now, branch: 'main', working: false, fileError: null, discarding: null, showOthers: false, showDone: false, expanded: null, plan: { items: [{ id: '1', subject: 'jsonld', status: 'completed' }, { id: '2', subject: 'sitemap', status: 'pending' }], done: 1, total: 2 }, loose: [item], others: [], closedToday: [], commits: [{ hash: 'abc1234', subject: 'feat: x' }] }
  const texts = (nodes: any[]) => nodes.filter(n => n.type === 'Text').map(n => String(n.props.children))
  const keysOf = (nodes: any[]) => nodes.map(n => n.props?.key).filter(Boolean)
  const pane = (over: any = {}, acts: any = actions) => flat(renderPane(fake, { ...base, ...over }, acts))
  test('item: priority dot and text, quiet meta, three buttons, no Select', () => {
    const nodes = pane()
    expect(nodes.some(n => n.type === 'Select')).toBe(false)
    const dot = nodes.find(n => n.type === 'Text' && n.props.children === '●')
    expect(dot.props.color).toBe('error')
    expect(texts(nodes)).toContain('Test de canonical')
    expect(texts(nodes).some(t => /ALTA|MEDIA|BAJA/.test(t))).toBe(false)
    expect(texts(nodes)).toContain('hace 12 min')
    expect(texts(nodes).some(t => t.includes('lo dejo fuera'))).toBe(false)
    expect(nodes.find(n => n.props?.key === 'now-a1').props).toMatchObject({ label: 'Hacer', variant: 'primary', dimColor: false })
    expect(nodes.find(n => n.props?.key === 'done-a1').props.label).toBe('Hecho')
    expect(nodes.find(n => n.props?.key === 'more-a1').props).toMatchObject({ label: '···', plain: true })
    expect(keysOf(nodes)).not.toEqual(expect.arrayContaining(['queue-a1']))
    expect(keysOf(nodes)).not.toEqual(expect.arrayContaining(['dismiss-a1']))
  })
  test('the dot color follows the priority: error, warning, dim', () => {
    const dotOf = (priority: string) => pane({ loose: [{ ...item, priority }] }).find(n => n.type === 'Text' && n.props.children === '●').props
    expect(dotOf('medium').color).toBe('warning')
    expect(dotOf('low').color).toBeUndefined()
    expect(dotOf('low').dimColor).toBe(true)
  })
  test('queued items say so in the meta line', () => {
    expect(texts(pane({ loose: [{ ...item, status: 'queued' }] }))).toContain('hace 12 min · en cola')
  })
  test('more-<id> expands: evidence, Cola, Descartar and the three priorities', () => {
    const nodes = pane({ expanded: 'a1' })
    expect(keysOf(nodes)).toEqual(expect.arrayContaining(['queue-a1', 'dismiss-a1', 'prio-a1-high', 'prio-a1-medium', 'prio-a1-low']))
    const ev = nodes.find(n => n.type === 'Text' && n.props.children === '«lo dejo fuera»')
    expect(ev.props).toMatchObject({ dimColor: true, italic: true })
    expect(nodes.find(n => n.props?.key === 'prio-a1-high').props.label).toBe('Urgente')
    expect(nodes.find(n => n.props?.key === 'prio-a1-medium').props.label).toBe('Normal')
    expect(nodes.find(n => n.props?.key === 'prio-a1-low').props.label).toBe('Baja')
    expect(nodes.some(n => n.type === 'Select')).toBe(false)
  })
  test('only the expanded item opens; an item without evidence shows no quote', () => {
    const other = { ...item, id: 'b2', text: 'Otro', evidence: undefined }
    const nodes = pane({ loose: [item, other], expanded: 'b2' })
    expect(keysOf(nodes)).toContain('queue-b2')
    expect(keysOf(nodes)).not.toContain('queue-a1')
    expect(texts(nodes).some(t => t.startsWith('«'))).toBe(false)
  })
  test('the current priority is dim, the others are not', () => {
    const dims = (priority: string) => Object.fromEntries(['high', 'medium', 'low'].map(p => [p, pane({ expanded: 'a1', loose: [{ ...item, priority }] }).find(n => n.props?.key === `prio-a1-${p}`).props.dimColor]))
    expect(dims('high')).toEqual({ high: true, medium: false, low: false })
    expect(dims('low')).toEqual({ high: false, medium: false, low: true })
  })
  test('buttons call their actions', () => {
    const calls: string[] = []
    const spy = { ...actions, doNow: (id: string) => calls.push(`now ${id}`), done: (id: string) => calls.push(`done ${id}`), toggleMore: (id: string) => calls.push(`more ${id}`), queue: (id: string) => calls.push(`queue ${id}`), startDiscard: (id: string) => calls.push(`discard ${id}`), setPriority: (id: string, p: string) => calls.push(`prio ${id} ${p}`) }
    const nodes = pane({ expanded: 'a1' }, spy)
    for (const key of ['now-a1', 'done-a1', 'more-a1', 'queue-a1', 'dismiss-a1', 'prio-a1-low']) nodes.find(n => n.props?.key === key).props.onPress()
    expect(calls).toEqual(['now a1', 'done a1', 'more a1', 'queue a1', 'discard a1', 'prio a1 low'])
  })
  test('sections: sentence-case bold title and a dim count, no caps or bars', () => {
    const nodes = pane()
    const t = texts(nodes)
    expect(nodes.find(n => n.type === 'Text' && n.props.children === 'Pendientes').props.bold).toBe(true)
    expect(nodes.find(n => n.type === 'Text' && n.props.children === '1').props.dimColor).toBe(true)
    expect(nodes.find(n => n.type === 'Text' && n.props.children === 'Plan').props.bold).toBe(true)
    expect(t).toContain('1 de 2')
    expect(t.some(x => /[━░]/.test(x))).toBe(false)
    expect(t.some(x => x.length > 3 && x === x.toUpperCase() && /[A-Z]/.test(x))).toBe(false)
  })
  test('plan tasks are listed; the Plan section is absent when there are none', () => {
    expect(texts(pane())).toEqual(expect.arrayContaining(['✓ jsonld', '· sitemap']))
    const none = pane({ plan: { items: [], done: 0, total: 0 } })
    expect(texts(none)).not.toContain('Plan')
    expect(texts(none).some(t => t.includes('Sin plan'))).toBe(false)
    const gone = pane({ plan: { items: [{ id: '1', subject: 'x', status: 'deleted' }], done: 0, total: 0 } })
    expect(texts(gone)).not.toContain('Plan')
  })
  test('a file error shows a banner in the pane', () => {
    expect(texts(pane({ fileError: 'json' })).some(t => t.includes('No puedo leer') && t.includes('(json)'))).toBe(true)
    expect(texts(pane()).some(t => t.includes('No puedo leer'))).toBe(false)
    expect(texts(pane({ fileError: 'json', filePath: '/p/.claude/loose-ends.json' })).some(t => t.includes('No puedo leer /p/.claude/loose-ends.json (json)'))).toBe(true)
  })
  test('other branches sit behind a toggle', () => {
    const other = { ...item, id: 'b2', text: 'Otra rama', branch: 'feat/x' }
    const closed = pane({ others: [other] })
    expect(closed.find(n => n.props?.key === 'toggle-others').props.label).toBe('▸ Otras ramas  1')
    expect(texts(closed).some(t => t.includes('Otra rama'))).toBe(false)
    const open = pane({ others: [other], showOthers: true })
    expect(open.find(n => n.props?.key === 'toggle-others').props.label).toBe('▾ Otras ramas  1')
    expect(texts(open)).toContain('● Otra rama  [feat/x]')
    expect(pane().some(n => n.props?.key === 'toggle-others')).toBe(false)
  })
  test('Hecho hoy is collapsed behind toggle-done until opened', () => {
    const swept = { id: 'c1', text: 'Cerrado por barrido', status: 'done', closedBy: 'sweep', closedAt: '2026-10-04T11:00:00.000Z' }
    const closed = pane({ closedToday: [swept] })
    expect(closed.find(n => n.props?.key === 'toggle-done').props).toMatchObject({ label: '▸ Hecho hoy  2', plain: true })
    expect(texts(closed).some(t => t.includes('abc1234'))).toBe(false)
    expect(keysOf(closed)).not.toContain('reopen-c1')
    const open = pane({ closedToday: [swept], showDone: true })
    expect(open.find(n => n.props?.key === 'toggle-done').props.label).toBe('▾ Hecho hoy  2')
    expect(texts(open)).toContain('✓ abc1234 feat: x')
    expect(keysOf(open)).toContain('reopen-c1')
  })
  test('toggle-done calls toggleDone; nothing closed today, no section', () => {
    let n = 0
    pane({}, { ...actions, toggleDone: () => n++ }).find(x => x.props?.key === 'toggle-done').props.onPress()
    expect(n).toBe(1)
    expect(keysOf(pane({ commits: [], closedToday: [] }))).not.toContain('toggle-done')
  })
  test('closed today: Haiku label, dismissed strikethrough, reopen key', () => {
    const swept = { id: 'c1', text: 'Cerrado por barrido', status: 'done', closedBy: 'sweep', closedAt: '2026-10-04T11:00:00.000Z' }
    const dropped = { id: 'd1', text: 'Descartado', status: 'dismissed', closedBy: 'user', reason: 'no aplica', closedAt: '2026-10-04T11:30:00.000Z' }
    const nodes = pane({ commits: [], closedToday: [swept, dropped], showDone: true })
    expect(nodes.find(n => n.props?.children === '✓ cabo: Cerrado por barrido (Haiku)')?.props).toMatchObject({ dimColor: false, strikethrough: false })
    expect(nodes.find(n => n.props?.children === '✓ cabo: Descartado — no aplica')?.props).toMatchObject({ dimColor: true, strikethrough: true })
    expect(keysOf(nodes)).toEqual(expect.arrayContaining(['reopen-c1', 'reopen-d1']))
    expect(nodes.find(n => n.props?.key === 'toggle-done').props.label).toBe('▾ Hecho hoy  2')
  })
  test('an empty repo says so in one dim line', () => {
    const t = pane({ loose: [] })
    const line = t.find(n => n.type === 'Text' && n.props.children === 'Nada pendiente en este repo.')
    expect(line.props.dimColor).toBe(true)
    expect(texts(pane())).not.toContain('Nada pendiente en este repo.')
  })
  test('outside git the pane shows the plan and one short line, no lists', () => {
    const t = texts(pane({ noRepo: true }))
    expect(t).toContain('Esta sesión no está dentro de un repo git.')
    expect(t).not.toContain('Pendientes')
  })
  test('Hacer is dimmed only while Claude works', () => {
    const now_ = (m: any) => pane(m).find(n => n.props?.key === 'now-a1').props
    expect(now_({ working: true }).dimColor).toBe(true)
    expect(now_({}).dimColor).toBe(false)
  })
  test('discarding shows reason picker and free text', () => {
    const keys = keysOf(pane({ discarding: 'a1', expanded: 'a1' }))
    expect(keys).toEqual(expect.arrayContaining(['reason-a1', 'reason-text-a1']))
  })
  test('ago', () => {
    expect(ago('2026-10-04T11:59:40.000Z', now)).toBe('ahora')
    expect(ago('2026-10-04T09:00:00.000Z', now)).toBe('hace 3 h')
    expect(ago('2026-10-02T12:00:00.000Z', now)).toBe('hace 2 d')
  })
  test('ago gives nothing for unparseable dates, and the meta line is then left out', () => {
    expect(ago('ayer', now)).toBe('')
    expect(ago(undefined as any, now)).toBe('')
    expect(texts(pane({ loose: [{ ...item, createdAt: 'ayer' }] })).some(t => t.includes('hace'))).toBe(false)
  })
})
