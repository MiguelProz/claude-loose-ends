// Measures the sweep's deterministic gates against what it already proposed in a real repo: reads the items in
// refs/loose-ends/items, finds the answer each sweep candidate quoted in the session transcripts of that repo, and
// says which ones the filters of this version would drop now (whole sentence, banned opening) and with what
// priority the rest would arrive. Haiku is not called. A development check, not part of the mod.
//
//   node scripts/sweep-audit.mjs <repo> [transcripts dir]
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { REF } from '../loose-ends/lib/refstore.mjs'
import { parseItems } from '../loose-ends/lib/items.mjs'
import { containsQuote, sentenceAround, sentenceVerdict, sweepPriority } from '../loose-ends/lib/detect.mjs'
import { startsBanned } from '../loose-ends/lib/filter.mjs'

const repo = process.argv[2]
if (!repo) {
  console.error('Uso: node scripts/sweep-audit.mjs <repo> [carpeta de transcripts]')
  process.exit(2)
}
const top = spawnSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim()
if (!top) {
  console.error(`${repo} no es un repo git`)
  process.exit(2)
}
const blob = spawnSync('git', ['-C', top, 'show', `${REF}:loose-ends.json`], { encoding: 'utf8' })
const parsed = parseItems(blob.status === 0 ? blob.stdout : '')
if (!parsed.ok) {
  console.error(`No puedo leer ${REF} (${parsed.error})`)
  process.exit(1)
}

// Claude Code keeps a session's transcript under ~/.claude/projects/<path with / as ->/; the repo's worktrees
// (<repo>/.claude/worktrees/…) get folders that start with the same name, and their sessions count too.
const projects = join(homedir(), '.claude', 'projects')
const base = top.replace(/[/.]/g, '-')
const dirs = process.argv[3] ? [process.argv[3]] : existsSync(projects) ? readdirSync(projects).filter(n => n === base || n.startsWith(`${base}--`)).map(n => join(projects, n)) : []
const dir = dirs.length === 1 ? dirs[0] : `${dirs.length} carpetas de ${projects}`
const answers = []
for (const folder of dirs.filter(d => existsSync(d))) {
  for (const name of readdirSync(folder).filter(n => n.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(folder, name), 'utf8').split('\n')) {
      if (!line.includes('"assistant"')) continue
      try {
        const entry = JSON.parse(line)
        const content = entry?.message?.content
        if (entry.type !== 'assistant' || !Array.isArray(content)) continue
        const text = content.filter(c => c?.type === 'text').map(c => c.text).join('\n')
        if (text) answers.push(text)
      } catch {}
    }
  }
}

const sweepItems = parsed.items.filter(i => i.source === 'sweep' && i.evidence)
const rows = sweepItems.map(item => {
  const answer = answers.find(a => containsQuote(a, item.evidence))
  const sentence = answer ? sentenceAround(answer, item.evidence) : null
  const drop = startsBanned(item.text) ? 'no es trabajo sobre el código' : sentenceVerdict(sentence ?? item.evidence)
  return { item, found: Boolean(answer), drop, priority: sweepPriority(item.priority, sentence ?? item.evidence) }
})

const accepted = i => ['open', 'doing', 'done'].includes(i.status)
const dropped = rows.filter(r => r.drop)
console.log(`${top}: ${sweepItems.length} candidatos del barrido, ${sweepItems.filter(accepted).length} aceptados por ti`)
console.log(`Respuesta encontrada en los transcripts para ${rows.filter(r => r.found).length} (${answers.length} respuestas leídas en ${dir})`)
console.log(`El filtro nuevo descartaría ${dropped.length}: ${dropped.filter(r => !accepted(r.item)).length} que no aceptaste y ${dropped.filter(r => accepted(r.item)).length} que sí\n`)
for (const r of rows) {
  const mark = r.drop ? '✗' : '·'
  const was = accepted(r.item) ? 'aceptado' : r.item.status
  const prio = r.priority !== r.item.priority ? ` · ${r.item.priority}→${r.priority}` : ''
  console.log(`${mark} [${was}${prio}] ${r.item.text}${r.drop ? `\n    ${r.drop}` : ''}`)
}
