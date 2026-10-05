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
    children.push(el.Markdown({ key: 'band-line', dimColor: true, text: `${line.text} · [${line.label}](${href})`, pressableLinks: [href], onLinkPress: press }))
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
