# Gated Dev Crew

**Gated Dev Crew** es un equipo de desarrollo para [Claude Code](https://claude.com/claude-code): un **Tech Leader** que planifica y delega, y agentes especializados que implementan, testean, arreglan y documentan. Con guardas anti-loop y tope de subagentes en paralelo.

## Qué instala

| Pieza | Destino (`~/.claude/`) | Función |
|---|---|---|
| `tech-leader` | `agents/` | Orquestador: planifica, descompone en tasks, delega. No escribe código. |
| `dev-coder` | `agents/` | Implementa un task. |
| `qa-test-author` | `agents/` | Pocos tests de casos borde + OWASP Top 10:2025 y revisión SAST. |
| `qa-test-runner` | `agents/` | Corre los tests afectados y reporta. Solo lectura. |
| `debugger` | `agents/` | Fix mínimo de causa raíz. Nunca toca tests. |
| `documenter` | `agents/` | Actualiza documentación. |
| skill `/pipeline` | `skills/pipeline/` | Hace que la sesión actual actúe como Tech Leader (útil en Desktop). |
| `guard.js` | `hooks/` | Bloquea llamadas idénticas repetidas y limita a 2 subagentes simultáneos. |
| Reglas globales | bloque en `CLAUDE.md` | Solo estos agentes, ahorro de tokens. |
| Permisos | merge en `settings.json` | Deniega agentes built-in (Explore, Plan, general-purpose…) y lecturas de lockfiles/`node_modules`/builds. |

## Requisitos

- [Claude Code](https://claude.com/claude-code)
- Node.js 16+ (el instalador y los hooks lo usan)

## Instalación

```bash
git clone https://github.com/<tu-usuario>/gated-dev-crew.git
cd gated-dev-crew
node install.js --dry-run   # opcional: ver qué hará
node install.js
```

Reiniciá Claude Code y listo.

### Opciones

| Flag | Efecto |
|---|---|
| `--dry-run` | Muestra los cambios sin escribir. |
| `--uninstall` | Revierte todo lo instalado. |
| `--target <dir>` | Otra carpeta de config (default `~/.claude` o `$CLAUDE_CONFIG_DIR`). |
| `--no-settings` | No toca `settings.json` (sin hooks ni denies). |
| `--no-claude-md` | No toca `CLAUDE.md`. |
| `--no-read-deny` | No agrega los deny de `Read` (lockfiles, `node_modules`…). |

### Seguridad del instalador

- Antes de pisar cualquier archivo, copia el original a `~/.claude/backups/gated-dev-crew-<fecha>/`.
- `settings.json` se **fusiona**: no cambia tu modelo, tema, plugins ni permisos previos. Si no es JSON válido, aborta sin tocarlo.
- `CLAUDE.md`: tus reglas se conservan; las nuestras van en un bloque delimitado que se actualiza al reinstalar.
- Es idempotente: reinstalar no duplica nada. `--uninstall` quita solo lo que se agregó.
- Si ya tenés agentes con los mismos nombres, se reemplazan (con backup).

## Uso

```bash
claude --agent tech-leader          # CLI: sesión con el orquestador
```

En Desktop o en una sesión normal: `/pipeline <tarea>`.

Flujo: `dev-coder` → `qa-test-author` (+ `documenter` en paralelo) → `qa-test-runner` → `debugger` si hay fallos (máx. 2 ciclos, luego escala a humano).

Cada proyecto debería tener su propio `CLAUDE.md` con los comandos de **build/test/lint** y la estructura; los agentes los leen de ahí.

## Notas

- Las instrucciones están en español rioplatense y el estilo de salida es "caveman" (comprimido). El plugin [caveman](https://github.com/JuliusBrussee/caveman) es **opcional**; sin él todo funciona igual.
- Para personalizar, editá los `.md` de `payload/` antes de instalar.

## Licencia

MIT
