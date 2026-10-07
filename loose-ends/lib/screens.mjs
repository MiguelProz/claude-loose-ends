import { TERMINAL_FACES, chispaSvg, moodLabel } from './chispa.mjs'
import { categoryWord, priorityWord, t, tn } from './i18n.mjs'

// The two hrefs of the band's link (band-line): with the first the pane opens, with the second the last close is undone.
export const OPEN_PANE_HREF = 'file:///loose-ends/ver'
export const UNDO_HREF = 'file:///loose-ends/deshacer'
const BAND_TEXT_MAX = 60
// The priorities the band counts, most urgent first.
const PRIORITY_ORDER = ['high', 'medium', 'low']
// Where the ref can stand against origin.
const SYNC_STATES = ['synced', 'ahead', 'failed', 'local']

export function clip(text, max = BAND_TEXT_MAX) {
  const s = String(text ?? '')
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

export function recapText(lang, { since, fresh, closed }) {
  const parts = [fresh ? tn(lang, 'recap.fresh', fresh) : '', closed ? tn(lang, 'recap.closed', closed) : ''].filter(Boolean)
  return t(lang, 'recap.since', { since, parts: parts.join(' · ') })
}

// What the terminal's line says, the first that applies: unreadable, to review, urgent, just closed, since last time, open.
export function bandLine(m) {
  const lang = m.lang
  if (m.fileError) return { text: t(lang, 'band.unreadable'), action: 'open', label: t(lang, 'action.view'), warning: true }
  const open = m.counts.live ? tn(lang, 'band.open', m.counts.live) : ''
  if (m.counts.candidates) {
    const review = t(lang, 'band.toReview', { n: m.counts.candidates })
    return { text: [review, open].filter(Boolean).join(' · '), action: 'open', label: t(lang, 'action.review') }
  }
  if (m.urgent) return { text: t(lang, 'band.urgent', { text: clip(m.urgent.text) }), action: 'open', label: t(lang, 'action.view') }
  if (m.justClosed) return { text: t(lang, 'band.closed', { text: clip(m.justClosed.text) }), action: 'undo', label: t(lang, 'action.undo') }
  if (m.recap && (m.recap.fresh || m.recap.closed)) return { text: recapText(lang, m.recap), action: 'open', label: t(lang, 'action.view') }
  if (open) return { text: open, action: 'open', label: t(lang, 'action.view') }
  return null
}

// What the desktop band says: a border color, the top line, the dim segments under it, the button and the link.
// The first that applies: unreadable, to review, just closed, since last time, the next loose end; nothing open, null.
export function bandCard(m) {
  const lang = m.lang
  const next = m.next
  const sync = SYNC_STATES.includes(m.sync) ? [{ text: t(lang, `band.sync.${m.sync}`) }] : []
  const doNext = next ? { label: t(lang, 'action.do'), action: 'doNow', id: next.id } : null
  const nextBorder = next?.priority === 'high' ? 'error' : 'promptBorder'
  if (m.fileError) {
    return { border: 'error', top: { text: t(lang, 'band.unreadable'), color: 'warning' }, bottom: [{ text: t(lang, 'band.unreadableHint') }], button: null, link: { label: t(lang, 'action.view'), action: 'open' } }
  }
  if (m.counts.candidates) {
    const bottom = [...(next ? [{ text: t(lang, 'band.next', { text: clip(next.text) }) }] : []), ...(m.counts.live ? [{ text: tn(lang, 'band.open', m.counts.live) }] : []), ...sync]
    return { border: 'claude', top: { text: tn(lang, 'band.waiting', m.counts.candidates) }, bottom, button: { label: t(lang, 'action.review'), action: 'open' }, link: null }
  }
  if (m.justClosed) {
    const bottom = next ? [{ text: tn(lang, 'band.left', m.counts.live) }, { text: t(lang, 'band.nextAfter', { text: clip(next.text) }) }] : [{ text: t(lang, 'band.nothingOpen') }]
    return { border: 'success', top: { text: t(lang, 'band.closed', { text: clip(m.justClosed.text) }) }, bottom, button: doNext, link: { label: t(lang, 'action.undo'), action: 'undo' } }
  }
  if (m.recap && (m.recap.fresh || m.recap.closed)) {
    const bottom = next ? [{ text: t(lang, 'band.next', { text: clip(next.text) }), priority: next.priority }] : [{ text: t(lang, 'band.nothingOpen') }]
    return { border: nextBorder, top: { text: recapText(lang, m.recap) }, bottom, button: doNext, link: { label: t(lang, 'band.notebook'), action: 'open' } }
  }
  if (!next) return null
  const label = next.status === 'doing' ? t(lang, 'band.doing') : next.priority === 'high' ? t(lang, 'band.urgentLabel') : t(lang, 'band.nextLabel')
  const byPriority = PRIORITY_ORDER.filter(p => m.counts[p]).map(p => ({ text: tn(lang, `band.count.${p}`, m.counts[p]), priority: p }))
  return {
    border: nextBorder,
    top: { text: clip(next.text, 120), priority: next.priority, ...(next.file ? { file: next.file } : {}) },
    bottom: [{ text: label }, ...byPriority, ...sync],
    button: doNext,
    link: { label: t(lang, 'band.notebook'), action: 'open' },
  }
}

// The top line of the card: the priority dot, the text cut to fit, and the file, dim.
function cardTop(el, top) {
  const parts = []
  if (top.priority) parts.push(dot(el, top.priority))
  parts.push(el.Box({ flexShrink: 1, minWidth: 0, children: [el.Text({ wrap: 'truncate-end', ...(top.color ? { color: top.color } : {}), children: top.text })] }))
  if (top.file) parts.push(el.Text({ dimColor: true, children: top.file }))
  return el.Box({ key: 'band-top', flexDirection: 'row', gap: 1, overflow: 'hidden', children: parts })
}

// The bottom line: the segments, dim, a dot before each one that names a priority, joined by «·».
function cardBottom(el, bottom) {
  const parts = []
  bottom.forEach((seg, i) => {
    if (i) parts.push(el.Text({ dimColor: true, children: '·' }))
    if (seg.priority) parts.push(dot(el, seg.priority))
    parts.push(el.Text({ dimColor: true, wrap: 'truncate-end', children: seg.text }))
  })
  return el.Box({ key: 'band-bottom', flexDirection: 'row', gap: 1, overflow: 'hidden', children: parts })
}

// What Chispa says when the band has nothing to show: the first that applies of Claude working, Chispa asleep, what
// was closed this week and the time of day. The variant goes by the day's number, so it changes once a day.
export function idlePhrase(m) {
  const lang = m.lang
  const variant = Math.abs(m.day ?? 0) % 2
  if (m.working) return t(lang, `idle.working.${variant}`)
  if (m.mood === 'sleeping') return t(lang, `idle.sleeping.${variant}`)
  if (m.closedWeek > 0) return tn(lang, `idle.week.${variant}`, m.closedWeek)
  const hour = m.hour ?? 12
  const part = hour >= 6 && hour < 14 ? 'morning' : hour >= 14 && hour < 21 ? 'afternoon' : 'night'
  return t(lang, `idle.${part}.${variant}`)
}

// The local hour and the number of the local calendar day, for idlePhrase.
export function localClock(now) {
  const d = new Date(now)
  return { hour: d.getHours(), day: Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / (24 * 60 * 60 * 1000)) }
}

