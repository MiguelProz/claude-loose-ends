# loose-ends

Cuaderno de la sesión para Claude Code, con Chispa.

- **Candidatos, no cabos**: lo que Claude deja sin hacer (un bug que ve, una
  deuda, un test que se salta, un aviso que ignora, una mejora fuera de
  alcance) llega como candidato. Lo proponen Claude, con la herramienta
  `note_loose_end` y una categoría (`bug`, `deuda`, `test`, `aviso`, `mejora`),
  y Haiku (`claude-haiku-4-5-20251001`) tras cada respuesta de 500 caracteres o
  más, citando literalmente la frase. Antes, un filtro fijo descarta lo que no
  es trabajo sobre el código (comprobar, esperar, decidir, avisar, hacer push,
  desplegar), lo repetido y lo parecido a lo que ya rechazaste.
- **Tú decides**: el candidato aparece bajo el mensaje de Claude donde nació,
  con la frase en negrita, y `Guardar`, `No es un cabo` o `Editar`. Lo que no
  revises espera en el panel y caduca a los 7 días. Cada «No es un cabo» enseña
  al barrido: los últimos 20 van en su prompt.
- **Cierre con prueba**: Haiku nunca cierra nada. Si una respuesta deja un cabo
  hecho, propone «¿Resuelto?» con la frase que lo prueba y, si el turno hizo
  un commit, ese commit; tú confirmas o dices «Sigue abierto». Tras `Hacer`
  mira la respuesta siempre, sea larga o corta.
- **Dónde se guardan**: en la ref `refs/loose-ends/items` del repo git al que
  pertenece cada cabo, fuera de tus ramas. No ensucian `git status`, no hacen
  commits en tu rama y todos los worktrees del repo ven la misma lista. Con
  `origin`, se traen al empezar la sesión y se suben tras un `git push` que
  Claude ejecuta en la sesión: la primera vez pregunta, y `Siempre` o `Nunca`
  quedan en `git config loose-ends.sync`. Si haces el push desde tu propia
  terminal, el panel ofrece `Subir`. Los cabos cerrados se borran a los 30
  días de cerrarse y se guardan los 50 últimos rechazados. Fuera de un repo git
  no se guarda nada (nunca en `~/.claude/`).
- **Banda** encima del prompt: Chispa y una línea con una acción, la primera
  que aplique: `No puedo leer los cabos · Ver`, `N por revisar · Revisar`,
  `Urgente: … · Ver`, `Cerrado: … · Deshacer`, `Desde ayer: … · Ver` o
  `N abiertos · Ver`.
- **Chispa** lleva la señal: sostiene una nota si hay candidatos, se preocupa
  con un urgente, celebra al cerrar un cabo o tras un `git commit` con éxito,
  trabaja durante el turno y solo duerme tras 30 minutos quieta y sin nada
  pendiente.
- **Panel** (`/pendientes` o la acción de la banda): Por revisar, Abiertos (la
  prioridad cambia con un toque, `editar`, `Hacer`, `Hecho`, `Descartar` y
  «¿Sigue vigente?» a los 14 días sin cambios) y Cerrados esta semana con `↺`.
  El campo de arriba apunta un cabo a mano. En móvil se ve igual, sin campos de
  texto.
- **De paso**: si Claude lee o edita un fichero con cabos abiertos, se lo
  recuerda. Con un urgente abierto, sin empezar y sin cierre propuesto, y sin
  candidatos por revisar, lo propone en gris en el prompt vacío en lugar de la
  sugerencia de Claude Code; `Tab` lo usa.

Requiere Claude Code 2.1.287 o posterior (probado con 2.1.288).

## Instalar

    /plugin marketplace add MiguelProz/claude-loose-ends
    /plugin install loose-ends@claude-loose-ends
    /reload-plugins

## Actualizar

Claude Code no sabe que hay una versión nueva hasta que refresca su copia del
marketplace; mientras no lo haga, `/plugin` enseña la versión vieja y no ofrece
actualizar. Primero el marketplace, después el plugin:

    claude plugin marketplace update claude-loose-ends
    claude plugin update loose-ends@claude-loose-ends

Lo mismo dentro de Claude Code: `/plugin marketplace update claude-loose-ends`,
o `/plugin` → pestaña Marketplaces → claude-loose-ends → `Update marketplace`;
después, pestaña Installed → loose-ends → actualizar. La versión nueva se carga
al reiniciar la sesión. En ese mismo menú del marketplace, `Enable auto-update`
hace que Claude Code lo refresque solo.

## Venir de 0.3

La primera sesión en cada repo importa `.claude/loose-ends.json` a
`refs/loose-ends/items` y lo dice una vez en el panel. Después puedes borrar el
fichero del repo con `git rm .claude/loose-ends.json`.

## Ver los cabos a mano

    git show refs/loose-ends/items:loose-ends.json

Lo que había en origin la última vez que se trajo o se subió está en
`refs/loose-ends/origin` (fuera de `refs/remotes`, así que no sale en
`git branch -r`). Ninguna de las dos se ve en la web de GitHub.

## Desactivar

`/plugin` → pestaña Installed → loose-ends. Los datos se quedan en
`refs/loose-ends/items` de cada repo.

## Desarrollar

    claude --plugin-dir ./loose-ends
    cd loose-ends && claude plugin test && claude plugin validate . --strict
    node ../scripts/chispa-gallery.mjs /tmp/chispa.html
    node ../scripts/git-smoke.mjs

`git-smoke.mjs` repite con git de verdad, en una carpeta temporal con un remoto
y dos clones, los comandos que el mod lanza sobre la ref: crearla, subirla con
lease, traerla al otro clon y el rechazo cuando origin cambió. Dice `OK` o el
paso que falló.
