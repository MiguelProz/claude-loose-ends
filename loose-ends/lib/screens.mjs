import { chispaSvg, MOOD_LABELS, TERMINAL_FACES } from './chispa.mjs'

// The pane opens, and the last close is undone, from a link at the end of the band's line, so the band stays a
// light row on the desktop instead of carrying a native button.
export const OPEN_PANE_HREF = 'file:///loose-ends/ver'
export const UNDO_HREF = 'file:///loose-ends/deshacer'
export const PRIORITY_WORD = { high: 'urgente', medium: 'normal', low: 'baja' }
const BAND_TEXT_MAX = 60

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

export function clip(text, max = BAND_TEXT_MAX) {
  const t = String(text ?? '')
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

export function recapText({ since, fresh, closed }) {
  const parts = [fresh ? plural(fresh, 'nuevo', 'nuevos') : '', closed ? `${plural(closed, 'cerrado', 'cerrados')} en otra sesión` : ''].filter(Boolean)
  return `Desde ${since}: ${parts.join(' · ')}`
}

// What the band says, the first that applies: unreadable, to review, urgent, just closed, since last time, open.
export function bandLine(m) {
  if (m.fileError) return { text: 'No puedo leer los cabos', action: 'open', label: 'Ver', warning: true }
  const open = m.counts.live ? plural(m.counts.live, 'abierto', 'abiertos') : ''
  if (m.counts.candidates) {
    const review = `${m.counts.candidates} por revisar`
    return { text: [review, open].filter(Boolean).join(' · '), action: 'open', label: 'Revisar' }
  }
  if (m.urgent) return { text: `Urgente: ${clip(m.urgent.text)}`, action: 'open', label: 'Ver' }
  if (m.justClosed) return { text: `Cerrado: ${clip(m.justClosed.text)}`, action: 'undo', label: 'Deshacer' }
  if (m.recap && (m.recap.fresh || m.recap.closed)) return { text: recapText(m.recap), action: 'open', label: 'Ver' }
  if (open) return { text: open, action: 'open', label: 'Ver' }
  return null
}

const SYNC_WORDS = { synced: 'subido a origin', ahead: 'sin subir', failed: 'no se pudo subir', local: 'solo en este ordenador' }
const PRIORITY_COUNT = [
  ['high', 'urgente', 'urgentes'],
  ['medium', 'normal', 'normales'],
  ['low', 'baja', 'bajas'],
]

// What the desktop band says: a border color, the top line, the dim segments under it, the button and the link.
// The first that applies: unreadable, to review, just closed, since last time, the next loose end; nothing open, null.
export function bandCard(m) {
  const next = m.next
  const sync = SYNC_WORDS[m.sync] ? [{ text: SYNC_WORDS[m.sync] }] : []
  const doNext = next ? { label: 'Hacer', action: 'doNow', id: next.id } : null
  const nextBorder = next?.priority === 'high' ? 'error' : 'promptBorder'
  if (m.fileError) {
    return { border: 'error', top: { text: 'No puedo leer los cabos', color: 'warning' }, bottom: [{ text: 'El Cuaderno dice por qué' }], button: null, link: { label: 'Ver', action: 'open' } }
  }
  if (m.counts.candidates) {
    const n = m.counts.candidates
    const bottom = [...(next ? [{ text: `Siguiente: ${clip(next.text)}` }] : []), ...(m.counts.live ? [{ text: plural(m.counts.live, 'abierto', 'abiertos') }] : []), ...sync]
    return { border: 'claude', top: { text: n === 1 ? '1 cabo espera tu visto bueno' : `${n} cabos esperan tu visto bueno` }, bottom, button: { label: 'Revisar', action: 'open' }, link: null }
  }
  if (m.justClosed) {
    const bottom = next ? [{ text: `Quedan ${m.counts.live}` }, { text: `siguiente: ${clip(next.text)}` }] : [{ text: 'No queda nada abierto' }]
    return { border: 'success', top: { text: `Cerrado: ${clip(m.justClosed.text)}` }, bottom, button: doNext, link: { label: 'Deshacer', action: 'undo' } }
  }
  if (m.recap && (m.recap.fresh || m.recap.closed)) {
    const bottom = next ? [{ text: `Siguiente: ${clip(next.text)}`, priority: next.priority }] : [{ text: 'No queda nada abierto' }]
    return { border: nextBorder, top: { text: recapText(m.recap) }, bottom, button: doNext, link: { label: 'Cuaderno', action: 'open' } }
  }
  if (!next) return null
  const label = next.status === 'doing' ? 'En curso' : next.priority === 'high' ? 'Urgente' : 'Siguiente'
  const byPriority = PRIORITY_COUNT.filter(([p]) => m.counts[p]).map(([p, one, many]) => ({ text: plural(m.counts[p], one, many), priority: p }))
  return {
    border: nextBorder,
    top: { text: next.text, priority: next.priority, ...(next.file ? { file: next.file } : {}) },
    bottom: [{ text: label }, ...byPriority, ...sync],
    button: doNext,
    link: { label: 'Cuaderno', action: 'open' },
  }
}

// The top line of the card: the priority dot, the text cut to fit, and the file, dim.
function cardTop(el, top) {
  const parts = []
  if (top.priority) parts.push(el.Text({ ...(DOT[top.priority] ?? DOT.medium), children: '●' }))
  parts.push(el.Box({ flexShrink: 1, minWidth: 0, children: [el.Text({ wrap: 'truncate-end', ...(top.color ? { color: top.color } : {}), children: top.text })] }))
  if (top.file) parts.push(el.Text({ dimColor: true, children: top.file }))
  return el.Box({ key: 'band-top', flexDirection: 'row', gap: 1, overflow: 'hidden', children: parts })
}

// The bottom line: the segments, dim, a dot before each one that names a priority, joined by «·».
function cardBottom(el, bottom) {
  const parts = []
  bottom.forEach((seg, i) => {
    if (i) parts.push(el.Text({ dimColor: true, children: '·' }))
    if (seg.priority) parts.push(el.Text({ ...(DOT[seg.priority] ?? DOT.medium), children: '●' }))
    parts.push(el.Text({ dimColor: true, wrap: 'truncate-end', children: seg.text }))
  })
  return el.Box({ key: 'band-bottom', flexDirection: 'row', gap: 1, overflow: 'hidden', children: parts })
}

export function renderBand(el, surface, m, actions) {
  const line = bandLine(m)
  const press = () => (line?.action === 'undo' ? actions.undoClose() : actions.openPane())
  if (surface === 'terminal') {
    const children = [el.Text({ dimColor: true, children: TERMINAL_FACES[m.mood] ?? TERMINAL_FACES.idle })]
    if (line) {
      children.push(el.Text({ dimColor: true, ...(line.warning ? { color: 'warning' } : {}), children: line.text }))
      children.push(el.Button({ key: line.action === 'undo' ? 'undo-close' : 'open-pane', label: line.label, plain: true, dimColor: true, onPress: press }))
    }
    return el.Box({ flexDirection: 'row', alignItems: 'center', gap: 1, children })
  }
  const chispa = el.Svg({ source: chispaSvg(m.mood), alt: MOOD_LABELS[m.mood] ?? MOOD_LABELS.idle, width: 44, height: 37 })
  const card = bandCard(m)
  if (!card) return el.Box({ flexDirection: 'row', alignItems: 'center', gap: 1, children: [chispa] })
  const run = target => (target.action === 'doNow' ? actions.doNow(target.id) : target.action === 'undo' ? actions.undoClose() : actions.openPane())
  const side = []
  if (card.button) {
    side.push(el.Button({ key: 'band-act', label: card.button.label, variant: 'primary', dimColor: card.button.action === 'doNow' && m.working, onPress: () => run(card.button) }))
  }
  if (card.link) {
    const href = card.link.action === 'undo' ? UNDO_HREF : OPEN_PANE_HREF
    side.push(el.Markdown({ key: 'band-line', text: `[${card.link.label}](${href})`, pressableLinks: [href], onLinkPress: () => run(card.link) }))
  }
  // a live card: the border says the state, the fill sets it apart from the transcript
  return el.Box({
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    borderStyle: 'round',
    borderColor: card.border,
    backgroundColor: 'userMessageBackground',
    paddingX: 1,
    children: [
      chispa,
      el.Box({ flexDirection: 'column', flexGrow: 1, flexShrink: 1, minWidth: 0, children: [cardTop(el, card.top), cardBottom(el, card.bottom)] }),
      el.Box({ flexDirection: 'column', alignItems: 'flex-end', children: side }),
    ],
  })
}

// The first verbatim occurrence of `quote` in a message's markdown, in bold; the text as it was when it is not there.
export function emphasize(text, quote) {
  if (!quote) return text
  const at = text.indexOf(quote)
  return at === -1 ? text : `${text.slice(0, at)}**${quote}**${text.slice(at + quote.length)}`
}

const SAID = {
  saved: card => `Guardado en ${card.repoName}`,
  rejected: () => 'Descartado. No volveré a proponer cosas así.',
  closed: card => `Cerrado con prueba${card.item.proof?.commit ? ` · ${card.item.proof.commit}` : ''}`,
  kept: () => 'Sigue abierto.',
}

// The card under the message where a candidate or a proposed closure was born.
export function renderTriage(el, surface, card, actions) {
  const { item } = card
  const id = item.id
  if (card.state) {
    return el.Box({
      key: `triage-${id}`,
      flexDirection: 'row',
      gap: 1,
      children: [el.Text({ dimColor: true, children: SAID[card.state](card) }), el.Button({ key: `tri-undo-${id}`, label: 'Deshacer', plain: true, onPress: () => actions.undo(id) })],
    })
  }
  if (card.kind === 'proposal') {
    const head = ['¿Resuelto?', item.proposal?.commit ? `commit ${item.proposal.commit}` : ''].filter(Boolean).join(' · ')
    return framed(el, `triage-${id}`, 'success', [
      el.Text({ color: 'success', children: head }),
      el.Text({ wrap: 'wrap', children: item.text }),
      el.Text({ dimColor: true, italic: true, wrap: 'wrap', children: `Prueba: «${card.quote}»` }),
      buttons(el, [
        el.Button({ key: `tri-confirm-${id}`, label: 'Sí, cerrar', variant: 'primary', onPress: () => actions.confirm(id) }),
        el.Button({ key: `tri-keep-${id}`, label: 'Sigue abierto', onPress: () => actions.keep(id) }),
      ]),
    ])
  }
  const head = ['Cabo candidato', item.category, PRIORITY_WORD[item.priority] ?? 'normal'].filter(Boolean).join(' · ')
  const parts = [el.Text({ color: 'warning', children: head }), el.Text({ wrap: 'wrap', children: item.text })]
  if (card.editing && surface !== 'mobile') {
    parts.push(el.Input({ key: `tri-edit-input-${id}`, value: item.text, submitLabel: 'guardar', onSubmit: value => actions.saveEdited(id, value) }))
  } else {
    const row = [
      el.Button({ key: `tri-save-${id}`, label: 'Guardar', variant: 'primary', onPress: () => actions.save(id) }),
      el.Button({ key: `tri-reject-${id}`, label: 'No es un cabo', onPress: () => actions.reject(id) }),
    ]
    if (surface !== 'mobile') row.push(el.Button({ key: `tri-edit-${id}`, label: 'Editar', plain: true, onPress: () => actions.startEdit(id) }))
    parts.push(buttons(el, row))
  }
  return framed(el, `triage-${id}`, 'claude', parts)
}

// The dot of an item: low priority has no color of its own, it is only dim.
const DOT = { high: { color: 'error' }, medium: { color: 'warning' }, low: { dimColor: true } }

export function ago(iso, now) {
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const min = Math.max(0, Math.round(ms / 60000))
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} d`
}

// A section title: bold, then the count in dim.
function heading(el, title, count) {
  return el.Box({ flexDirection: 'row', gap: 2, children: [el.Text({ bold: true, children: title }), el.Text({ dimColor: true, children: String(count) })] })
}

// A section: its title and its rows, one row of air between them.
function section(el, title, count, rows) {
  return el.Box({ flexDirection: 'column', gap: 1, children: [heading(el, title, count), ...rows] })
}

// Every item is a card, in the pane and under a message: a round border in a theme color, so it follows the
// app's light or dark theme.
const framed = (el, key, borderColor, children) => el.Box({ key, flexDirection: 'column', borderStyle: 'round', borderColor, paddingX: 1, children })

// A row that may wrap: air between its items, none between its lines, or a wrapped row opens a wide hole.
const buttons = (el, children) => el.Box({ flexDirection: 'row', columnGap: 1, flexWrap: 'wrap', children })

// Where the ref stands, after a dot that says it at a glance.
const SYNC = {
  synced: { dot: { color: 'success' }, text: { dimColor: true, children: 'Al día con origin' } },
  local: { dot: { dimColor: true }, text: { dimColor: true, children: 'Solo en este ordenador' } },
  ahead: { dot: { color: 'warning' }, text: { dimColor: true, children: 'Cambios sin subir' } },
  failed: { dot: { color: 'error' }, text: { color: 'warning', children: 'No se pudieron subir a origin' } },
}

function syncLine(el, m, actions) {
  const said = SYNC[m.sync]
  if (!said) return null
  const parts = [el.Text({ ...said.dot, children: '●' }), el.Text(said.text)]
  if (m.sync === 'ahead' || m.sync === 'failed') parts.push(el.Button({ key: 'push-now', label: 'Subir', plain: true, onPress: () => actions.push() }))
  return el.Box({ flexDirection: 'row', gap: 1, children: parts })
}

function candidateRow(el, item, m, actions) {
  const meta = [item.category, ago(item.createdAt, m.now)].filter(Boolean).join(' · ')
  const parts = [el.Text({ wrap: 'wrap', children: item.text })]
  if (meta) parts.push(el.Text({ dimColor: true, children: meta }))
  if (item.evidence) parts.push(el.Text({ dimColor: true, italic: true, wrap: 'wrap', children: `«${item.evidence}»` }))
  parts.push(
    buttons(el, [
      el.Button({ key: `save-${item.id}`, label: 'Guardar', variant: 'primary', onPress: () => actions.save(item.id) }),
      el.Button({ key: `reject-${item.id}`, label: 'No es un cabo', onPress: () => actions.reject(item.id) }),
    ]),
  )
  return framed(el, `cand-${item.id}`, 'claude', parts)
}

// What sits under the text of an open item, indented past its dot.
const under = (el, children) => el.Box({ flexDirection: 'row', columnGap: 1, flexWrap: 'wrap', paddingLeft: 2, children })

function liveRow(el, surface, item, m, actions) {
  const editable = surface !== 'mobile'
  const id = item.id
  const meta = [item.category, ago(item.createdAt, m.now), item.branch && item.branch !== m.branch ? `nació en ${item.branch}` : '', item.status === 'doing' ? 'en curso' : '']
    .filter(Boolean)
    .join(' · ')
  const parts = []
  if (editable && m.editing === id) {
    parts.push(el.Input({ key: `edit-input-${id}`, value: item.text, submitLabel: 'guardar', onSubmit: value => actions.saveEdited(id, value) }))
  } else {
    parts.push(el.Box({ flexDirection: 'row', gap: 1, children: [el.Text({ ...(DOT[item.priority] ?? DOT.medium), children: '●' }), el.Text({ wrap: 'wrap', children: item.text })] }))
  }
  // what is said about it, then the file as a chip, the way code is set apart in the transcript
  const line = []
  if (meta) line.push(el.Text({ dimColor: true, wrap: 'wrap', children: meta }))
  if (item.file) line.push(el.Text({ backgroundColor: 'userMessageBackground', children: ` ${item.file} ` }))
  if (line.length) parts.push(under(el, line))
  if (item.proposal) {
    const head = ['¿Resuelto?', item.proposal.commit ? `commit ${item.proposal.commit}` : ''].filter(Boolean).join(' · ')
    parts.push(under(el, [el.Text({ color: 'success', children: head })]))
    parts.push(under(el, [el.Text({ dimColor: true, italic: true, wrap: 'wrap', children: `Prueba: «${item.proposal.quote}»` })]))
    parts.push(
      under(el, [
        el.Button({ key: `confirm-${id}`, label: 'Sí, cerrar', variant: 'primary', onPress: () => actions.confirm(id) }),
        el.Button({ key: `keep-${id}`, label: 'Sigue abierto', onPress: () => actions.keep(id) }),
      ]),
    )
  }
  if (item.stale) {
    parts.push(under(el, [el.Text({ color: 'warning', children: '¿Sigue vigente?' }), el.Button({ key: `fresh-${id}`, label: 'Sí', plain: true, onPress: () => actions.keepFresh(id) })]))
  }
  // the controls on one row: the actions, then the priority word that cycles and editar, quieter
  const controls = [
    el.Button({ key: `now-${id}`, label: 'Hacer', variant: 'primary', dimColor: m.working, onPress: () => actions.doNow(id) }),
    el.Button({ key: `done-${id}`, label: 'Hecho', onPress: () => actions.done(id) }),
    el.Button({ key: `dismiss-${id}`, label: 'Descartar', plain: true, onPress: () => actions.dismiss(id) }),
    el.Button({ key: `prio-${id}`, label: PRIORITY_WORD[item.priority] ?? 'normal', plain: true, dimColor: true, onPress: () => actions.cyclePriority(id) }),
  ]
  if (editable) controls.push(el.Button({ key: `edit-${id}`, label: 'editar', plain: true, dimColor: true, onPress: () => actions.startEdit(id) }))
  parts.push(under(el, controls))
  return framed(el, `item-${id}`, 'promptBorder', parts)
}

// One line per closed item: the text is cut to fit, so the check, the proof and ↺ always show.
function closedRow(el, item, actions) {
  const proof = item.proof?.commit ?? (item.proof ? 'con prueba' : '')
  const dismissed = item.status === 'dismissed'
  const parts = [
    el.Text({ ...(dismissed ? { dimColor: true } : { color: 'success' }), children: '✓' }),
    el.Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, children: [el.Text({ wrap: 'truncate-end', dimColor: dismissed, strikethrough: dismissed, children: item.text })] }),
  ]
  if (proof) parts.push(el.Text({ dimColor: true, children: proof }))
  parts.push(el.Button({ key: `reopen-${item.id}`, label: '↺', plain: true, dimColor: true, onPress: () => actions.reopen(item.id) }))
  return el.Box({ key: `closed-${item.id}`, flexDirection: 'row', gap: 1, children: parts })
}

export function renderPane(el, surface, m, actions) {
  const out = []
  if (m.fileError) out.push(el.Text({ color: 'warning', wrap: 'wrap', children: `No puedo leer los cabos de ${m.repoPath} (refs/loose-ends): ${m.fileError}. El panel se recupera solo en cuanto se puedan leer.` }))
  if (m.noRepo) {
    out.push(el.Text({ dimColor: true, children: 'Esta sesión no está dentro de un repo git.' }))
    return el.Box({ flexDirection: 'column', children: out })
  }
  // the pane's own title already says Cuaderno: the header names the repo and where its ref stands
  const sync = syncLine(el, m, actions)
  out.push(el.Box({ flexDirection: 'column', children: [el.Text({ bold: true, children: m.repoName }), ...(sync ? [sync] : [])] }))
  if (m.notice) {
    out.push(
      el.Box({
        flexDirection: 'row',
        gap: 1,
        children: [
          el.Box({ flexGrow: 1, flexShrink: 1, children: [el.Text({ dimColor: true, wrap: 'wrap', children: m.notice })] }),
          el.Button({ key: 'notice-ok', label: 'Entendido', plain: true, onPress: () => actions.dismissNotice() }),
        ],
      }),
    )
  }
  if (surface !== 'mobile') out.push(el.Input({ key: 'add-item', placeholder: 'Apuntar un cabo…', submitLabel: 'apuntar', onSubmit: value => actions.add(value) }))

  if (m.waiting.length) out.push(section(el, 'Por revisar', m.waiting.length, m.waiting.map(item => candidateRow(el, item, m, actions))))

  const open = m.live.length ? m.live.map(item => liveRow(el, surface, item, m, actions)) : [el.Text({ dimColor: true, children: 'Nada abierto en este repo.' })]
  out.push(section(el, 'Abiertos', m.live.length, open))

  if (m.closed.length) {
    out.push(el.Box({ flexDirection: 'column', children: [heading(el, 'Cerrados esta semana', m.closed.length), ...m.closed.map(item => closedRow(el, item, actions))] }))
  }
  if (m.learned) out.push(el.Text({ dimColor: true, children: `El barrido aprende de ${plural(m.learned, 'descarte tuyo', 'descartes tuyos')}` }))
  return el.Box({ flexDirection: 'column', gap: 1, children: out })
}

// When the last session saw the repo, in words: «hace un rato» the same day, «ayer», or the date.
export function sinceText(iso, now) {
  const then = new Date(iso)
  if (!Number.isFinite(then.getTime())) return 'la última vez'
  const day = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(new Date(now)) - day(then)) / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'hace un rato'
  if (days === 1) return 'ayer'
  return `el ${String(then.getDate()).padStart(2, '0')}/${String(then.getMonth() + 1).padStart(2, '0')}`
}