export function renderBand(el, surface, m, actions) {
  if (surface === 'terminal') {
    const line = bandLine(m)
    const press = () => (line?.action === 'undo' ? actions.undoClose() : actions.openPane())
    const children = [el.Text({ dimColor: true, children: TERMINAL_FACES[m.mood] ?? TERMINAL_FACES.idle })]
    if (line) {
      children.push(el.Text({ dimColor: true, ...(line.warning ? { color: 'warning' } : {}), children: line.text }))
      children.push(el.Button({ key: line.action === 'undo' ? 'undo-close' : 'open-pane', label: line.label, plain: true, dimColor: true, onPress: press }))
    } else {
      children.push(el.Text({ dimColor: true, children: idlePhrase(m) }))
    }
    return el.Box({ flexDirection: 'row', alignItems: 'center', gap: 1, children })
  }
  const chispa = el.Svg({ source: chispaSvg(m.mood), alt: moodLabel(m.lang, m.mood), width: 44, height: 37 })
  const card = bandCard(m)
  const frame = { flexDirection: 'row', alignItems: 'center', gap: 1, borderStyle: 'round', backgroundColor: 'userMessageBackground', paddingX: 1 }
  if (!card) {
    // nothing waits: the same card, with Chispa's phrase in gray and nothing to press
    const phrase = el.Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, children: [el.Text({ dimColor: true, wrap: 'truncate-end', children: idlePhrase(m) })] })
    return el.Box({ ...frame, borderColor: 'promptBorder', children: [chispa, phrase] })
  }
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
    ...frame,
    borderColor: card.border,
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

