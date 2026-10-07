import { describe, expect, test } from 'claude-code/testing'
import { OPEN_PANE_HREF, UNDO_HREF, ago, bandCard, bandLine, clip, emphasize, recapText, renderBand, renderPane, renderTriage, sinceText } from '../lib/screens.mjs'

const fake = new Proxy({}, { get: (_, type) => (props: any) => ({ type, props }) }) as any
const flat = (node: any): any[] => [node, ...([] as any[]).concat(node?.props?.children ?? []).flatMap(c => (typeof c === 'object' ? flat(c) : []))]
const byKey = (node: any, key: string) => flat(node).find(n => n?.props?.key === key)
const texts = (node: any) => flat(node).filter(n => n?.type === 'Text').map(n => String(n.props.children))
const counts = (over = {}) => ({ candidates: 0, live: 0, high: 0, medium: 0, low: 0, ...over })
const band = (over = {}) => ({ lang: 'es', mood: 'idle', counts: counts(), urgent: null, next: null, justClosed: null, recap: null, fileError: null, sync: null, working: false, ...over })
const item = (over = {}) => ({ id: 'c1', text: 'Corregir los revalidatePath del grupo (app)', category: 'deuda', priority: 'medium', status: 'candidate', evidence: 'unos 41 revalidatePath ya no coinciden', createdAt: '2026-10-04T09:00:00.000Z', ...over })

describe('band line', () => {
  test('the first that applies: unreadable, to review, urgent, just closed, since last time, open, nothing', () => {
    expect(bandLine(band({ fileError: 'json', counts: counts({ candidates: 2 }) }))).toEqual({ text: 'No puedo leer los cabos', action: 'open', label: 'Ver', warning: true })
    expect(bandLine(band({ counts: counts({ candidates: 2, live: 1, high: 1 }), urgent: item() }))).toEqual({ text: '2 por revisar · 1 abierto', action: 'open', label: 'Revisar' })
    expect(bandLine(band({ counts: counts({ candidates: 1 }) }))?.text).toBe('1 por revisar')
    expect(bandLine(band({ counts: counts({ live: 3, high: 1 }), urgent: item({ text: 'Arreglar el login' }), justClosed: { text: 'x' } }))).toEqual({ text: 'Urgente: Arreglar el login', action: 'open', label: 'Ver' })
    expect(bandLine(band({ counts: counts({ live: 3 }), justClosed: { text: 'Envío duplicado' } }))).toEqual({ text: 'Cerrado: Envío duplicado', action: 'undo', label: 'Deshacer' })
    expect(bandLine(band({ counts: counts({ live: 3 }), recap: { since: 'ayer', fresh: 2, closed: 1 } }))).toEqual({ text: 'Desde ayer: 2 nuevos · 1 cerrado en otra sesión', action: 'open', label: 'Ver' })
    expect(bandLine(band({ counts: counts({ live: 3 }), recap: { since: 'ayer', fresh: 0, closed: 0 } }))?.text).toBe('3 abiertos')
    expect(bandLine(band({ counts: counts({ live: 1 }) }))).toEqual({ text: '1 abierto', action: 'open', label: 'Ver' })
    expect(bandLine(band())).toBe(null)
  })
  test('long texts are clipped to 60 characters with an ellipsis', () => {
    expect(clip('x'.repeat(60))).toBe('x'.repeat(60))
    expect(clip('x'.repeat(61))).toBe(`${'x'.repeat(59)}…`)
  })
  test('recap leaves out what is zero', () => {
    expect(recapText('es', { since: 'ayer', fresh: 1, closed: 0 })).toBe('Desde ayer: 1 nuevo')
    expect(recapText('es', { since: 'el 03/10', fresh: 0, closed: 2 })).toBe('Desde el 03/10: 2 cerrados en otra sesión')
  })
})

