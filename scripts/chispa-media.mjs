// Writes Chispa's six poses to media/chispa-<mood>.svg, for the README. Run it again when lib/chispa.mjs changes.
//
//   node scripts/chispa-media.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { MOODS, chispaSvg } from '../loose-ends/lib/chispa.mjs'

const dir = new URL('../media/', import.meta.url)
mkdirSync(dir, { recursive: true })
for (const mood of MOODS) {
  writeFileSync(new URL(`chispa-${mood}.svg`, dir), `${chispaSvg(mood)}\n`)
  console.log(`media/chispa-${mood}.svg`)
}