// The one dim line of a card the person already answered.
function answeredText(lang, card) {
  const commit = card.item.proof?.commit ? ` · ${card.item.proof.commit}` : ''
  if (card.state === 'saved') return t(lang, 'triage.saved', { repo: card.repoName })
  if (card.state === 'rejected') return t(lang, 'triage.rejected')
  if (card.state === 'closed') return `${t(lang, 'triage.closed')}${commit}`
  if (card.state === 'kept') return t(lang, 'triage.kept')
  return `${t(lang, 'triage.withdrawn')}${commit}`
}

// «¿Resuelto?», with the commit when the proposal has one.
function resolvedHead(lang, proposal) {
  return [t(lang, 'triage.resolved'), proposal?.commit ? t(lang, 'triage.commit', { sha: proposal.commit }) : ''].filter(Boolean).join(' · ')
}

// The card under the message where a candidate or a proposed closure was born.
export function renderTriage(el, surface, card, actions) {
  const { item, lang } = card
  const id = item.id
  if (card.state) {
    return el.Box({
      key: `triage-${id}`,
      flexDirection: 'row',
      gap: 1,
      children: [el.Text({ dimColor: true, children: answeredText(lang, card) }), el.Button({ key: `tri-undo-${id}`, label: t(lang, 'action.undo'), plain: true, onPress: () => actions.undo(id) })],
    })
  }
  if (card.kind === 'proposal') {
    return framed(el, `triage-${id}`, 'success', [
      el.Text({ color: 'success', children: resolvedHead(lang, item.proposal) }),
      el.Text({ wrap: 'wrap', children: item.text }),
      el.Text({ dimColor: true, italic: true, wrap: 'wrap', children: t(lang, 'triage.proof', { quote: card.quote }) }),
      buttons(el, [
        el.Button({ key: `tri-confirm-${id}`, label: t(lang, 'action.confirmClose'), variant: 'primary', onPress: () => actions.confirm(id) }),
        el.Button({ key: `tri-keep-${id}`, label: t(lang, 'action.keepOpen'), onPress: () => actions.keep(id) }),
      ]),
    ])
  }
  const head = [t(lang, 'triage.candidate'), categoryWord(lang, item.category), priorityWord(lang, item.priority)].filter(Boolean).join(' · ')
  const parts = [el.Text({ color: 'warning', children: head }), el.Text({ wrap: 'wrap', children: item.text })]
  if (card.editing && surface !== 'mobile') {
    parts.push(el.Input({ key: `tri-edit-input-${id}`, value: item.text, submitLabel: t(lang, 'action.saveQuiet'), onSubmit: value => actions.saveEdited(id, value) }))
  } else {
    const row = [
      el.Button({ key: `tri-save-${id}`, label: t(lang, 'action.save'), variant: 'primary', onPress: () => actions.save(id) }),
      el.Button({ key: `tri-reject-${id}`, label: t(lang, 'action.reject'), onPress: () => actions.reject(id) }),
    ]
    if (surface !== 'mobile') row.push(el.Button({ key: `tri-edit-${id}`, label: t(lang, 'action.edit'), plain: true, onPress: () => actions.startEdit(id) }))
    parts.push(buttons(el, row))
  }
  return framed(el, `triage-${id}`, 'claude', parts)
}

// The dot of an item: low priority has no color of its own, it is only dim.
const DOT = { high: { color: 'error' }, medium: { color: 'warning' }, low: { dimColor: true } }
const dot = (el, priority) => el.Text({ ...(DOT[priority] ?? DOT.medium), children: '●' })

