// Replays against real git the commands loose-ends builds in lib/refstore.mjs: a bare remote and two clones in a
// temporary folder, the data ref created, pushed, fetched, adopted, pushed again, and a stale lease refused. Both
// clones have a pre-push hook that always fails, as a repo with husky tests can: the ref's push must skip it.
// Prints OK, or the step that failed, and exits non-zero on failure. A development check, not part of the mod.
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FETCH_ARGS, GIT_ENV, HASH_ARGS, NET_ENV, REF, REMOTE_REF, TREE_ARGS,
  blobArgs, commitArgs, firstLine, mergeItems, pushArgs, shaArgs, trackArgs, treeInput, updateArgs,
} from '../loose-ends/lib/refstore.mjs'
import { parseItems, serializeItems } from '../loose-ends/lib/items.mjs'

const dir = mkdtempSync(join(tmpdir(), 'loose-ends-smoke-'))
const remote = join(dir, 'origin.git')
const cloneA = join(dir, 'a')
const cloneB = join(dir, 'b')
let step = ''

// One git call as register.mjs makes it: `git -C <dir> <args>`, with stdin and variables over the environment.
function git(cwd, args, { input, env } = {}) {
  const r = spawnSync('git', ['-C', cwd, ...args], { input, env: { ...process.env, ...env }, encoding: 'utf8' })
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

function ok(r) {
  if (r.exitCode !== 0) throw new Error(`git salió con ${r.exitCode}: ${r.stderr.trim()}`)
  return r
}

function check(condition, what) {
  if (!condition) throw new Error(what)
}

function run(name, body) {
  step = name
  body()
}

// One write as writeRef does it: blob, tree, commit with its own identity, then the ref moved only from `prev`.
function write(cwd, list, prev) {
  const blob = firstLine(ok(git(cwd, HASH_ARGS, { input: serializeItems(list) })).stdout)
  const tree = firstLine(ok(git(cwd, TREE_ARGS, { input: treeInput(blob) })).stdout)
  const commit = firstLine(ok(git(cwd, commitArgs(tree, prev), { env: GIT_ENV })).stdout)
  return { commit, moved: git(cwd, updateArgs(commit, prev)).exitCode === 0 }
}

function read(cwd, ref = REF) {
  const sha = firstLine(ok(git(cwd, shaArgs(ref))).stdout)
  const parsed = parseItems(ok(git(cwd, blobArgs(sha))).stdout)
  check(parsed.ok, `el blob de ${ref} no se puede leer (${parsed.error})`)
  return { sha, items: parsed.items }
}

const shaAt = (cwd, ref = REF) => firstLine(git(cwd, shaArgs(ref)).stdout)
const ids = list => list.map(i => i.id).sort().join(',')
const item = (id, text) => ({ id, text, priority: 'medium', status: 'open', createdAt: '2026-10-06T10:00:00.000Z', updatedAt: '2026-10-06T10:00:00.000Z' })

try {
  run('crear el remoto y los dos clones', () => {
    ok(git(dir, ['init', '--quiet', '--bare', remote]))
    for (const clone of [cloneA, cloneB]) {
      ok(git(dir, ['init', '--quiet', clone]))
      ok(git(clone, ['remote', 'add', 'origin', remote]))
      const hook = join(clone, '.git', 'hooks', 'pre-push')
      writeFileSync(hook, '#!/bin/sh\necho "pre-push del repo" >&2\nexit 1\n')
      chmodSync(hook, 0o755)
    }
  })

  let first
  run('A crea la ref con el valor anterior vacío', () => {
    first = write(cloneA, [item('a1', 'Cabo de A')], null)
    check(first.moved, 'update-ref no creó la ref')
    check(ids(read(cloneA).items) === 'a1', 'la ref no tiene el cabo escrito')
  })

  run('con el valor anterior vacío no se pisa una ref que ya existe', () => {
    check(!write(cloneA, [item('x1', 'Otro')], null).moved, 'update-ref movió una ref que ya existía')
    check(shaAt(cloneA) === first.commit, 'la ref cambió')
  })

  run('con un valor anterior que no es el actual no se mueve la ref', () => {
    const stray = write(cloneA, [item('x2', 'Otro')], first.commit)
    check(stray.moved, 'update-ref no movió la ref desde su valor actual')
    check(!write(cloneA, [item('x3', 'Otro más')], first.commit).moved, 'update-ref movió la ref desde un valor viejo')
    // back to the first commit for the rest of the run
    ok(git(cloneA, updateArgs(first.commit, stray.commit)))
  })

  run('A sube su commit con el lease vacío (origin aún no tiene la ref)', () => {
    ok(git(cloneA, pushArgs(null, first.commit), { env: NET_ENV }))
    ok(git(cloneA, trackArgs(first.commit)))
    check(shaAt(remote) === first.commit, 'origin no tiene el commit subido')
  })

  run('B trae la ref de origin a su copia y lee el blob', () => {
    ok(git(cloneB, FETCH_ARGS, { env: NET_ENV }))
    const theirs = read(cloneB, REMOTE_REF)
    check(theirs.sha === first.commit && ids(theirs.items) === 'a1', 'la copia de origin no es lo que subió A')
  })

  run('la copia de origin no sale en git branch -r y fetch --prune no la borra', () => {
    check(ok(git(cloneB, ['branch', '-r'])).stdout.trim() === '', 'git branch -r enseña la copia')
    ok(git(cloneB, ['fetch', '--quiet', '--prune', 'origin'], { env: NET_ENV }))
    check(shaAt(cloneB, REMOTE_REF) === first.commit, 'fetch --prune borró la copia de origin')
  })

  let fromB
  run('B adopta el commit de origin y escribe encima', () => {
    check(git(cloneB, updateArgs(first.commit, null)).exitCode === 0, 'update-ref no adoptó el commit de origin')
    const local = read(cloneB)
    fromB = write(cloneB, [...local.items, item('b1', 'Cabo de B')], local.sha)
    check(fromB.moved, 'B no pudo escribir sobre el commit adoptado')
  })

  run('B sube con el lease de lo que trajo', () => {
    ok(git(cloneB, pushArgs(first.commit, fromB.commit), { env: NET_ENV }))
    ok(git(cloneB, trackArgs(fromB.commit)))
    check(shaAt(remote) === fromB.commit, 'origin no tiene el commit de B')
  })

  let stale
  run('origin rechaza el push de A, cuyo lease ya no vale', () => {
    const local = read(cloneA)
    stale = write(cloneA, [...local.items, item('a2', 'Otro de A')], local.sha)
    check(stale.moved, 'A no pudo escribir')
    check(git(cloneA, pushArgs(first.commit, stale.commit), { env: NET_ENV }).exitCode !== 0, 'el push con un lease caducado no se rechazó')
    check(shaAt(remote) === fromB.commit, 'origin cambió pese al rechazo')
  })

  run('A trae, fusiona y sube con el lease nuevo', () => {
    ok(git(cloneA, FETCH_ARGS, { env: NET_ENV }))
    const theirs = read(cloneA, REMOTE_REF)
    const local = read(cloneA)
    const merged = write(cloneA, mergeItems(local.items, theirs.items), local.sha)
    check(merged.moved, 'A no pudo escribir la fusión')
    ok(git(cloneA, pushArgs(theirs.sha, merged.commit), { env: NET_ENV }))
    ok(git(cloneA, trackArgs(merged.commit)))
    check(shaAt(remote) === merged.commit, 'origin no tiene la fusión')
    check(ids(read(remote).items) === 'a1,a2,b1', 'la fusión perdió cabos')
  })

  rmSync(dir, { recursive: true, force: true })
  console.log('OK')
} catch (err) {
  console.error(`FALLO en «${step}»: ${err.message}`)
  console.error(`(los repos de la prueba siguen en ${dir})`)
  process.exitCode = 1
}