describe('band card', () => {
  const next = (over = {}) => item({ id: 'o1', status: 'open', text: 'Probar el camino desde /plugin', priority: 'medium', file: undefined, ...over })
  test('nothing open and nothing to say: no card', () => {
    expect(bandCard(band())).toBe(null)
  })
  test('unreadable ref: red border, the warning, a pointer to the pane and Ver', () => {
    expect(bandCard(band({ fileError: 'json', counts: counts({ candidates: 2 }), next: next() }))).toEqual({
      border: 'error', top: { text: 'No puedo leer los cabos', color: 'warning' }, bottom: [{ text: 'El Cuaderno dice por qué' }], button: null, link: { label: 'Ver', action: 'open' },
    })
  })
  test('to review: accent border, how many wait, the next one, the open count, where the ref stands, and Revisar', () => {
    expect(bandCard(band({ counts: counts({ candidates: 2, live: 4, medium: 4 }), next: next(), sync: 'ahead' }))).toEqual({
      border: 'claude',
      top: { text: '2 cabos esperan tu visto bueno' },
      bottom: [{ text: 'Siguiente: Probar el camino desde /plugin' }, { text: '4 abiertos' }, { text: 'sin subir' }],
      button: { label: 'Revisar', action: 'open' },
      link: null,
    })
    expect(bandCard(band({ counts: counts({ candidates: 1 }) }))).toMatchObject({ top: { text: '1 cabo espera tu visto bueno' }, bottom: [] })
  })
  test('just closed: green border, what closed, what is left, Hacer on the next one and Deshacer', () => {
    expect(bandCard(band({ counts: counts({ live: 4, medium: 4 }), justClosed: { text: 'Sección Actualizar' }, next: next() }))).toEqual({
      border: 'success',
      top: { text: 'Cerrado: Sección Actualizar' },
      bottom: [{ text: 'Quedan 4' }, { text: 'siguiente: Probar el camino desde /plugin' }],
      button: { label: 'Hacer', action: 'doNow', id: 'o1' },
      link: { label: 'Deshacer', action: 'undo' },
    })
    expect(bandCard(band({ counts: counts({ live: 1, medium: 1 }), justClosed: { text: 'Sección Actualizar' }, next: next() }))?.bottom[0]).toEqual({ text: 'Queda 1' })
    expect(bandCard(band({ justClosed: { text: 'El último' } }))).toEqual({
      border: 'success', top: { text: 'Cerrado: El último' }, bottom: [{ text: 'No queda nada abierto' }], button: null, link: { label: 'Deshacer', action: 'undo' },
    })
  })
  test('since last time: the recap on top, the next one under it with its dot, Hacer and Cuaderno', () => {
    expect(bandCard(band({ counts: counts({ live: 1, high: 1 }), recap: { since: 'ayer', fresh: 2, closed: 1 }, next: next({ priority: 'high' }) }))).toEqual({
      border: 'error',
      top: { text: 'Desde ayer: 2 nuevos · 1 cerrado en otra sesión' },
      bottom: [{ text: 'Siguiente: Probar el camino desde /plugin', priority: 'high' }],
      button: { label: 'Hacer', action: 'doNow', id: 'o1' },
      link: { label: 'Cuaderno', action: 'open' },
    })
    expect(bandCard(band({ recap: { since: 'ayer', fresh: 0, closed: 2 } }))).toEqual({
      border: 'promptBorder', top: { text: 'Desde ayer: 2 cerrados en otra sesión' }, bottom: [{ text: 'No queda nada abierto' }], button: null, link: { label: 'Cuaderno', action: 'open' },
    })
    expect(bandCard(band({ counts: counts({ live: 1, medium: 1 }), recap: { since: 'ayer', fresh: 0, closed: 0 }, next: next() }))?.top.text).toBe('Probar el camino desde /plugin')
  })
  test('normal: the next one on top with its dot and file, then Siguiente, the counts by priority and where the ref stands', () => {
    expect(bandCard(band({ counts: counts({ live: 5, medium: 3, low: 2 }), next: next({ file: 'lib/a.ts' }), sync: 'synced' }))).toEqual({
      border: 'promptBorder',
      top: { text: 'Probar el camino desde /plugin', priority: 'medium', file: 'lib/a.ts' },
      bottom: [{ text: 'Siguiente' }, { text: '3 normales', priority: 'medium' }, { text: '2 bajas', priority: 'low' }, { text: 'subido a origin' }],
      button: { label: 'Hacer', action: 'doNow', id: 'o1' },
      link: { label: 'Cuaderno', action: 'open' },
    })
    const long = bandCard(band({ counts: counts({ live: 1, medium: 1 }), next: next({ text: 'y'.repeat(200) }) }))?.top.text
    expect(long).toHaveLength(120)
    expect(long?.endsWith('…')).toBe(true)
  })
  test('normal: an urgent next one turns the border red and says Urgente; one in progress says En curso; the ref words', () => {
    expect(bandCard(band({ counts: counts({ live: 1, high: 1 }), next: next({ priority: 'high' }) }))).toMatchObject({
      border: 'error', bottom: [{ text: 'Urgente' }, { text: '1 urgente', priority: 'high' }],
    })
    expect(bandCard(band({ counts: counts({ live: 1, high: 1 }), next: next({ priority: 'high', status: 'doing' }) }))?.bottom[0]).toEqual({ text: 'En curso' })
    const last = (sync: string | null) => bandCard(band({ counts: counts({ live: 1, medium: 1 }), next: next(), sync }))?.bottom.at(-1)
    expect(last('failed')).toEqual({ text: 'no se pudo subir' })
    expect(last('local')).toEqual({ text: 'solo en este ordenador' })
    expect(last(null)).toEqual({ text: '1 normal', priority: 'medium' })
  })
})

