import { chispaSvg, MOOD_LABELS, TERMINAL_FACES } from './chispa.mjs'

export const DISMISS_REASONS = ['no aplica', 'ya estaba', '→ roadmap']
const PRIORITY = {
  high: { label: 'ALTA', color: 'error' },
  medium: { label: 'MEDIA', color: 'warning' },
  low: { label: 'BAJA', color: 'inactive' },
}
const PRIORITY_OPTIONS = [
  { value: 'high', label: 'alta' },
  { value: 'medium', label: 'media' },
  { value: 'low', label: 'baja' },
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

export function progressBar(done, total, width = 15) {
  if (!total) return '░'.repeat(width)
  const filled = Math.min(width, Math.max(0, Math.round((done / total) * width)))
  return '━'.repeat(filled) + '░'.repeat(width - filled)
}

export function bandLine({ plan, counts }) {
  const parts = []
  if (plan.total) parts.push(`◐ plan ${plan.done}/${plan.total}`)
  if (counts.open) {
    const high = counts.high ? ` (${counts.high} ${counts.high === 1 ? 'alta' : 'altas'})` : ''
    parts.push(`⚠ ${counts.open} ${counts.open === 1 ? 'cabo' : 'cabos'}${high}`)
  }
  if (counts.queued) parts.push(`⏳ ${counts.queued} en cola`)
  return parts.join(' · ')
}

export function renderBand(el, surface, m, actions) {
  const face =
    surface === 'terminal'
      ? el.Text({ color: 'claude', bold: true, children: TERMINAL_FACES[m.mood] ?? TERMINAL_FACES.idle })
      : el.Svg({ source: chispaSvg(m.mood), alt: MOOD_LABELS[m.mood] ?? MOOD_LABELS.idle, width: 48, height: 40, isInteractive: true })
  const children = [face]
  const line = bandLine(m)
  if (m.fileError) children.push(el.Text({ color: 'warning', children: `pendientes ilegibles (${m.fileError}): revisa ${m.filePath ?? '.claude/loose-ends.json'}` }))
  else if (line) children.push(el.Text({ children: line }))
  children.push(el.Button({ key: 'open-pane', label: 'ver', dimColor: true, onPress: actions.openPane }))
  return el.Box({ flexDirection: 'row', alignItems: 'center', gap: 1, children })
}

function itemRow(el, item, m, actions) {
  const p = PRIORITY[item.priority] ?? PRIORITY.medium
  const meta = `${item.evidence ? `«${item.evidence}» · ` : ''}${ago(item.createdAt, m.now)}${item.status === 'queued' ? ' · en cola' : ''}`
  const parts = [
    el.Box({ flexDirection: 'row', gap: 1, children: [el.Text({ color: p.color, bold: true, children: `● ${p.label}` }), el.Text({ wrap: 'wrap', children: item.text })] }),
    el.Text({ dimColor: true, wrap: 'truncate-end', children: meta }),
    el.Box({
      flexDirection: 'row',
      gap: 1,
      flexWrap: 'wrap',
      children: [
        el.Button({ key: `now-${item.id}`, label: 'Hazlo ahora', variant: 'primary', dimColor: m.working, onPress: () => actions.doNow(item.id) }),
        el.Button({ key: `queue-${item.id}`, label: 'Cola', onPress: () => actions.queue(item.id) }),
        el.Button({ key: `done-${item.id}`, label: 'Hecho', onPress: () => actions.done(item.id) }),
        el.Button({ key: `dismiss-${item.id}`, label: 'Descartar', onPress: () => actions.startDiscard(item.id) }),
        el.Select({ key: `prio-${item.id}`, options: PRIORITY_OPTIONS, value: item.priority, onSelect: v => actions.setPriority(item.id, v) }),
      ],
    }),
  ]
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

export function renderPane(el, m, actions) {
  const title = text => el.Text({ bold: true, children: text })
  const out = []
  if (m.fileError) out.push(el.Text({ color: 'warning', children: `No puedo leer ${m.filePath ?? '.claude/loose-ends.json'} (${m.fileError}). Arréglalo y el panel se recupera solo.` }))

  out.push(title(`EN CURSO  ${progressBar(m.plan.done, m.plan.total)}  ${m.plan.done}/${m.plan.total}`))
  const tasks = m.plan.items.filter(t => t.status !== 'deleted')
  if (!tasks.length) out.push(el.Text({ dimColor: true, children: 'Sin plan en esta sesión.' }))
  for (const t of tasks) {
    const mark = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '·'
    out.push(el.Text({ dimColor: t.status === 'completed', children: `${mark} ${t.subject}` }))
  }

  if (m.noRepo) {
    out.push(el.Text({ dimColor: true, children: 'Esta sesión no está dentro de un repo git.' }))
    return el.Box({ flexDirection: 'column', children: out })
  }

  out.push(title(`CABOS SUELTOS  ${m.loose.length}`))
  if (!m.loose.length) out.push(el.Text({ dimColor: true, children: 'Nada colgando en esta rama.' }))
  for (const item of m.loose) out.push(itemRow(el, item, m, actions))
  if (m.others.length) {
    out.push(el.Button({ key: 'toggle-others', plain: true, label: `${m.showOthers ? '▾' : '▸'} Otras ramas (${m.others.length})`, onPress: actions.toggleOthers }))
    if (m.showOthers) for (const item of m.others) out.push(el.Text({ dimColor: true, children: `● ${item.text}  [${item.branch}]` }))
  }

  out.push(title(`HECHO HOY  ${m.commits.length + m.closedToday.length}`))
  for (const c of m.commits) out.push(el.Text({ children: `✓ ${c.hash} ${c.subject}` }))
  for (const item of m.closedToday) {
    const label = `✓ cabo: ${item.text}${item.closedBy === 'sweep' ? ' (Haiku)' : ''}${item.reason ? ` — ${item.reason}` : ''}`
    out.push(
      el.Box({
        key: `closed-${item.id}`,
        flexDirection: 'row',
        gap: 1,
        children: [
          el.Text({ dimColor: item.status === 'dismissed', strikethrough: item.status === 'dismissed', children: label }),
          el.Button({ key: `reopen-${item.id}`, label: '↺', dimColor: true, onPress: () => actions.reopen(item.id) }),
        ],
      }),
    )
  }
  return el.Box({ flexDirection: 'column', children: out })
}
