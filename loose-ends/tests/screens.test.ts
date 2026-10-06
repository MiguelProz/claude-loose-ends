import { describe, expect, test } from 'claude-code/testing'
import { OPEN_PANE_HREF, UNDO_HREF, ago, bandLine, clip, emphasize, recapText, renderBand, renderPane, renderTriage, sinceText } from '../lib/screens.mjs'

const fake = new Proxy({}, { get: (_, type) => (props: any) => ({ type, props }) }) as any
const flat = (node: any): any[] => [node, ...([] as any[]).concat(node?.props?.children ?? []).flatMap(c => (typeof c === 'object' ? flat(c) : []))]
const byKey = (node: any, key: string) => flat(node).find(n => n?.props?.key === key)
const texts = (node: any) => flat(node).filter(n => n?.type === 'Text').map(n => String(n.props.children))
const noop = () => {}
const counts = (over = {}) => ({ candidates: 0, live: 0, high: 0, ...over })
const band = (over = {}) => ({ mood: 'idle', counts: counts(), urgent: null, justClosed: null, recap: null, fileError: null, ...over })
const item = (over = {}) => ({ id: 'c1', text: 'Corregir los revalidatePath del grupo (app)', category: 'deuda', priority: 'medium', status: 'candidate', evidence: 'unos 41 revalidatePath ya no coinciden', createdAt: '2026-10-04T09:00:00.000Z', ...over })

describe('band line', () => {
  test('the first that applies: unreadable, to review, urgent, just closed, since last time, open, nothing', () => {
    expect(bandLine(band({ fileError: 'json', counts: counts({ candidates: 2 }) }))).toEqual({ text: 'No puedo leer los cabos', strong: 'No puedo leer los cabos', action: 'open', label: 'Ver', warning: true })
    expect(bandLine(band({ counts: counts({ candidates: 2, live: 1, high: 1 }), urgent: item() }))).toEqual({ text: '2 por revisar · 1 abierto', strong: '2 por revisar', action: 'open', label: 'Revisar' })
    expect(bandLine(band({ counts: counts({ candidates: 1 }) }))?.text).toBe('1 por revisar')
    expect(bandLine(band({ counts: counts({ live: 3, high: 1 }), urgent: item({ text: 'Arreglar el login' }), justClosed: { text: 'x' } }))).toEqual({ text: 'Urgente: Arreglar el login', strong: 'Arreglar el login', action: 'open', label: 'Ver' })
    expect(bandLine(band({ counts: counts({ live: 3 }), justClosed: { text: 'Envío duplicado' } }))).toEqual({ text: 'Cerrado: Envío duplicado', strong: 'Envío duplicado', action: 'undo', label: 'Deshacer' })
    expect(bandLine(band({ counts: counts({ live: 3 }), recap: { since: 'ayer', fresh: 2, closed: 1 } }))).toEqual({ text: 'Desde ayer: 2 nuevos · 1 cerrado en otra sesión', strong: '', action: 'open', label: 'Ver' })
    expect(bandLine(band({ counts: counts({ live: 3 }), recap: { since: 'ayer', fresh: 0, closed: 0 } }))?.text).toBe('3 abiertos')
    expect(bandLine(band({ counts: counts({ live: 1 }) }))).toEqual({ text: '1 abierto', strong: '', action: 'open', label: 'Ver' })
    expect(bandLine(band())).toBe(null)
  })
  test('long texts are clipped to 60 characters with an ellipsis', () => {
    expect(clip('x'.repeat(60))).toBe('x'.repeat(60))
    expect(clip('x'.repeat(61))).toBe(`${'x'.repeat(59)}…`)
  })
  test('recap leaves out what is zero', () => {
    expect(recapText({ since: 'ayer', fresh: 1, closed: 0 })).toBe('Desde ayer: 1 nuevo')
    expect(recapText({ since: 'el 03/10', fresh: 0, closed: 2 })).toBe('Desde el 03/10: 2 cerrados en otra sesión')
  })
})

