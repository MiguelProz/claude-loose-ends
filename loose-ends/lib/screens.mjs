import { chispaSvg, MOOD_LABELS, TERMINAL_FACES } from './chispa.mjs'

// The pane opens, and the last close is undone, from links inside the band's one line of text, so the band
// stays a single native-looking row on the desktop.
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
  if (m.counts.candidates) return { text: [`${m.counts.candidates} por revisar`, open].filter(Boolean).join(' · '), action: 'open', label: 'Revisar' }
  if (m.urgent) return { text: `Urgente: ${clip(m.urgent.text)}`, action: 'open', label: 'Ver' }
  if (m.justClosed) return { text: `Cerrado: ${clip(m.justClosed.text)}`, action: 'undo', label: 'Deshacer' }
  if (m.recap && (m.recap.fresh || m.recap.closed)) return { text: recapText(m.recap), action: 'open', label: 'Ver' }
  if (open) return { text: open, action: 'open', label: 'Ver' }
  return null
}

// A text as literal Markdown: an item's text, which a model may write, cannot draw a link, an autolink or emphasis.
export function escapeMarkdown(text) {
  return String(text ?? '').replace(/[\\[\]()*_`<>]/g, '\\$&')
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
  const children = [el.Svg({ source: chispaSvg(m.mood), alt: MOOD_LABELS[m.mood] ?? MOOD_LABELS.idle, width: 24, height: 20 })]
  if (line) {
    const href = line.action === 'undo' ? UNDO_HREF : OPEN_PANE_HREF
    children.push(el.Markdown({ key: 'band-line', dimColor: true, text: `${escapeMarkdown(line.text)} · [${line.label}](${href})`, pressableLinks: [href], onLinkPress: press }))
  }
  return el.Box({ flexDirection: 'row', alignItems: 'center', gap: 1, children })
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
    return el.Box({
      key: `triage-${id}`,
      flexDirection: 'column',
      children: [
        el.Text({ color: 'success', children: head }),
        el.Text({ wrap: 'wrap', children: item.text }),
        el.Text({ dimColor: true, italic: true, wrap: 'wrap', children: `Prueba: «${card.quote}»` }),
        el.Box({
          flexDirection: 'row',
          gap: 1,
          flexWrap: 'wrap',
          children: [
            el.Button({ key: `tri-confirm-${id}`, label: 'Sí, cerrar', variant: 'primary', onPress: () => actions.confirm(id) }),
            el.Button({ key: `tri-keep-${id}`, label: 'Sigue abierto', onPress: () => actions.keep(id) }),
          ],
        }),
      ],
    })
  }
  const head = ['Cabo candidato', item.category, PRIORITY_WORD[item.priority] ?? 'normal'].filter(Boolean).join(' · ')
  const parts = [el.Text({ color: 'warning', children: head }), el.Text({ wrap: 'wrap', children: item.text })]
  if (card.editing && surface !== 'mobile') {
    parts.push(el.Input({ key: `tri-edit-input-${id}`, value: item.text, submitLabel: 'guardar', onSubmit: value => actions.saveEdited(id, value) }))
  } else {
    const buttons = [
      el.Button({ key: `tri-save-${id}`, label: 'Guardar', variant: 'primary', onPress: () => actions.save(id) }),
      el.Button({ key: `tri-reject-${id}`, label: 'No es un cabo', onPress: () => actions.reject(id) }),
    ]
    if (surface !== 'mobile') buttons.push(el.Button({ key: `tri-edit-${id}`, label: 'Editar', plain: true, onPress: () => actions.startEdit(id) }))
    parts.push(el.Box({ flexDirection: 'row', gap: 1, flexWrap: 'wrap', children: buttons }))
  }
  return el.Box({ key: `triage-${id}`, flexDirection: 'column', children: parts })
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

function syncLine(el, m, actions) {
  if (m.sync === 'synced') return el.Text({ dimColor: true, children: 'Al día con origin' })
  if (m.sync === 'local') return el.Text({ dimColor: true, children: 'Solo en este ordenador' })
  if (m.sync !== 'ahead' && m.sync !== 'failed') return null
  const said = m.sync === 'failed' ? el.Text({ color: 'warning', children: 'No se pudieron subir a origin' }) : el.Text({ dimColor: true, children: 'Cambios sin subir' })
  return el.Box({ flexDirection: 'row', gap: 1, children: [said, el.Button({ key: 'push-now', label: 'Subir', plain: true, onPress: () => actions.push() })] })
}

function candidateRow(el, item, m, actions) {
  const meta = [item.category, ago(item.createdAt, m.now)].filter(Boolean).join(' · ')
  const parts = [el.Text({ wrap: 'wrap', children: item.text })]
  if (meta) parts.push(el.Text({ dimColor: true, children: meta }))
  if (item.evidence) parts.push(el.Text({ dimColor: true, italic: true, wrap: 'wrap', children: `«${item.evidence}»` }))
  parts.push(
    el.Box({
      flexDirection: 'row',
      gap: 1,
      flexWrap: 'wrap',
      children: [
        el.Button({ key: `save-${item.id}`, label: 'Guardar', variant: 'primary', onPress: () => actions.save(item.id) }),
        el.Button({ key: `reject-${item.id}`, label: 'No es un cabo', onPress: () => actions.reject(item.id) }),
      ],
    }),
  )
  return el.Box({ key: `cand-${item.id}`, flexDirection: 'column', marginBottom: 1, children: parts })
}

function liveRow(el, surface, item, m, actions) {
  const editable = surface !== 'mobile'
  const id = item.id
  const meta = [item.category, ago(item.createdAt, m.now), item.file, item.branch && item.branch !== m.branch ? `nació en ${item.branch}` : '', item.status === 'doing' ? 'en curso' : '']
    .filter(Boolean)
    .join(' · ')
  const parts = []
  if (editable && m.editing === id) {
    parts.push(el.Input({ key: `edit-input-${id}`, value: item.text, submitLabel: 'guardar', onSubmit: value => actions.saveEdited(id, value) }))
  } else {
    parts.push(el.Box({ flexDirection: 'row', gap: 1, children: [el.Text({ ...(DOT[item.priority] ?? DOT.medium), children: '●' }), el.Text({ wrap: 'wrap', children: item.text })] }))
  }
  const line = [el.Button({ key: `prio-${id}`, label: PRIORITY_WORD[item.priority] ?? 'normal', plain: true, dimColor: true, onPress: () => actions.cyclePriority(id) })]
  if (meta) line.push(el.Text({ dimColor: true, children: meta }))
  if (editable) line.push(el.Button({ key: `edit-${id}`, label: 'editar', plain: true, dimColor: true, onPress: () => actions.startEdit(id) }))
  parts.push(el.Box({ flexDirection: 'row', gap: 1, flexWrap: 'wrap', children: line }))
  if (item.proposal) {
    const head = ['¿Resuelto?', item.proposal.commit ? `commit ${item.proposal.commit}` : ''].filter(Boolean).join(' · ')
    parts.push(el.Text({ color: 'success', children: head }))
    parts.push(el.Text({ dimColor: true, italic: true, wrap: 'wrap', children: `Prueba: «${item.proposal.quote}»` }))
    parts.push(
      el.Box({
        flexDirection: 'row',
        gap: 1,
        flexWrap: 'wrap',
        children: [
          el.Button({ key: `confirm-${id}`, label: 'Sí, cerrar', variant: 'primary', onPress: () => actions.confirm(id) }),
          el.Button({ key: `keep-${id}`, label: 'Sigue abierto', onPress: () => actions.keep(id) }),
        ],
      }),
    )
  }
  if (item.stale) {
    parts.push(
      el.Box({
        flexDirection: 'row',
        gap: 1,
        children: [el.Text({ color: 'warning', children: '¿Sigue vigente?' }), el.Button({ key: `fresh-${id}`, label: 'Sí', plain: true, onPress: () => actions.keepFresh(id) })],
      }),
    )
  }
  parts.push(
    el.Box({
      flexDirection: 'row',
      gap: 1,
      flexWrap: 'wrap',
      children: [
        el.Button({ key: `now-${id}`, label: 'Hacer', variant: 'primary', dimColor: m.working, onPress: () => actions.doNow(id) }),
        el.Button({ key: `done-${id}`, label: 'Hecho', onPress: () => actions.done(id) }),
        el.Button({ key: `dismiss-${id}`, label: 'Descartar', plain: true, onPress: () => actions.dismiss(id) }),
      ],
    }),
  )
  return el.Box({ key: `item-${id}`, flexDirection: 'column', marginBottom: 1, children: parts })
}

function closedRow(el, item, actions) {
  const proof = item.proof?.commit ? ` · ${item.proof.commit}` : item.proof ? ' · con prueba' : ''
  const dismissed = item.status === 'dismissed'
  return el.Box({
    key: `closed-${item.id}`,
    flexDirection: 'row',
    gap: 1,
    children: [
      el.Text({ dimColor: dismissed, strikethrough: dismissed, children: `✓ ${item.text}${proof}` }),
      el.Button({ key: `reopen-${item.id}`, label: '↺', plain: true, dimColor: true, onPress: () => actions.reopen(item.id) }),
    ],
  })
}

export function renderPane(el, surface, m, actions) {
  const out = []
  if (m.fileError) out.push(el.Text({ color: 'warning', wrap: 'wrap', children: `No puedo leer los cabos de ${m.repoPath} (refs/loose-ends): ${m.fileError}. El panel se recupera solo en cuanto se puedan leer.` }))
  if (m.noRepo) {
    out.push(el.Text({ dimColor: true, children: 'Esta sesión no está dentro de un repo git.' }))
    return el.Box({ flexDirection: 'column', children: out })
  }
  const sync = syncLine(el, m, actions)
  out.push(el.Box({ flexDirection: 'row', gap: 2, flexWrap: 'wrap', children: [el.Text({ bold: true, children: 'Cuaderno' }), el.Text({ dimColor: true, children: m.repoName }), ...(sync ? [sync] : [])] }))
  if (m.notice) out.push(el.Text({ dimColor: true, wrap: 'wrap', children: m.notice }))
  if (surface !== 'mobile') out.push(el.Input({ key: 'add-item', placeholder: 'Apuntar un cabo…', submitLabel: 'apuntar', onSubmit: value => actions.add(value) }))

  if (m.waiting.length) {
    out.push(heading(el, 'Por revisar', m.waiting.length))
    for (const item of m.waiting) out.push(candidateRow(el, item, m, actions))
  }

  out.push(heading(el, 'Abiertos', m.live.length))
  if (!m.live.length) out.push(el.Text({ dimColor: true, children: 'Nada abierto en este repo.' }))
  for (const item of m.live) out.push(liveRow(el, surface, item, m, actions))

  if (m.closed.length) {
    out.push(heading(el, 'Cerrados esta semana', m.closed.length))
    for (const item of m.closed) out.push(closedRow(el, item, actions))
  }
  if (m.learned) out.push(el.Text({ dimColor: true, children: `El barrido aprende de ${plural(m.learned, 'descarte tuyo', 'descartes tuyos')}` }))
  return el.Box({ flexDirection: 'column', children: out })
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
