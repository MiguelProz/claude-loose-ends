# Changelog

## 0.5.0 — 2026-10-07

- English and Spanish. The `language` option (`auto`, `es`, `en`; `auto` by
  default) sets the language of the band, the Notebook, the cards under
  messages, the toasts and everything sent to Claude. `auto` follows `LC_ALL`,
  `LC_MESSAGES` and `LANG`: Spanish when the first one set starts with `es`,
  English otherwise.
- The `note_loose_end` tool and the sweep accept English category names
  (`debt`, `warning`, `improvement`) and store them under the existing keys.
- The filter knows English openings that are not work on the code and applies
  the English and Spanish lists whatever the language. The bare verbs verify,
  confirm, wait, decide, inform, notify, ask and tell drop a sentence on their
  own; the ambiguous ones (push, deploy, check, run, test, review, report,
  watch, monitor) only with their second word ("push to", "check that"), and
  the reason is given in the mod's language.
- With nothing open or waiting, the band shows Chispa with a short phrase: on
  watch while Claude works, napping, the loose ends closed this week, or one
  for the time of day.
- In English the Notebook command is `/loose-ends`; in Spanish it stays
  `/pendientes`.
- The debug log is in English.
- MIT license, English README and this changelog.

## 0.4.8 — 2026-10-07

- A bare "ya está" counts as done only at the end of the sentence.
- `sweep-audit` also reads the transcripts of the repo's worktrees.

## 0.4.7 — 2026-10-07

- The sweep holds its candidates back one turn (longer while subagents run, up
  to 30 minutes) and withdraws the ones a later answer shows done.
- The sweep reads the whole sentence around a quote, never proposes urgent
  loose ends, and sends what is put off on purpose as low.
- The subject of a commit of the turn counts as proof of a closure.

## 0.4.6 — 2026-10-06

- Do it pressed during a turn says it waits and starts the loose end 500 ms
  after the turn ends.

## 0.4.5 — 2026-10-06

- One priority order everywhere; an unknown priority counts as normal.
- "With proof" no longer wraps in the closed rows; "1 left" in the band.

## 0.4.4 — 2026-10-06

- The desktop band names the next loose end (the most urgent; at equal
  priority the one in progress, then the oldest) and starts it with Do it, with
  the count of each priority and whether the ref is pushed.

## 0.4.3 — 2026-10-06

- The desktop band is a card, with the key part in plain text.

## 0.4.2 — 2026-10-06

- Cards in the Notebook and under messages, in theme colors.

## 0.4.1 — 2026-10-06

- Every write prunes loose ends closed more than 30 days ago and keeps the 50
  newest rejected.
- The background push of the ref skips the repo's pre-push hooks; a fetch or
  push that times out shows that the push failed.
- The ref converges with origin when another session moves it at the same
  time; a smoke test runs the ref commands against real git.

## 0.4.0 — 2026-10-06

- Redesign: Claude and the sweep propose candidates that you confirm.
- Loose ends live in `refs/loose-ends/items`, out of the working tree, and
  travel to origin after your push; the 0.3 file is imported once.
- A closure needs proof that you confirm; a card under the message where a
  candidate was born; Chispa shows work.
- A fixed filter, loose ends anchored to files, a reminder when Claude touches
  a file with open loose ends, a recap of what changed since the last session,
  and the urgent loose end as the prompt's suggestion.

## 0.3.2 — 2026-10-04

- Chispa is drawn as an image, so her background is transparent.

## 0.3.1 — 2026-10-04

- The band fits in one row, Chispa has no white background, and View is a link
  on the same line.
- The evidence check ignores Markdown, quote styles and list markers.

## 0.3.0 — 2026-10-04

- A one-line band and a calm pane with one clear action per loose end.
- The sweep only notes real work: a literal quote, at most two per answer, and
  only from answers of 500 characters or more.