describe('band', () => {
  const calls: string[] = []
  const acts = { openPane: () => calls.push('open'), undoClose: () => calls.push('undo'), doNow: (id: string) => calls.push(`doNow ${id}`) }
  const next = (over = {}) => item({ id: 'o1', status: 'open', text: 'Probar el camino desde /plugin', priority: 'medium', file: undefined, ...over })
  test('desktop: a filled card, Chispa at 44×37, the two lines, Hacer and the Cuaderno link', () => {
    calls.length = 0
    const root = renderBand(fake, 'desktop', band({ counts: counts({ live: 2, medium: 2 }), next: next({ file: 'lib/a.ts' }) }), acts)
    expect(root.props).toMatchObject({ flexDirection: 'row', alignItems: 'center', borderStyle: 'round', borderColor: 'promptBorder', backgroundColor: 'userMessageBackground', paddingX: 1 })
    expect(root.props.children[0]).toMatchObject({ type: 'Svg', props: { alt: 'Chispa atenta', width: 44, height: 37 } })
    const top = byKey(root, 'band-top')
    expect(flat(top).find(n => n?.props?.children === '●')?.props.color).toBe('warning')
    expect(flat(top).find(n => n?.props?.children === 'Probar el camino desde /plugin')?.props.wrap).toBe('truncate-end')
    expect(flat(top).find(n => n?.props?.children === 'lib/a.ts')?.props.dimColor).toBe(true)
    expect(texts(byKey(root, 'band-bottom'))).toEqual(['Siguiente', '·', '●', '2 normales'])
    const act = byKey(root, 'band-act')
    expect(act.props).toMatchObject({ label: 'Hacer', variant: 'primary', dimColor: false })
    act.props.onPress()
    const link = byKey(root, 'band-line')
    expect(link.props).toMatchObject({ text: `[Cuaderno](${OPEN_PANE_HREF})`, pressableLinks: [OPEN_PANE_HREF] })
    link.props.onLinkPress()
    expect(calls).toEqual(['doNow o1', 'open'])
    expect(flat(root).filter(n => n?.type === 'Markdown').map(n => n.props.text)).toEqual([`[Cuaderno](${OPEN_PANE_HREF})`])
  })
  test('desktop: Hacer is dim while a turn runs; Revisar opens the pane; Deshacer undoes; no link when there is none', () => {
    calls.length = 0
    expect(byKey(renderBand(fake, 'desktop', band({ counts: counts({ live: 1, medium: 1 }), next: next(), working: true }), acts), 'band-act').props.dimColor).toBe(true)
    const review = renderBand(fake, 'desktop', band({ counts: counts({ candidates: 1 }) }), acts)
    expect(review.props.borderColor).toBe('claude')
    expect(byKey(review, 'band-line')).toBeUndefined()
    byKey(review, 'band-act').props.onPress()
    const closed = renderBand(fake, 'desktop', band({ justClosed: { text: 'Hecho' } }), acts)
    expect(byKey(closed, 'band-act')).toBeUndefined()
    expect(byKey(closed, 'band-line').props.text).toBe(`[Deshacer](${UNDO_HREF})`)
    byKey(closed, 'band-line').props.onLinkPress()
    expect(calls).toEqual(['open', 'undo'])
  })
  test('desktop: the warning in its color; an item text is plain text even with Markdown in it', () => {
    const warn = renderBand(fake, 'desktop', band({ fileError: 'json' }), acts)
    expect(flat(byKey(warn, 'band-top')).find(n => n?.props?.children === 'No puedo leer los cabos')?.props.color).toBe('warning')
    const tricky = renderBand(fake, 'desktop', band({ counts: counts({ live: 1, high: 1 }), next: next({ text: '[Pulsa](https://x.y) *ya*', priority: 'high' }) }), acts)
    expect(texts(byKey(tricky, 'band-top'))).toContain('[Pulsa](https://x.y) *ya*')
    expect(flat(tricky).filter(n => n?.type === 'Markdown').map(n => n.props.text)).toEqual([`[Cuaderno](${OPEN_PANE_HREF})`])
  })
  test('desktop: an unreadable ref offers only the Ver link; Revisar stays lit while a turn runs', () => {
    const warn = renderBand(fake, 'desktop', band({ fileError: 'json', counts: counts({ live: 1, medium: 1 }), next: next() }), acts)
    expect(byKey(warn, 'band-act')).toBeUndefined()
    expect(byKey(warn, 'band-line').props.text).toBe(`[Ver](${OPEN_PANE_HREF})`)
    const review = renderBand(fake, 'desktop', band({ counts: counts({ candidates: 1 }), working: true }), acts)
    expect(byKey(review, 'band-act').props).toMatchObject({ label: 'Revisar', dimColor: false })
  })
  test('desktop: to review wins over just closed and since last time; just closed wins over since last time', () => {
    const recap = { since: 'ayer', fresh: 1, closed: 0 }
    expect(bandCard(band({ counts: counts({ candidates: 1, live: 1, medium: 1 }), justClosed: { text: 'Hecho' }, recap, next: next() }))?.border).toBe('claude')
    expect(bandCard(band({ counts: counts({ live: 1, medium: 1 }), justClosed: { text: 'Hecho' }, recap, next: next() }))?.border).toBe('success')
  })
  test('desktop: with nothing to say the band is a card with Chispa and her phrase, no button and no link', () => {
    const root = renderBand(fake, 'desktop', band(), acts)
    expect(root.props).toMatchObject({ borderStyle: 'round', borderColor: 'promptBorder' })
    expect(byKey(root, 'band-act')).toBeUndefined()
    expect(byKey(root, 'band-line')).toBeUndefined()
  })
  test('terminal: a dim face, the dim line and a plain button', () => {
    const root = renderBand(fake, 'terminal', band({ mood: 'worried', counts: counts({ live: 1, high: 1 }), urgent: item({ text: 'Arreglar el login' }) }), acts)
    expect(texts(root)).toEqual(['(•_•)!', 'Urgente: Arreglar el login'])
    expect(byKey(root, 'open-pane').props).toMatchObject({ label: 'Ver', plain: true, dimColor: true })
    expect(flat(root).some(n => n?.type === 'Svg')).toBe(false)
    expect(root.props.borderStyle).toBeUndefined()
  })
  test('terminal: an unreadable ref is a warning; just closed is undo-close', () => {
    const warn = renderBand(fake, 'terminal', band({ fileError: 'json' }), acts)
    expect(flat(warn).find(n => n?.props?.color === 'warning')?.props.children).toBe('No puedo leer los cabos')
    const closed = renderBand(fake, 'terminal', band({ counts: counts({ live: 1 }), justClosed: { text: 'Hecho' } }), acts)
    expect(byKey(closed, 'undo-close')?.props.label).toBe('Deshacer')
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
  const card = (over = {}) => ({ lang: 'es', kind: 'candidate', item: item(), quote: item().evidence, state: null, repoName: 'web-app', editing: false, ...over })
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
    expect(said('withdrawn', { item: item({ proof: { quote: 'q', commit: 'a3f9c21' } }) })).toBe('Retirado: resuelto después · a3f9c21')
    expect(said('withdrawn')).toBe('Retirado: resuelto después')
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
    now: NOW, lang: 'es', branch: 'main', working: false, fileError: null, noRepo: false, repoName: 'web-app', repoPath: '/Users/m/web-app', notice: null, sync: 'synced', editing: null,
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
    expect(flat(done).find(n => n?.type === 'Box' && [].concat(n.props.children).some((c: any) => c?.props?.children === '9e1b7c2'))?.props.flexShrink).toBe(0)
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
    expect(ago('es', '2026-10-04T10:00:00.000Z', NOW)).toBe('ahora')
    expect(ago('es', '2026-10-04T09:48:00.000Z', NOW)).toBe('hace 12 min')
    expect(ago('es', '2026-10-04T07:00:00.000Z', NOW)).toBe('hace 3 h')
    expect(ago('es', '2026-10-01T10:00:00.000Z', NOW)).toBe('hace 3 d')
    expect(ago('es', 'ayer', NOW)).toBe('')
  })
})