describe('band', () => {
  const lineTexts = (root: any) => flat(root).filter(n => n?.type === 'Text').map(n => ({ text: n.props.children, dim: Boolean(n.props.dimColor), color: n.props.color }))
  test('desktop: a card with Chispa, the key part of the line bright, the rest dim, and the action as a link at the end', () => {
    const opened: string[] = []
    const root = renderBand(fake, 'desktop', band({ mood: 'note', counts: counts({ candidates: 2, live: 1 }) }), { openPane: () => opened.push('open'), undoClose: noop })
    expect(root.props).toMatchObject({ flexDirection: 'row', alignItems: 'center', borderStyle: 'round', borderColor: 'promptBorder', paddingX: 1 })
    expect(root.props.children[0]).toMatchObject({ type: 'Svg', props: { alt: 'Chispa con una nota: hay cabos por revisar', width: 36, height: 30 } })
    expect(lineTexts(root)).toEqual([{ text: '2 por revisar', dim: false, color: undefined }, { text: '· 1 abierto', dim: true, color: undefined }])
    const link = byKey(root, 'band-line')
    expect(root.props.children.at(-1)).toBe(link)
    expect(link.props).toMatchObject({ text: `[Revisar](${OPEN_PANE_HREF})`, pressableLinks: [OPEN_PANE_HREF] })
    expect(link.props.dimColor).toBeUndefined()
    expect(root.props.children.at(-2).props.flexGrow).toBe(1)
    link.props.onLinkPress()
    expect(opened).toEqual(['open'])
  })
  test('desktop: just closed shows the label dim and the text bright, and its link undoes', () => {
    const undone: string[] = []
    const root = renderBand(fake, 'desktop', band({ mood: 'celebrate', counts: counts({ live: 1 }), justClosed: { text: 'Envío duplicado' } }), { openPane: noop, undoClose: () => undone.push('undo') })
    expect(lineTexts(root)).toEqual([{ text: 'Cerrado:', dim: true, color: undefined }, { text: 'Envío duplicado', dim: false, color: undefined }])
    const link = byKey(root, 'band-line')
    expect(link.props.text).toBe(`[Deshacer](${UNDO_HREF})`)
    link.props.onLinkPress()
    expect(undone).toEqual(['undo'])
  })
  test('desktop: an item text is drawn as plain text, never as Markdown, so it cannot draw a link', () => {
    const urgent = item({ text: '[Pulsa](https://x.y) *ya*' })
    const desk = renderBand(fake, 'desktop', band({ mood: 'worried', counts: counts({ live: 1, high: 1 }), urgent }), { openPane: noop, undoClose: noop })
    expect(lineTexts(desk)).toEqual([{ text: 'Urgente:', dim: true, color: undefined }, { text: '[Pulsa](https://x.y) *ya*', dim: false, color: undefined }])
    expect(flat(desk).filter(n => n?.type === 'Markdown').map(n => n.props.text)).toEqual([`[Ver](${OPEN_PANE_HREF})`])
    const term = renderBand(fake, 'terminal', band({ mood: 'worried', counts: counts({ live: 1, high: 1 }), urgent }), { openPane: noop, undoClose: noop })
    expect(texts(term)[1]).toBe('Urgente: [Pulsa](https://x.y) *ya*')
  })
  test('desktop: an unreadable ref is the warning color; the open count alone is all dim', () => {
    expect(lineTexts(renderBand(fake, 'desktop', band({ fileError: 'json' }), { openPane: noop, undoClose: noop }))).toEqual([{ text: 'No puedo leer los cabos', dim: false, color: 'warning' }])
    expect(lineTexts(renderBand(fake, 'desktop', band({ counts: counts({ live: 3 }) }), { openPane: noop, undoClose: noop }))).toEqual([{ text: '3 abiertos', dim: true, color: undefined }])
  })
  test('terminal: a dim face, the dim line and a plain button', () => {
    const root = renderBand(fake, 'terminal', band({ mood: 'worried', counts: counts({ live: 1, high: 1 }), urgent: item({ text: 'Arreglar el login' }) }), { openPane: noop, undoClose: noop })
    expect(texts(root)).toEqual(['(•_•)!', 'Urgente: Arreglar el login'])
    expect(byKey(root, 'open-pane').props).toMatchObject({ label: 'Ver', plain: true, dimColor: true })
    expect(flat(root).some(n => n?.type === 'Svg')).toBe(false)
    expect(root.props.borderStyle).toBeUndefined()
  })
  test('terminal: an unreadable ref is a warning; just closed is undo-close', () => {
    const warn = renderBand(fake, 'terminal', band({ fileError: 'json' }), { openPane: noop, undoClose: noop })
    expect(flat(warn).find(n => n?.props?.color === 'warning')?.props.children).toBe('No puedo leer los cabos')
    const closed = renderBand(fake, 'terminal', band({ counts: counts({ live: 1 }), justClosed: { text: 'Hecho' } }), { openPane: noop, undoClose: noop })
    expect(byKey(closed, 'undo-close')?.props.label).toBe('Deshacer')
  })
  test('with nothing to say the band is only Chispa, without a card', () => {
    const root = renderBand(fake, 'desktop', band(), { openPane: noop, undoClose: noop })
    expect(root.props.children).toHaveLength(1)
    expect(root.props.borderStyle).toBeUndefined()
  })
})

