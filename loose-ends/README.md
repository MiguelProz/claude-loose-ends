# loose-ends

Cuaderno de la sesión para Claude Code, con Chispa.

- **Cabos sueltos**: lo que Claude menciona y no hace. Claude los apunta con la
  herramienta `note_loose_end`, y tras cada respuesta larga Haiku
  (`claude-haiku-4-5-20251001`) caza los que se le escaparon y cierra los que
  quedaron resueltos.
- **Dónde se guardan**: `.claude/loose-ends.json` en la raíz de cada proyecto.
  Versiónalo con el proyecto: así viaja entre ordenadores y ramas.
- **Banda** encima del prompt: Chispa (animada en la app de escritorio, una
  cara de texto en la terminal) y los contadores `plan · cabos · en cola`.
- **Panel** (`/pendientes` o el botón «ver»): plan de la sesión, cabos con
  `Hazlo ahora`, `Cola`, `Hecho`, `Descartar` y prioridad, y lo hecho hoy. En
  la superficie `mobile` el panel no dibuja nada (no tiene selectores ni
  campos de texto); la banda sí.
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
`.claude/loose-ends.json` de cada proyecto.

## Desarrollar

    claude --plugin-dir ./loose-ends
    cd loose-ends && claude plugin test && claude plugin validate . --strict
    node scripts/chispa-gallery.mjs /tmp/chispa.html
