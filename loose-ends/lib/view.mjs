import { chispaSvg, MOOD_LABELS, TERMINAL_FACES } from './chispa.mjs'

export const DISMISS_REASONS = ['no aplica', 'ya estaba', '→ roadmap']
// The dot of an item: low priority has no color of its own, it is only dim.
const DOT = { high: { color: 'error' }, medium: { color: 'warning' }, low: { dimColor: true } }
const PRIORITY_BUTTONS = [
  { value: 'high', label: 'Urgente' },
  { value: 'medium', label: 'Normal' },
  { value: 'low', label: 'Baja' },
]

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

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

export function bandLine({ plan, counts }) {
  const parts = []
  if (counts.open) parts.push(`${plural(counts.open, 'pendiente', 'pendientes')}${counts.high ? ` (${plural(counts.high, 'urgente', 'urgentes')})` : ''}`)
  if (counts.queued) parts.push(`${counts.queued} en cola`)
  if (plan.total) parts.push(`plan ${plan.done}/${plan.total}`)
  return parts.join(' · ')
}

export function renderBand(el, surface, m, actions) {
  const face =
    surface === 'terminal'
      ? el.Text({ dimColor: true, children: TERMINAL_FACES[m.mood] ?? TERMINAL_FACES.idle })
      : el.Svg({ source: chispaSvg(m.mood), alt: MOOD_LABELS[m.mood] ?? MOOD_LABELS.idle, width: 28, height: 24, isInteractive: true })
  const children = [face]
  const line = bandLine(m)
  if (m.fileError) children.push(el.Text({ color: 'warning', dimColor: true, children: 'No puedo leer loose-ends.json' }))
  else if (line) children.push(el.Text({ dimColor: true, children: line }))
  if (m.fileError || line) children.push(el.Button({ key: 'open-pane', label: 'Ver', plain: true, dimColor: true, onPress: actions.openPane }))
  return el.Box({ flexDirection: 'row', alignItems: 'center', gap: 1, children })
}

// A section title: bold, then the count in dim.
function heading(el, title, count) {
  return el.Box({ flexDirection: 'row', gap: 2, children: [el.Text({ bold: true, children: title }), el.Text({ dimColor: true, children: String(count) })] })
}

function itemRow(el, item, m, actions) {
  const expanded = m.expanded === item.id
  const meta = [ago(item.createdAt, m.now), item.status === 'queued' ? 'en cola' : ''].filter(Boolean).join(' · ')
  const parts = [
    el.Box({ flexDirection: 'row', gap: 1, children: [el.Text({ ...(DOT[item.priority] ?? DOT.medium), children: '●' }), el.Text({ wrap: 'wrap', children: item.text })] }),
  ]
  if (meta) parts.push(el.Text({ dimColor: true, wrap: 'truncate-end', children: meta }))
  parts.push(
    el.Box({
      flexDirection: 'row',
      gap: 1,
      flexWrap: 'wrap',
      children: [
        el.Button({ key: `now-${item.id}`, label: 'Hacer', variant: 'primary', dimColor: m.working, onPress: () => actions.doNow(item.id) }),
        el.Button({ key: `done-${item.id}`, label: 'Hecho', onPress: () => actions.done(item.id) }),
        el.Button({ key: `more-${item.id}`, label: '···', plain: true, onPress: () => actions.toggleMore(item.id) }),
      ],
    }),
  )
  if (expanded) {
    if (item.evidence) parts.push(el.Text({ dimColor: true, italic: true, wrap: 'wrap', children: `«${item.evidence}»` }))
    parts.push(
      el.Box({
        flexDirection: 'row',
        gap: 1,
        flexWrap: 'wrap',
        children: [
          el.Button({ key: `queue-${item.id}`, label: 'Cola', onPress: () => actions.queue(item.id) }),
          el.Button({ key: `dismiss-${item.id}`, label: 'Descartar', onPress: () => actions.startDiscard(item.id) }),
          ...PRIORITY_BUTTONS.map(p =>
            el.Button({ key: `prio-${item.id}-${p.value}`, label: p.label, dimColor: item.priority === p.value, onPress: () => actions.setPriority(item.id, p.value) }),
          ),
        ],
      }),
    )
  }
  if (m.discarding === item.id) {
    parts.push(
      el.Box({
        flexDirection: 'row',
        gap: 1,
        children: [
          el.Select({ key: `reason-${item.id}`, label: 'Motivo', options: DISMISS_REASONS.map(value => ({ value })), onSelect: v => actions.dismiss(item.id, v) }),
          el.Input({ key: `reason-text-${item.id}`, placeholder: 'otro motivo', submitLabel: 'descartar', onSubmit: v => actions.dismiss(item.id, v.trim() || undefined) }),
        ],
      }),
    )
  }
  return el.Box({ key: `item-${item.id}`, flexDirection: 'column', marginBottom: 1, children: parts })
}

function closedRow(el, item, actions) {
  const label = `✓ cabo: ${item.text}${item.closedBy === 'sweep' ? ' (Haiku)' : ''}${item.reason ? ` — ${item.reason}` : ''}`
  return el.Box({
    key: `closed-${item.id}`,
    flexDirection: 'row',
    gap: 1,
    children: [
      el.Text({ dimColor: item.status === 'dismissed', strikethrough: item.status === 'dismissed', children: label }),
      el.Button({ key: `reopen-${item.id}`, label: '↺', dimColor: true, onPress: () => actions.reopen(item.id) }),
    ],
  })
}

export function renderPane(el, m, actions) {
  const out = []
  if (m.fileError) out.push(el.Text({ color: 'warning', children: `No puedo leer ${m.filePath ?? '.claude/loose-ends.json'} (${m.fileError}). Arréglalo y el panel se recupera solo.` }))

  const tasks = m.plan.items.filter(t => t.status !== 'deleted')
  const planBlock = () => {
    if (!tasks.length) return
    out.push(heading(el, 'Plan', `${m.plan.done} de ${m.plan.total}`))
    for (const t of tasks) {
      const mark = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '·'
      out.push(el.Text({ dimColor: t.status === 'completed', children: `${mark} ${t.subject}` }))
    }
  }

  if (m.noRepo) {
    planBlock()
    out.push(el.Text({ dimColor: true, children: 'Esta sesión no está dentro de un repo git.' }))
    return el.Box({ flexDirection: 'column', children: out })
  }

  out.push(heading(el, 'Pendientes', m.loose.length))
  if (!m.loose.length) out.push(el.Text({ dimColor: true, children: 'Nada pendiente en este repo.' }))
  for (const item of m.loose) out.push(itemRow(el, item, m, actions))
  if (m.others.length) {
    out.push(el.Button({ key: 'toggle-others', plain: true, label: `${m.showOthers ? '▾' : '▸'} Otras ramas  ${m.others.length}`, onPress: actions.toggleOthers }))
    if (m.showOthers) for (const item of m.others) out.push(el.Text({ dimColor: true, children: `● ${item.text}  [${item.branch}]` }))
  }

  planBlock()

  const doneCount = m.commits.length + m.closedToday.length
  if (doneCount) {
    out.push(el.Button({ key: 'toggle-done', plain: true, label: `${m.showDone ? '▾' : '▸'} Hecho hoy  ${doneCount}`, onPress: actions.toggleDone }))
    if (m.showDone) {
      for (const c of m.commits) out.push(el.Text({ children: `✓ ${c.hash} ${c.subject}` }))
      for (const item of m.closedToday) out.push(closedRow(el, item, actions))
    }
  }
  return el.Box({ flexDirection: 'column', children: out })
}