describe('triage card', () => {
  const calls: string[] = []
  const actions = {
    save: (id: string) => calls.push(`save ${id}`),
    reject: (id: string) => calls.push(`reject ${id}`),
    confirm: (id: string) => calls.push(`confirm ${id}`),
    keep: (id: string) => calls.push(`keep ${id}`),
    undo: (id: string) => calls.push(`undo ${id}`),
    startEdit: (id: string) => calls.push(`edit ${id}`),
    saveEdited: (id: string, text: string) => calls.push(`saveEdited ${id} ${text}`),
  }
  const card = (over = {}) => ({ kind: 'candidate', item: item(), quote: item().evidence, state: null, repoName: 'web-app', editing: false, ...over })
  test('emphasize bolds the first verbatim occurrence and leaves the rest alone', () => {
    expect(emphasize('a b c b', 'b')).toBe('a **b** c b')
    expect(emphasize('sin cita', 'otra')).toBe('sin cita')
    expect(emphasize('texto', '')).toBe('texto')
  })
  test('a candidate: header with category and priority, the text, Guardar, No es un cabo, Editar', () => {
    calls.length = 0
    const root = renderTriage(fake, 'desktop', card(), actions)
    expect(root.props.key).toBe('triage-c1')
    expect(texts(root)).toEqual(['Cabo candidato · deuda · normal', 'Corregir los revalidatePath del grupo (app)'])
    expect(byKey(root, 'tri-save-c1').props).toMatchObject({ label: 'Guardar', variant: 'primary' })
    byKey(root, 'tri-save-c1').props.onPress()
    byKey(root, 'tri-reject-c1').props.onPress()
    byKey(root, 'tri-edit-c1').props.onPress()
    expect(calls).toEqual(['save c1', 'reject c1', 'edit c1'])
  })
  test('on mobile there is no Editar; editing shows an Input with the text', () => {
    expect(byKey(renderTriage(fake, 'mobile', card(), actions), 'tri-edit-c1')).toBeUndefined()
    calls.length = 0
    const editing = renderTriage(fake, 'desktop', card({ editing: true }), actions)
    const input = byKey(editing, 'tri-edit-input-c1')
    expect(input.props.value).toBe('Corregir los revalidatePath del grupo (app)')
    expect(byKey(editing, 'tri-save-c1')).toBeUndefined()
    input.props.onSubmit('Texto corregido')
    expect(calls).toEqual(['saveEdited c1 Texto corregido'])
  })
  test('a proposal: ¿Resuelto? with the commit, the text, the proof and its two buttons', () => {
    calls.length = 0
    const proposed = item({ status: 'open', proposal: { quote: 'ya no llama dos veces', commit: 'a3f9c21', at: '2026-10-04T10:00:00.000Z' } })
    const root = renderTriage(fake, 'desktop', card({ kind: 'proposal', item: proposed, quote: 'ya no llama dos veces' }), actions)
    expect(texts(root)).toEqual(['¿Resuelto? · commit a3f9c21', 'Corregir los revalidatePath del grupo (app)', 'Prueba: «ya no llama dos veces»'])
    byKey(root, 'tri-confirm-c1').props.onPress()
    byKey(root, 'tri-keep-c1').props.onPress()
    expect(calls).toEqual(['confirm c1', 'keep c1'])
  })
  test('a card like the one in the pane: the candidate with the accent border, the proposal with the success one; rows wrap without holes; an answer has no border', () => {
    const wrapRows = (root: any) => flat(root).filter(n => n?.type === 'Box' && n.props.flexWrap === 'wrap')
    const candidate = renderTriage(fake, 'desktop', card(), actions)
    expect(candidate.props).toMatchObject({ borderStyle: 'round', borderColor: 'claude', paddingX: 1 })
    const proposed = item({ status: 'open', proposal: { quote: 'q', at: '2026-10-04T10:00:00.000Z' } })
    const proposal = renderTriage(fake, 'desktop', card({ kind: 'proposal', item: proposed, quote: 'q' }), actions)
    expect(proposal.props).toMatchObject({ borderStyle: 'round', borderColor: 'success', paddingX: 1 })
    for (const root of [candidate, proposal]) {
      expect(wrapRows(root).length).toBe(1)
      expect(wrapRows(root)[0].props).toMatchObject({ columnGap: 1 })
      expect(wrapRows(root)[0].props.gap).toBeUndefined()
    }
    expect(renderTriage(fake, 'desktop', card({ state: 'saved' }), actions).props.borderStyle).toBeUndefined()
  })
  test('an answered card is one dim line with Deshacer', () => {
    calls.length = 0
    const said = (state: string, over = {}) => texts(renderTriage(fake, 'desktop', card({ state, ...over }), actions))[0]
    expect(said('saved')).toBe('Guardado en web-app')
    expect(said('rejected')).toBe('Descartado. No volveré a proponer cosas así.')
    expect(said('closed', { item: item({ proof: { quote: 'q', commit: 'a3f9c21' } }) })).toBe('Cerrado con prueba · a3f9c21')
    expect(said('closed')).toBe('Cerrado con prueba')
    expect(said('kept')).toBe('Sigue abierto.')
    byKey(renderTriage(fake, 'desktop', card({ state: 'saved' }), actions), 'tri-undo-c1').props.onPress()
    expect(calls).toEqual(['undo c1'])
  })
})

