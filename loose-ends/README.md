# loose-ends

The session's notebook for Claude Code, with Chispa. English and Spanish.

- **Candidates, not loose ends.** What Claude leaves undone (a bug it sees,
  debt, a test it skips, a warning it ignores, an out-of-scope improvement)
  arrives as a candidate. Claude proposes it with the `note_loose_end` tool and
  a category (bug, debt, test, warning, improvement), and Haiku
  (`claude-haiku-4-5-20251001`) proposes it after every answer of 500
  characters or more, quoting the sentence literally. Before that, a fixed
  filter drops what is not work on the code (checking, trying, running,
  waiting, deciding, notifying, pushing or merging, deploying, sending to third
  parties) in English and in Spanish, repeats, and anything like what you
  already rejected. In English, the verbs verify, confirm, wait, decide,
  inform, notify, ask and tell drop a sentence on their own; the ambiguous
  ones (push, deploy, check, run, test, review, report, watch, monitor) only
  with their second word ("push to", "check that", "run the tests"), so "check
  the null case in parse()" is still work. From the sweep it also drops what
  the whole sentence says is done, what it says is already being done, what it
  leaves to you as a decision, and what looks like something already waiting.
  The sweep never proposes urgent ones, and what is put off on purpose
  ("later", "phase 5") arrives as low. If Claude already noted a loose end with
  the tool that turn, the sweep only looks for closures.
- **You decide.** The candidate appears under the Claude message where it was
  born, with the sentence in bold, and `Save`, `Not a loose end` or `Edit`.
  What you do not review waits in the Notebook and expires after 7 days. What
  the sweep proposes waits one turn before showing, longer while subagents work
  (up to 30 minutes). If a later answer, or the subject of a commit of the
  turn, shows it done, it goes away by itself: the card says "Withdrawn:
  resolved later" with `Undo`, and `↺` in Closed this week brings it back to
  review. Every "Not a loose end" teaches the sweep: the last 20 go into its
  prompt.
- **Closing with proof.** Haiku never closes anything. If an answer shows a
  loose end done, it proposes "Resolved?" with the sentence that proves it and,
  if the turn made a commit, that commit; you confirm or say "Still open".
  After `Do it` it always reads the answer, long or short.
- **Where they live.** In the ref `refs/loose-ends/items` of the git repo each
  loose end belongs to, outside your branches. They do not show in
  `git status`, make no commits on your branch, and every worktree of the repo
  sees the same list. With `origin`, they are fetched when a session starts and
  pushed after a `git push` Claude runs in the session: the first time it asks,
  and `Always` or `Never` is kept in `git config loose-ends.sync`. If you push
  from your own terminal, the Notebook offers `Push`. Closed loose ends are
  deleted 30 days after closing, and the 50 newest rejected are kept. Outside a
  git repo nothing is stored (never in `~/.claude/`).
- **The band** above the prompt, with Chispa. On the desktop it is a card; the
  first that applies wins: the loose ends cannot be read (red border, `View`);
  candidates to review (orange border, `Review`); a loose end just closed
  (green border, what is left, `Do it` on the next one and `Undo`); what
  changed since the last session; otherwise the next loose end (the most
  urgent; at equal priority the one in progress, then the oldest) with `Do it`
  to start it, how many there are of each priority and whether they are pushed
  to origin, with a red border when it is urgent. If you press `Do it` while
  Claude is answering, a toast says "I'll start it when Claude finishes" and
  the loose end starts 500 ms after the turn ends. With nothing open, Chispa
  says a short phrase that depends on whether Claude is working, whether she is
  asleep, how many you closed this week and the time of day. In the terminal,
  one line: `Can't read the loose ends · View`, `N to review · Review`,
  `Urgent: … · View`, `Closed: … · Undo`, `Since yesterday: … · View`,
  `N open · View`, or Chispa's phrase.
- **Chispa** carries the signal: she holds a note when there are candidates,
  worries about an urgent one, celebrates a close or a successful
  `git commit`, works during the turn, and only sleeps after 30 quiet minutes
  with nothing pending.
- **The Notebook** (`/loose-ends` in English, `/pendientes` in Spanish, or the
  band's action; the pane is called "Notebook" in English and "Cuaderno" in
  Spanish): To review, Open (the priority changes with a tap, `edit`,
  `Do it`, `Done`, `Dismiss`, and "Still relevant?" after 14 days without
  changes) and Closed this week with `↺`. The field at the top notes a loose
  end by hand. On mobile it looks the same, without text fields.
- **In passing.** When Claude reads or edits a file with open loose ends, it is
  reminded of them. With an urgent loose end open, not started, with no closure
  proposed and no candidates to review, it is offered in gray in the empty
  prompt instead of Claude Code's suggestion; `Tab` takes it.

Requires Claude Code 2.1.287 or later (tested with 2.1.288).

## Language

The `language` option: `auto` (default), `es` or `en`, in `/config`. With
`auto`, the first of `LC_ALL`, `LC_MESSAGES` and `LANG` that is set decides:
Spanish when it starts with `es`, English otherwise. The tool accepts the
categories in both languages (`debt`, `warning`, `improvement` are stored as
`deuda`, `aviso`, `mejora`), so loose ends written in one language read the
same in the other. The debug log is always in English.

## Install

    /plugin marketplace add MiguelProz/claude-loose-ends
    /plugin install loose-ends@claude-loose-ends
    /reload-plugins

## Update

Claude Code does not know there is a new version until it refreshes its copy
of the marketplace. First the marketplace, then the plugin:

    claude plugin marketplace update claude-loose-ends
    claude plugin update loose-ends@claude-loose-ends

## Coming from 0.3

The first session in each repo imports `.claude/loose-ends.json` into
`refs/loose-ends/items` and says so once in the Notebook. Then you can delete
the file with `git rm .claude/loose-ends.json`.

## Reading the loose ends by hand

    git show refs/loose-ends/items:loose-ends.json

What origin had the last time they were fetched or pushed is in
`refs/loose-ends/origin` (outside `refs/remotes`, so it does not show in
`git branch -r`). Neither shows on GitHub's web pages.

## Turning it off

`/plugin` → Installed → loose-ends. The data stays in `refs/loose-ends/items`
of each repo.