describe('sinceText', () => {
  const NOW = Date.parse('2026-10-04T10:00:00.000Z')
  test('the same day, yesterday, or the date', () => {
    expect(sinceText('es', '2026-10-04T09:00:00.000Z', NOW)).toBe('hace un rato')
    expect(sinceText('es', '2026-10-03T10:00:00.000Z', NOW)).toBe('ayer')
    expect(sinceText('es', '2026-10-01T10:00:00.000Z', NOW)).toBe('el 01/10')
    expect(sinceText('es', 'nunca', NOW)).toBe('la última vez')
  })
})

describe('in English', () => {
  const calls: string[] = []
  const acts = { openPane: () => calls.push('open'), undoClose: () => calls.push('undo'), doNow: (id: string) => calls.push(`doNow ${id}`) }
  const en = (over = {}) => band({ lang: 'en', ...over })
  const next = (over = {}) => item({ id: 'o1', status: 'open', text: 'Test the /plugin path', priority: 'medium', file: undefined, ...over })
  test('band line: English words and English plurals', () => {
    expect(bandLine(en({ fileError: 'json' }))).toEqual({ text: "Can't read the loose ends", action: 'open', label: 'View', warning: true })
    expect(bandLine(en({ counts: counts({ candidates: 2, live: 1 }) }))).toEqual({ text: '2 to review · 1 open', action: 'open', label: 'Review' })
    expect(bandLine(en({ counts: counts({ live: 3, high: 1 }), urgent: item({ text: 'Fix the login' }) }))?.text).toBe('Urgent: Fix the login')
    expect(bandLine(en({ counts: counts({ live: 3 }), justClosed: { text: 'Duplicate email' } }))).toEqual({ text: 'Closed: Duplicate email', action: 'undo', label: 'Undo' })
    expect(bandLine(en({ counts: counts({ live: 3 }), recap: { since: 'yesterday', fresh: 1, closed: 2 } }))?.text).toBe('Since yesterday: 1 new · 2 closed in another session')
    expect(bandLine(en({ counts: counts({ live: 2 }) }))?.text).toBe('2 open')
  })
  test('band card: to review, just closed and the next one', () => {
    expect(bandCard(en({ fileError: 'json' }))).toEqual({
      border: 'error', top: { text: "Can't read the loose ends", color: 'warning' }, bottom: [{ text: 'The Notebook says why' }], button: null, link: { label: 'View', action: 'open' },
    })
    expect(bandCard(en({ counts: counts({ candidates: 1 }) }))?.top.text).toBe('1 loose end awaits your OK')
    expect(bandCard(en({ counts: counts({ candidates: 3, live: 2, medium: 2 }), next: next(), sync: 'ahead' }))).toEqual({
      border: 'claude', top: { text: '3 loose ends await your OK' }, bottom: [{ text: 'Next: Test the /plugin path' }, { text: '2 open' }, { text: 'not pushed' }], button: { label: 'Review', action: 'open' }, link: null,
    })
    expect(bandCard(en({ counts: counts({ live: 1, medium: 1 }), justClosed: { text: 'Update section' }, next: next() }))).toEqual({
      border: 'success', top: { text: 'Closed: Update section' }, bottom: [{ text: '1 left' }, { text: 'next: Test the /plugin path' }], button: { label: 'Do it', action: 'doNow', id: 'o1' }, link: { label: 'Undo', action: 'undo' },
    })
    expect(bandCard(en({ justClosed: { text: 'The last one' } }))?.bottom).toEqual([{ text: 'Nothing left open' }])
    expect(bandCard(en({ recap: { since: 'Oct 1', fresh: 0, closed: 2 } }))).toEqual({
      border: 'promptBorder', top: { text: 'Since Oct 1: 2 closed in another session' }, bottom: [{ text: 'Nothing left open' }], button: null, link: { label: 'Notebook', action: 'open' },
    })
    expect(bandCard(en({ counts: counts({ live: 4, high: 1, medium: 1, low: 2 }), next: next({ priority: 'high' }), sync: 'synced' }))).toEqual({
      border: 'error',
      top: { text: 'Test the /plugin path', priority: 'high' },
      bottom: [{ text: 'Urgent' }, { text: '1 urgent', priority: 'high' }, { text: '1 normal', priority: 'medium' }, { text: '2 low', priority: 'low' }, { text: 'pushed to origin' }],
      button: { label: 'Do it', action: 'doNow', id: 'o1' },
      link: { label: 'Notebook', action: 'open' },
    })
    expect(bandCard(en({ counts: counts({ live: 1, medium: 1 }), next: next({ status: 'doing' }), sync: 'failed' }))?.bottom).toEqual([{ text: 'In progress' }, { text: '1 normal', priority: 'medium' }, { text: 'push failed' }])
    expect(bandCard(en({ counts: counts({ live: 1, low: 1 }), next: next({ priority: 'low' }), sync: 'local' }))?.bottom).toEqual([{ text: 'Next' }, { text: '1 low', priority: 'low' }, { text: 'only on this computer' }])
  })
  test('band: Chispa is described in English on the desktop; the terminal button says View', () => {
    const desk = renderBand(fake, 'desktop', en({ counts: counts({ live: 1, medium: 1 }), next: next() }), acts)
    expect(desk.props.children[0].props.alt).toBe('Chispa watching')
    expect(byKey(desk, 'band-act').props.label).toBe('Do it')
    expect(byKey(desk, 'band-line').props.text).toBe(`[Notebook](${OPEN_PANE_HREF})`)
    const term = renderBand(fake, 'terminal', en({ mood: 'worried', counts: counts({ live: 1, high: 1 }), urgent: item({ text: 'Fix the login' }) }), acts)
    expect(texts(term)).toEqual(['(•_•)!', 'Urgent: Fix the login'])
    expect(byKey(term, 'open-pane').props.label).toBe('View')
  })
  test('triage card: candidate, proposal and answered lines', () => {
    const noop = () => {}
    const actions = { save: noop, reject: noop, confirm: noop, keep: noop, undo: noop, startEdit: noop, saveEdited: noop }
    const card = (over = {}) => ({ lang: 'en', kind: 'candidate', item: item(), quote: item().evidence, state: null, repoName: 'web-app', editing: false, ...over })
    const candidate = renderTriage(fake, 'desktop', card(), actions)
    expect(texts(candidate)).toEqual(['Candidate loose end · debt · normal', 'Corregir los revalidatePath del grupo (app)'])
    expect(['tri-save-c1', 'tri-reject-c1', 'tri-edit-c1'].map(k => byKey(candidate, k).props.label)).toEqual(['Save', 'Not a loose end', 'Edit'])
    expect(byKey(renderTriage(fake, 'desktop', card({ editing: true }), actions), 'tri-edit-input-c1').props.submitLabel).toBe('save')
    const proposed = item({ status: 'open', proposal: { quote: 'no longer calls twice', commit: 'a3f9c21', at: '2026-10-04T10:00:00.000Z' } })
    const proposal = renderTriage(fake, 'desktop', card({ kind: 'proposal', item: proposed, quote: 'no longer calls twice' }), actions)
    expect(texts(proposal)).toEqual(['Resolved? · commit a3f9c21', 'Corregir los revalidatePath del grupo (app)', 'Proof: “no longer calls twice”'])
    expect([byKey(proposal, 'tri-confirm-c1').props.label, byKey(proposal, 'tri-keep-c1').props.label]).toEqual(['Yes, close', 'Still open'])
    const said = (state: string, over = {}) => texts(renderTriage(fake, 'desktop', card({ state, ...over }), actions))[0]
    expect(said('saved')).toBe('Saved in web-app')
    expect(said('rejected')).toBe("Rejected. I won't propose things like this again.")
    expect(said('closed', { item: item({ proof: { quote: 'q', commit: 'a3f9c21' } }) })).toBe('Closed with proof · a3f9c21')
    expect(said('kept')).toBe('Still open.')
    expect(said('withdrawn')).toBe('Withdrawn: resolved later')
    expect(byKey(renderTriage(fake, 'desktop', card({ state: 'saved' }), actions), 'tri-undo-c1').props.label).toBe('Undo')
  })
  test('pane: headings, ref state, rows and controls', () => {
    const NOW = Date.parse('2026-10-04T10:00:00.000Z')
    const noop = () => {}
    const actions = Object.fromEntries(['save', 'reject', 'doNow', 'done', 'dismiss', 'reopen', 'cyclePriority', 'keepFresh', 'confirm', 'keep', 'startEdit', 'saveEdited', 'add', 'push', 'dismissNotice'].map(n => [n, noop])) as any
    const live = (over = {}) => ({ ...item({ id: 'o1', status: 'open', text: 'Fix the duplicate email', category: 'bug', file: 'lib/invoices.ts', branch: 'main', createdAt: '2026-10-04T09:48:00.000Z' }), stale: false, ...over })
    const model = (over = {}) => ({
      now: NOW, lang: 'en', branch: 'main', working: false, fileError: null, noRepo: false, repoName: 'web-app', repoPath: '/Users/m/web-app', notice: null, sync: 'synced', editing: null,
      waiting: [item()], live: [live()], closed: [], learned: 0, ...over,
    })
    const pane = (over = {}) => renderPane(fake, 'desktop', model(over), actions)
    const root = pane({ closed: [
      item({ id: 'd1', status: 'done', text: 'Globals sheet', proof: { quote: 'q' }, closedAt: '2026-10-04T08:00:00.000Z' }),
      item({ id: 'd2', status: 'expired', withdrawn: true, text: 'Withdrawn one', proof: { quote: 'q', commit: '9e1b7c2' }, closedAt: '2026-10-04T08:00:00.000Z' }),
    ] })
    expect(flat(root).filter(n => n?.type === 'Text' && n.props.bold).map(n => n.props.children)).toEqual(['web-app', 'To review', 'Open', 'Closed this week'])
    expect(texts(root)).toEqual(expect.arrayContaining(['Up to date with origin', 'debt · 1 h ago', '“unos 41 revalidatePath ya no coinciden”', 'bug · 12 min ago', 'with proof', 'withdrawn · 9e1b7c2']))
    expect(byKey(root, 'add-item').props).toMatchObject({ placeholder: 'Note a loose end…', submitLabel: 'note' })
    expect(['save-c1', 'reject-c1', 'now-o1', 'done-o1', 'dismiss-o1', 'prio-o1', 'edit-o1'].map(k => byKey(root, k).props.label)).toEqual(['Save', 'Not a loose end', 'Do it', 'Done', 'Dismiss', 'normal', 'edit'])
    expect(byKey(pane({ live: [live({ priority: 'high' })] }), 'prio-o1').props.label).toBe('urgent')
    expect(texts(pane({ live: [live({ branch: 'fix/qa', status: 'doing' })] }))).toContain('bug · 12 min ago · created on fix/qa · in progress')
    expect(texts(pane({ live: [live({ stale: true })] }))).toContain('Still relevant?')
    expect(byKey(pane({ live: [live({ stale: true })] }), 'fresh-o1').props.label).toBe('Yes')
    expect(texts(pane({ live: [live({ proposal: { quote: 'no longer calls twice', at: '2026-10-04T09:59:00.000Z' } })] }))).toEqual(expect.arrayContaining(['Resolved?', 'Proof: “no longer calls twice”']))
    expect(texts(pane({ sync: 'local' }))).toContain('Only on this computer')
    expect(texts(pane({ sync: 'ahead' }))).toContain('Changes not pushed')
    expect(texts(pane({ sync: 'failed' }))).toContain("Couldn't push to origin")
    expect(byKey(pane({ sync: 'ahead' }), 'push-now').props.label).toBe('Push')
    expect(texts(pane({ waiting: [], live: [] }))).toContain('Nothing open in this repo.')
    expect(texts(pane({ fileError: 'json' }))).toContain("Can't read the loose ends of /Users/m/web-app (refs/loose-ends): json. The panel recovers by itself as soon as they can be read.")
    expect(texts(pane({ noRepo: true }))).toEqual(['This session is not inside a git repo.'])
    expect(byKey(pane({ notice: 'n' }), 'notice-ok').props.label).toBe('Got it')
    expect(texts(pane({ learned: 1 }))).toContain('The sweep learns from 1 rejection of yours')
    expect(texts(pane({ learned: 4 }))).toContain('The sweep learns from 4 rejections of yours')
  })
  test('ago, sinceText and recapText', () => {
    const NOW = Date.parse('2026-10-04T10:00:00.000Z')
    expect(ago('en', '2026-10-04T10:00:00.000Z', NOW)).toBe('just now')
    expect(ago('en', '2026-10-04T09:48:00.000Z', NOW)).toBe('12 min ago')
    expect(ago('en', '2026-10-04T07:00:00.000Z', NOW)).toBe('3 h ago')
    expect(ago('en', '2026-10-01T10:00:00.000Z', NOW)).toBe('3 d ago')
    expect(sinceText('en', '2026-10-04T09:00:00.000Z', NOW)).toBe('earlier today')
    expect(sinceText('en', '2026-10-03T10:00:00.000Z', NOW)).toBe('yesterday')
    expect(sinceText('en', '2026-10-01T10:00:00.000Z', NOW)).toBe('Oct 1')
    expect(sinceText('en', 'never', NOW)).toBe('last time')
    expect(recapText('en', { since: 'yesterday', fresh: 1, closed: 0 })).toBe('Since yesterday: 1 new')
    expect(recapText('en', { since: 'yesterday', fresh: 3, closed: 1 })).toBe('Since yesterday: 3 new · 1 closed in another session')
  })
})