export function ago(lang, iso, now) {
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const min = Math.max(0, Math.round(ms / 60000))
  if (min < 1) return t(lang, 'ago.now')
  if (min < 60) return t(lang, 'ago.minutes', { n: min })
  const h = Math.round(min / 60)
  if (h < 24) return t(lang, 'ago.hours', { n: h })
  return t(lang, 'ago.days', { n: Math.round(h / 24) })
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

// Where the ref stands, after a dot that says it at a glance; a failed push is said in the warning color.
const SYNC_DOT = { synced: { color: 'success' }, local: { dimColor: true }, ahead: { color: 'warning' }, failed: { color: 'error' } }

function syncLine(el, m, actions) {
  if (!SYNC_STATES.includes(m.sync)) return null
  const text = t(m.lang, `pane.sync.${m.sync}`)
  const parts = [el.Text({ ...SYNC_DOT[m.sync], children: '●' }), el.Text(m.sync === 'failed' ? { color: 'warning', children: text } : { dimColor: true, children: text })]
  if (m.sync === 'ahead' || m.sync === 'failed') parts.push(el.Button({ key: 'push-now', label: t(m.lang, 'action.push'), plain: true, onPress: () => actions.push() }))
  return el.Box({ flexDirection: 'row', gap: 1, children: parts })
}

function candidateRow(el, item, m, actions) {
  const lang = m.lang
  const meta = [categoryWord(lang, item.category), ago(lang, item.createdAt, m.now)].filter(Boolean).join(' · ')
  const parts = [el.Text({ wrap: 'wrap', children: item.text })]
  if (meta) parts.push(el.Text({ dimColor: true, children: meta }))
  if (item.evidence) parts.push(el.Text({ dimColor: true, italic: true, wrap: 'wrap', children: t(lang, 'quote', { text: item.evidence }) }))
  parts.push(
    buttons(el, [
      el.Button({ key: `save-${item.id}`, label: t(lang, 'action.save'), variant: 'primary', onPress: () => actions.save(item.id) }),
      el.Button({ key: `reject-${item.id}`, label: t(lang, 'action.reject'), onPress: () => actions.reject(item.id) }),
    ]),
  )
  return framed(el, `cand-${item.id}`, 'claude', parts)
}

// What sits under the text of an open item, indented past its dot.
const under = (el, children) => el.Box({ flexDirection: 'row', columnGap: 1, flexWrap: 'wrap', paddingLeft: 2, children })

function liveRow(el, surface, item, m, actions) {
  const lang = m.lang
  const editable = surface !== 'mobile'
  const id = item.id
  const meta = [
    categoryWord(lang, item.category),
    ago(lang, item.createdAt, m.now),
    item.branch && item.branch !== m.branch ? t(lang, 'pane.bornIn', { branch: item.branch }) : '',
    item.status === 'doing' ? t(lang, 'pane.doing') : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const parts = []
  if (editable && m.editing === id) {
    parts.push(el.Input({ key: `edit-input-${id}`, value: item.text, submitLabel: t(lang, 'action.saveQuiet'), onSubmit: value => actions.saveEdited(id, value) }))
  } else {
    parts.push(el.Box({ flexDirection: 'row', gap: 1, children: [dot(el, item.priority), el.Text({ wrap: 'wrap', children: item.text })] }))
  }
  // what is said about it, then the file as a chip, the way code is set apart in the transcript
  const line = []
  if (meta) line.push(el.Text({ dimColor: true, wrap: 'wrap', children: meta }))
  if (item.file) line.push(el.Text({ backgroundColor: 'userMessageBackground', children: ` ${item.file} ` }))
  if (line.length) parts.push(under(el, line))
  if (item.proposal) {
    parts.push(under(el, [el.Text({ color: 'success', children: resolvedHead(lang, item.proposal) })]))
    parts.push(under(el, [el.Text({ dimColor: true, italic: true, wrap: 'wrap', children: t(lang, 'triage.proof', { quote: item.proposal.quote }) })]))
    parts.push(
      under(el, [
        el.Button({ key: `confirm-${id}`, label: t(lang, 'action.confirmClose'), variant: 'primary', onPress: () => actions.confirm(id) }),
        el.Button({ key: `keep-${id}`, label: t(lang, 'action.keepOpen'), onPress: () => actions.keep(id) }),
      ]),
    )
  }
  if (item.stale) {
    parts.push(under(el, [el.Text({ color: 'warning', children: t(lang, 'pane.stale') }), el.Button({ key: `fresh-${id}`, label: t(lang, 'action.yes'), plain: true, onPress: () => actions.keepFresh(id) })]))
  }
  // the controls on one row: the actions, then the priority word that cycles and edit, quieter
  const controls = [
    el.Button({ key: `now-${id}`, label: t(lang, 'action.do'), variant: 'primary', dimColor: m.working, onPress: () => actions.doNow(id) }),
    el.Button({ key: `done-${id}`, label: t(lang, 'action.done'), onPress: () => actions.done(id) }),
    el.Button({ key: `dismiss-${id}`, label: t(lang, 'action.dismiss'), plain: true, onPress: () => actions.dismiss(id) }),
    el.Button({ key: `prio-${id}`, label: priorityWord(lang, item.priority), plain: true, dimColor: true, onPress: () => actions.cyclePriority(id) }),
  ]
  if (editable) controls.push(el.Button({ key: `edit-${id}`, label: t(lang, 'action.editQuiet'), plain: true, dimColor: true, onPress: () => actions.startEdit(id) }))
  parts.push(under(el, controls))
  return framed(el, `item-${id}`, 'promptBorder', parts)
}

// One line per closed item: the text is cut to fit, so the check, the proof and ↺ always show.
function closedRow(el, item, lang, actions) {
  const withdrawn = item.status === 'expired' && item.withdrawn === true
  const commit = item.proof?.commit ? ` · ${item.proof.commit}` : ''
  const proof = withdrawn ? `${t(lang, 'pane.withdrawn')}${commit}` : item.proof?.commit ?? (item.proof ? t(lang, 'pane.withProof') : '')
  const dismissed = item.status === 'dismissed' || withdrawn
  const parts = [
    el.Text({ ...(dismissed ? { dimColor: true } : { color: 'success' }), children: '✓' }),
    el.Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, children: [el.Text({ wrap: 'truncate-end', dimColor: dismissed, strikethrough: dismissed, children: item.text })] }),
  ]
  // the proof never shrinks, so «con prueba» stays on the row's one line
  if (proof) parts.push(el.Box({ flexShrink: 0, children: [el.Text({ dimColor: true, children: proof })] }))
  parts.push(el.Button({ key: `reopen-${item.id}`, label: '↺', plain: true, dimColor: true, onPress: () => actions.reopen(item.id) }))
  return el.Box({ key: `closed-${item.id}`, flexDirection: 'row', gap: 1, children: parts })
}