describe('pane', () => {
  const NOW = Date.parse('2026-10-04T10:00:00.000Z')
  const calls: string[] = []
  const rec = (name: string) => (...args: any[]) => calls.push([name, ...args].join(' '))
  const actions = Object.fromEntries(['save', 'reject', 'doNow', 'done', 'dismiss', 'reopen', 'cyclePriority', 'keepFresh', 'confirm', 'keep', 'startEdit', 'saveEdited', 'add', 'push', 'dismissNotice'].map(n => [n, rec(n)])) as any
  const live = (over = {}) => ({ ...item({ id: 'o1', status: 'open', text: 'Arreglar el envío duplicado de correo', category: 'bug', file: 'lib/facturas.ts', branch: 'main', createdAt: '2026-10-04T09:48:00.000Z' }), stale: false, ...over })
  const model = (over = {}) => ({
    now: NOW, branch: 'main', working: false, fileError: null, noRepo: false, repoName: 'web-app', repoPath: '/Users/m/web-app', notice: null, sync: 'synced', editing: null,
    waiting: [item()], live: [live()], closed: [], learned: 0, ...over,
  })
  const pane = (over = {}, surface = 'desktop') => renderPane(fake, surface, model(over), actions)

  const dotBefore = (root: any, label: string) => {
    const row = flat(root).find(n => n?.type === 'Box' && [].concat(n.props.children ?? []).some((c: any) => c?.props?.children === label))
    return [].concat(row.props.children).find((c: any) => c?.props?.children === '●') as any
  }

  test('header: the repo in bold (the pane title already says Cuaderno), a colored dot and where the ref stands', () => {
    expect(texts(pane())).toEqual(expect.arrayContaining(['web-app', 'Al día con origin']))
    expect(texts(pane())).not.toContain('Cuaderno')
    expect(dotBefore(pane(), 'Al día con origin').props.color).toBe('success')
    expect(dotBefore(pane({ sync: 'local' }), 'Solo en este ordenador').props.dimColor).toBe(true)
    expect(dotBefore(pane({ sync: 'ahead' }), 'Cambios sin subir').props.color).toBe('warning')
    expect(dotBefore(pane({ sync: 'failed' }), 'No se pudieron subir a origin').props.color).toBe('error')
    expect(texts(pane({ sync: 'local' }))).toContain('Solo en este ordenador')
    expect(texts(pane({ sync: 'ahead' }))).toContain('Cambios sin subir')
    expect(texts(pane({ sync: 'failed' }))).toContain('No se pudieron subir a origin')
    expect(byKey(pane({ sync: 'synced' }), 'push-now')).toBeUndefined()
    calls.length = 0
    byKey(pane({ sync: 'ahead' }), 'push-now').props.onPress()
    expect(calls).toEqual(['push'])
  })
  test('the field to write one by hand, not on mobile', () => {
    calls.length = 0
    const input = byKey(pane(), 'add-item')
    expect(input.props).toMatchObject({ placeholder: 'Apuntar un cabo…', submitLabel: 'apuntar' })
    input.props.onSubmit('Cabo a mano')
    expect(calls).toEqual(['add Cabo a mano'])
    expect(byKey(pane({}, 'mobile'), 'add-item')).toBeUndefined()
  })
  test('sections: bold title and dim count; Por revisar only when there is something', () => {
    const root = pane({ closed: [item({ id: 'd1', status: 'done', text: 'Hecho ayer', closedAt: '2026-10-03T10:00:00.000Z' })] })
    const headings = flat(root).filter(n => n?.type === 'Text' && n.props.bold).map(n => n.props.children)
    expect(headings).toEqual(['web-app', 'Por revisar', 'Abiertos', 'Cerrados esta semana'])
    expect(flat(pane({ waiting: [] })).filter(n => n?.type === 'Text' && n.props.bold).map(n => n.props.children)).not.toContain('Por revisar')
  })
  test('every item is a card: a candidate with the accent border, an open item with the quiet one', () => {
    const root = pane()
    expect(byKey(root, 'cand-c1').props).toMatchObject({ borderStyle: 'round', borderColor: 'claude', paddingX: 1 })
    expect(byKey(root, 'item-o1').props).toMatchObject({ borderStyle: 'round', borderColor: 'promptBorder', paddingX: 1 })
  })
  test('rows that wrap keep their lines together: a gap between items, none between lines; meta and controls apart', () => {
    const card = byKey(pane(), 'item-o1')
    const wrapping = flat(card).filter(n => n?.type === 'Box' && n.props.flexWrap === 'wrap')
    expect(wrapping.length).toBeGreaterThan(0)
    for (const row of wrapping) {
      expect(row.props.columnGap).toBe(1)
      expect(row.props.gap).toBeUndefined()
    }
    const rowOf = (key: string) => wrapping.find(r => [].concat(r.props.children).some((c: any) => c?.props?.key === key))
    expect(rowOf('prio-o1')).toBe(rowOf('now-o1'))
    expect(rowOf('edit-o1')).toBe(rowOf('now-o1'))
    expect(rowOf('prio-o1')).not.toBe(wrapping.find(r => [].concat(r.props.children).some((c: any) => c?.props?.children === 'bug · hace 12 min')))
  })
  test('a candidate: text, dim meta, its quote, Guardar and No es un cabo', () => {
    calls.length = 0
    const root = pane()
    expect(texts(root)).toEqual(expect.arrayContaining(['Corregir los revalidatePath del grupo (app)', 'deuda · hace 1 h', '«unos 41 revalidatePath ya no coinciden»']))
    byKey(root, 'save-c1').props.onPress()
    byKey(root, 'reject-c1').props.onPress()
    expect(calls).toEqual(['save c1', 'reject c1'])
  })
  test('an open item: colored dot, text, a priority word that cycles, meta, Hacer, Hecho, Descartar', () => {
    calls.length = 0
    const root = pane()
    expect(flat(byKey(root, 'item-o1')).find(n => n?.type === 'Text' && n.props.children === '●')?.props.color).toBe('warning')
    expect(byKey(root, 'prio-o1').props).toMatchObject({ label: 'normal', plain: true, dimColor: true })
    expect(texts(root)).toContain('bug · hace 12 min')
    expect(flat(root).find(n => n?.type === 'Text' && n.props.children === ' lib/facturas.ts ')?.props).toMatchObject({ backgroundColor: 'userMessageBackground' })
    for (const key of ['prio-o1', 'now-o1', 'done-o1', 'dismiss-o1', 'edit-o1']) byKey(root, key).props.onPress()
    expect(calls).toEqual(['cyclePriority o1', 'doNow o1', 'done o1', 'dismiss o1', 'startEdit o1'])
    expect(byKey(root, 'now-o1').props).toMatchObject({ label: 'Hacer', variant: 'primary', dimColor: false })
    expect(byKey(pane({ working: true }), 'now-o1').props.dimColor).toBe(true)
  })
  test('the dot follows the priority; meta says where it was born, and en curso', () => {
    expect(flat(byKey(pane({ live: [live({ priority: 'high' })] }), 'item-o1')).find(n => n?.props?.children === '●')?.props.color).toBe('error')
    expect(flat(byKey(pane({ live: [live({ priority: 'low' })] }), 'item-o1')).find(n => n?.props?.children === '●')?.props.dimColor).toBe(true)
    expect(texts(pane({ live: [live({ branch: 'fix/qa', status: 'doing' })] }))).toContain('bug · hace 12 min · nació en fix/qa · en curso')
    expect(flat(pane({ live: [live({ file: undefined })] })).some(n => n?.props?.backgroundColor)).toBe(false)
  })
  test('editing swaps the text for an Input, not on mobile', () => {
    calls.length = 0
    const input = byKey(pane({ editing: 'o1' }), 'edit-input-o1')
    expect(input.props.value).toBe('Arreglar el envío duplicado de correo')
    input.props.onSubmit('Texto nuevo')
    expect(calls).toEqual(['saveEdited o1 Texto nuevo'])
    expect(byKey(pane({ editing: 'o1' }, 'mobile'), 'edit-input-o1')).toBeUndefined()
    expect(byKey(pane({}, 'mobile'), 'edit-o1')).toBeUndefined()
  })
  test('a proposed closure shows ¿Resuelto? with its proof and two buttons', () => {
    calls.length = 0
    const root = pane({ live: [live({ proposal: { quote: 'ya no llama dos veces', commit: 'a3f9c21', at: '2026-10-04T09:59:00.000Z' } })] })
    expect(texts(root)).toEqual(expect.arrayContaining(['¿Resuelto? · commit a3f9c21', 'Prueba: «ya no llama dos veces»']))
    byKey(root, 'confirm-o1').props.onPress()
    byKey(root, 'keep-o1').props.onPress()
    expect(calls).toEqual(['confirm o1', 'keep o1'])
  })
  test('a stale item asks whether it still holds', () => {
    calls.length = 0
    const root = pane({ live: [live({ stale: true })] })
    expect(texts(root)).toContain('¿Sigue vigente?')
    byKey(root, 'fresh-o1').props.onPress()
    expect(calls).toEqual(['keepFresh o1'])
    expect(byKey(pane(), 'fresh-o1')).toBeUndefined()
  })
  test('closed this week: one line each, a green check, the text cut to fit, its proof, dismissed struck through, ↺ reopens', () => {
    calls.length = 0
    const root = pane({ closed: [
      item({ id: 'd1', status: 'done', text: 'Hojas de globals.css', proof: { quote: 'q', commit: '9e1b7c2' }, closedAt: '2026-10-04T08:00:00.000Z' }),
      item({ id: 'd2', status: 'dismissed', text: 'Ya no aplica', closedAt: '2026-10-04T08:00:00.000Z' }),
    ] })
    const done = byKey(root, 'closed-d1')
    expect(done.props.flexDirection).toBe('row')
    expect(flat(done).find(n => n?.props?.children === '✓')?.props.color).toBe('success')
    expect(flat(done).find(n => n?.props?.children === 'Hojas de globals.css')?.props.wrap).toBe('truncate-end')
    expect(flat(done).find(n => n?.props?.children === '9e1b7c2')?.props.dimColor).toBe(true)
    expect(flat(root).find(n => n?.props?.children === 'Ya no aplica')?.props).toMatchObject({ strikethrough: true, dimColor: true, wrap: 'truncate-end' })
    byKey(root, 'reopen-d1').props.onPress()
    expect(calls).toEqual(['reopen d1'])
  })
  test('empty, unreadable, outside git, the import notice and what the sweep learned', () => {
    expect(texts(pane({ waiting: [], live: [] }))).toContain('Nada abierto en este repo.')
    expect(texts(pane({ fileError: 'json' })).some(t => t.includes('No puedo leer los cabos de /Users/m/web-app (refs/loose-ends): json'))).toBe(true)
    const outside = pane({ noRepo: true })
    expect(texts(outside)).toEqual(['Esta sesión no está dentro de un repo git.'])
    const noticed = pane({ notice: 'Importados 3 cabos de .claude/loose-ends.json. Ya puedes borrar el fichero del repo.' })
    expect(texts(noticed)).toContain('Importados 3 cabos de .claude/loose-ends.json. Ya puedes borrar el fichero del repo.')
    calls.length = 0
    byKey(noticed, 'notice-ok').props.onPress()
    expect(calls).toEqual(['dismissNotice'])
    expect(byKey(pane(), 'notice-ok')).toBeUndefined()
    expect(texts(pane({ learned: 9 }))).toContain('El barrido aprende de 9 descartes tuyos')
    expect(texts(pane({ learned: 1 }))).toContain('El barrido aprende de 1 descarte tuyo')
    expect(texts(pane()).some(t => t.startsWith('El barrido aprende'))).toBe(false)
  })
  test('ago', () => {
    expect(ago('2026-10-04T10:00:00.000Z', NOW)).toBe('ahora')
    expect(ago('2026-10-04T09:48:00.000Z', NOW)).toBe('hace 12 min')
    expect(ago('2026-10-04T07:00:00.000Z', NOW)).toBe('hace 3 h')
    expect(ago('2026-10-01T10:00:00.000Z', NOW)).toBe('hace 3 d')
    expect(ago('ayer', NOW)).toBe('')
  })
})

describe('sinceText', () => {
  const NOW = Date.parse('2026-10-04T10:00:00.000Z')
  test('the same day, yesterday, or the date', () => {
    expect(sinceText('2026-10-04T09:00:00.000Z', NOW)).toBe('hace un rato')
    expect(sinceText('2026-10-03T10:00:00.000Z', NOW)).toBe('ayer')
    expect(sinceText('2026-10-01T10:00:00.000Z', NOW)).toBe('el 01/10')
    expect(sinceText('nunca', NOW)).toBe('la última vez')
  })
})
