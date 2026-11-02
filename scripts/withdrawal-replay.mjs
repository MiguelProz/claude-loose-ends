// Replays the closure gate over the candidates a real repo already withdrew: finds the answer each proof quoted in the
// session transcripts of that repo and says which withdrawals this version would still make. Haiku is not called. A
// development check, not part of the mod. The same-turn rule cannot be replayed from here: transcripts are not joined
// to turns.
//
//   node scripts/withdrawal-replay.mjs <repo>
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { REF } from '../loose-ends/lib/refstore.mjs'
import { isWithdrawn, parseItems } from '../loose-ends/lib/items.mjs'
import { closureVerdict, containsQuote, sentenceAround } from '../loose-ends/lib/detect.mjs'

const top = spawnSync('git', ['-C', process.argv[2] ?? '.', 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim()
const parsed = parseItems(spawnSync('git', ['-C', top, 'show', `${REF}:loose-ends.json`], { encoding: 'utf8' }).stdout)
if (!parsed.ok) throw new Error(`cannot read ${REF}: ${parsed.error}`)

const projects = join(homedir(), '.claude', 'projects')
const base = top.replace(/[/.]/g, '-')
const answers = []
for (const name of readdirSync(projects).filter(n => n === base || n.startsWith(`${base}--`))) {
  for (const file of readdirSync(join(projects, name)).filter(n => n.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(projects, name, file), 'utf8').split('\n')) {
      if (!line.includes('"assistant"')) continue
      try {
        const entry = JSON.parse(line)
        if (entry.type !== 'assistant' || !Array.isArray(entry.message?.content)) continue
        const text = entry.message.content.filter(c => c?.type === 'text').map(c => c.text).join('\n')
        if (text) answers.push(text)
      } catch {}
    }
  }
}

const withdrawn = parsed.items.filter(isWithdrawn)
const counts = new Map()
for (const i of withdrawn) counts.set(i.proof?.quote, (counts.get(i.proof?.quote) ?? 0) + 1)
const rows = withdrawn.map(item => {
  const quote = item.proof?.quote ?? ''
  const answer = answers.find(a => containsQuote(a, quote))
  const sentence = answer ? sentenceAround(answer, quote) ?? quote : quote
  const reason = counts.get(quote) > 1 ? 'one sentence cannot prove two items' : closureVerdict({ ...item, status: 'candidate' }, sentence, { commit: !answer })
  return { item, quote, found: Boolean(answer), reason }
})
const kept = rows.filter(r => r.reason)
console.log(`${top}: ${withdrawn.length} withdrawn, answer found for ${rows.filter(r => r.found).length}; this version keeps ${kept.length} as candidates and still withdraws ${rows.length - kept.length}\n`)
const tally = new Map()
for (const r of kept) tally.set(r.reason, (tally.get(r.reason) ?? 0) + 1)
for (const [reason, n] of tally) console.log(`${n}  ${reason}`)
console.log('\nStill withdrawn:')
for (const r of rows.filter(r => !r.reason)) console.log(`- ${r.item.id} ${r.item.text.slice(0, 90)}\n    «${r.quote.slice(0, 140)}»${r.found ? '' : ' (answer not found)'}`)