export function renderPane(el, surface, m, actions) {
  const lang = m.lang
  const out = []
  if (m.fileError) out.push(el.Text({ color: 'warning', wrap: 'wrap', children: t(lang, 'pane.unreadable', { path: m.repoPath, error: m.fileError }) }))
  if (m.noRepo) {
    out.push(el.Text({ dimColor: true, children: t(lang, 'pane.noRepo') }))
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
          el.Button({ key: 'notice-ok', label: t(lang, 'action.gotIt'), plain: true, onPress: () => actions.dismissNotice() }),
        ],
      }),
    )
  }
  if (surface !== 'mobile') out.push(el.Input({ key: 'add-item', placeholder: t(lang, 'pane.addPlaceholder'), submitLabel: t(lang, 'pane.addSubmit'), onSubmit: value => actions.add(value) }))

  if (m.waiting.length) out.push(section(el, t(lang, 'pane.toReview'), m.waiting.length, m.waiting.map(item => candidateRow(el, item, m, actions))))

  const open = m.live.length ? m.live.map(item => liveRow(el, surface, item, m, actions)) : [el.Text({ dimColor: true, children: t(lang, 'pane.nothingOpen') })]
  out.push(section(el, t(lang, 'pane.open'), m.live.length, open))

  if (m.closed.length) {
    out.push(el.Box({ flexDirection: 'column', children: [heading(el, t(lang, 'pane.closedWeek'), m.closed.length), ...m.closed.map(item => closedRow(el, item, lang, actions))] }))
  }
  if (m.learned) out.push(el.Text({ dimColor: true, children: tn(lang, 'pane.learned', m.learned) }))
  return el.Box({ flexDirection: 'column', gap: 1, children: out })
}

// When the last session saw the repo, in words: «hace un rato» the same day, «ayer», or the date.
export function sinceText(lang, iso, now) {
  const then = new Date(iso)
  if (!Number.isFinite(then.getTime())) return t(lang, 'since.unknown')
  const day = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(new Date(now)) - day(then)) / (24 * 60 * 60 * 1000))
  if (days <= 0) return t(lang, 'since.recent')
  if (days === 1) return t(lang, 'since.yesterday')
  const pad = n => String(n).padStart(2, '0')
  const month = t(lang, 'since.months').split(' ')[then.getMonth()]
  return t(lang, 'since.date', { dd: pad(then.getDate()), mm: pad(then.getMonth() + 1), d: then.getDate(), month })
}
