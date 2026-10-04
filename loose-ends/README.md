# loose-ends

Cuaderno de la sesión para Claude Code, con Chispa.

- **Cabos sueltos**: lo que Claude menciona y no hace. Claude los apunta con la
  herramienta `note_loose_end`, y tras cada respuesta larga (500 caracteres o
  más) Haiku (`claude-haiku-4-5-20251001`) caza los que se le escaparon y cierra
  los que quedaron resueltos. Solo cuenta como cabo el trabajo concreto que se
  deja sin hacer (un bug o una deuda sin arreglar, un test que se salta, un
  aviso que se ignora), no esperas, comprobaciones, preguntas ni informes de
  estado. El barrido apunta como máximo 2 por respuesta y solo si cita
  literalmente la frase de la respuesta donde lo deja sin hacer (sin contar
  Markdown, comillas ni viñetas).
- **Dónde se guardan**: `.claude/loose-ends.json` en la raíz del **repo git al
  que pertenece cada cabo**, no en el de la sesión que lo encontró. Sin
  `repo`, la herramienta apunta en el repo de la sesión; con `repo` (ruta
  absoluta de un fichero o carpeta del otro repo) apunta en ese. El barrido
  reparte los cabos entre los repos que Claude tocó en el turno. Una sesión
  solo ve y recuerda los cabos de su propio repo. Fuera de un repo git no se
  guarda nada de la sesión (nunca en `~/.claude/`). Versiónalo con el repo: así
  viaja entre ordenadores y ramas.
- **Banda** encima del prompt: una línea discreta con Chispa (animada en la app
  de escritorio, una cara de texto en la terminal), un resumen atenuado como
  `3 pendientes (1 urgente) · plan 4/7` y el botón `Ver`. Sin nada que contar,
  solo Chispa.
- **Panel** (`/pendientes` o el botón `Ver`): pendientes, plan de la sesión y
  lo hecho hoy (plegado). Cada pendiente enseña `Hacer`, `Hecho` y `···`; este
  último despliega la evidencia, `Cola`, `Descartar` y la prioridad (`Urgente`,
  `Normal`, `Baja`). En la superficie `mobile` el panel no dibuja nada (no
  tiene campos de texto); la banda sí.
- **Cola al terminar**: al cerrar la tarea, Claude recibe una vez los cabos en
  cola; si no los resuelve, vuelven a abiertos.

Requiere Claude Code 2.1.287 o posterior (probado con 2.1.288).

## Instalar

    /plugin marketplace add MiguelProz/claude-loose-ends
    /plugin install loose-ends@claude-loose-ends
    /reload-plugins

## Conflictos de merge

`.claude/loose-ends.json` va versionado: si dos ramas apuntaron cabos nuevos, el
merge tendrá conflicto en ese fichero. Resuélvelo conservando los dos arrays
`items` (la unión, sin repetir `id`). Mientras el fichero tenga marcas de
conflicto el mod no escribe y la banda avisa.

## Desactivar

`/plugin` → pestaña Installed → loose-ends. Los datos se quedan en
`.claude/loose-ends.json` de cada repo.

## Desarrollar

    claude --plugin-dir ./loose-ends
    cd loose-ends && claude plugin test && claude plugin validate . --strict
    node scripts/chispa-gallery.mjs /tmp/chispa.html
