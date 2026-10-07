import { writeFileSync } from 'node:fs'
import { chispaSvg, moodLabel, MOODS } from '../loose-ends/lib/chispa.mjs'

const out = process.argv[2] ?? 'chispa-gallery.html'
const cards = MOODS.map(m => `<figure>${chispaSvg(m).replace('<svg ', '<svg style="width:192px;height:160px" ')}<figcaption>${moodLabel('en', m)}</figcaption></figure>`).join('')
writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Chispa</title><style>body{font:14px system-ui;display:flex;flex-wrap:wrap;gap:16px;padding:16px}figure{margin:0;padding:12px;border:1px solid #ccc;border-radius:12px;text-align:center}</style>${cards}`)
console.log(out)
