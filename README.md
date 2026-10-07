# claude-loose-ends

**loose-ends** is a mod for [Claude Code](https://claude.com/claude-code): a notebook for the session, with Chispa.

While Claude works it leaves things behind: a bug it noticed and did not fix, a
test it skipped, a warning it ignored, an improvement that was out of scope.
loose-ends catches those as candidates, lets you decide which ones are worth
keeping, and keeps them in your repo without touching your branches. Chispa, a
small pixel companion above the prompt, tells you when something needs your
attention.

<p align="center"><img src="media/chispa-idle.svg" width="96" height="80" alt="Chispa watching"></p>

## What it does

- **Candidates, not tasks.** Claude proposes loose ends with the
  `note_loose_end` tool, and Claude Haiku reads every answer of 500 characters
  or more looking for work left undone, quoting the sentence literally. A fixed
  filter drops what is not work on the code (checking, waiting, deciding,
  pushing, deploying…), repeats, and anything like what you already rejected.
- **You decide.** A candidate appears under the Claude message where it was
  born, with the sentence in bold: **Save**, **Not a loose end** or **Edit**.
  What you do not review waits in the Notebook and expires after 7 days.
- **Closing needs proof.** Haiku never closes anything. When an answer (or a
  commit of the turn) shows a loose end done, it asks "Resolved?" with the
  sentence that proves it, and you confirm.
- **Stored in `refs/loose-ends`.** Loose ends live in the ref
  `refs/loose-ends/items` of the repo they belong to: no files in your working
  tree, no commits on your branches, the same list in every worktree. With an
  `origin`, they are fetched when a session starts and pushed after a
  `git push` Claude runs (it asks the first time).
- **The band.** Above the prompt, Chispa and one line: what waits for review,
  the next loose end with **Do it** to start it, what you just closed with
  **Undo**, or what changed since the last session. With nothing pending,
  Chispa says something short.
- **The Notebook.** `/loose-ends` (`/pendientes` in Spanish) opens the pane:
  To review, Open (change the priority, edit, Do it, Done, Dismiss) and Closed
  this week.

## Chispa

| | | |
|:-:|:-:|:-:|
| <img src="media/chispa-note.svg" width="96" height="80" alt="Chispa holding a note"> | <img src="media/chispa-worried.svg" width="96" height="80" alt="Chispa worried"> | <img src="media/chispa-celebrate.svg" width="96" height="80" alt="Chispa celebrating"> |
| Loose ends to review | Something urgent | A close or a commit |
| <img src="media/chispa-working.svg" width="96" height="80" alt="Chispa working"> | <img src="media/chispa-idle.svg" width="96" height="80" alt="Chispa watching"> | <img src="media/chispa-sleeping.svg" width="96" height="80" alt="Chispa sleeping"> |
| Claude is working | Watching | 30 quiet minutes |

## Requirements

Claude Code 2.1.287 or later (tested with 2.1.288). loose-ends is a mod: it is
written against Claude Code's mods API (function hooks), which is in early
access and may change between releases.

## Install

    /plugin marketplace add MiguelProz/claude-loose-ends
    /plugin install loose-ends@claude-loose-ends
    /reload-plugins

## Update

Claude Code only sees a new version after it refreshes its copy of the
marketplace. First the marketplace, then the plugin:

    claude plugin marketplace update claude-loose-ends
    claude plugin update loose-ends@claude-loose-ends

Inside Claude Code: `/plugin` → Marketplaces → claude-loose-ends →
`Update marketplace`, then Installed → loose-ends → update. The new version
loads when the session restarts. `Enable auto-update` in the same menu keeps
the marketplace fresh by itself.

## Language

English and Spanish. The `language` option takes `auto` (the default), `es`
or `en`; change it in `/config` (loose-ends → Language) and the mod reloads in
the new language. With `auto`, the first of `LC_ALL`, `LC_MESSAGES` and `LANG`
that is set decides and, on macOS, where none is (as in most desktop apps) the
system language does: Spanish when it starts with `es`, English otherwise. Set
the option to `es` or `en` to force a language. The
stored loose ends are the same in both languages.

## Privacy

- Loose ends are written to `refs/loose-ends/items` in the repo they belong
  to, plus a small `loose-ends-seen.json` in that repo's git directory (what the
  last session saw, to tell what changed). Nothing else is stored on your machine.
  Outside a git repo nothing is stored.
- If the repo has an `origin` and you allow it, that ref is pushed there. It
  does not show on GitHub's web pages, but anyone who can fetch the repo can
  read it.
- After a long answer, the mod asks Claude Haiku through Claude Code, the same
  way Claude Code calls any model: it sends the answer (up to 12,000
  characters), the texts of the open and waiting loose ends, the last ones you
  rejected, the subjects of the commits of the turn and, when another repo was
  touched, the paths of the candidate repos. Nothing is sent anywhere else.

## Uninstall

    /plugin uninstall loose-ends@claude-loose-ends

Your loose ends stay in each repo. To remove them from one:

    git update-ref -d refs/loose-ends/items
    git update-ref -d refs/loose-ends/origin
    git config --unset loose-ends.sync
    rm "$(git rev-parse --git-common-dir)/loose-ends-seen.json"
    git push origin --delete refs/loose-ends/items   # only if it was pushed

## Development

    claude --plugin-dir ./loose-ends
    cd loose-ends && claude plugin test && claude plugin validate . --strict
    node ../scripts/git-smoke.mjs
    node ../scripts/chispa-media.mjs
    node ../scripts/chispa-gallery.mjs /tmp/chispa.html
    node ../scripts/sweep-audit.mjs <repo>

`git-smoke.mjs` replays, with real git in a temporary folder with a remote and
two clones, the commands the mod runs on the ref, and prints `OK` or the step
that failed. `chispa-media.mjs` writes the poses above to `media/`.
`sweep-audit.mjs` checks the sweep candidates already in a repo against this
version's filters, without calling Haiku. More detail in
[loose-ends/README.md](loose-ends/README.md); changes in
[CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © 2026 Miguel Ángel Pérez García
