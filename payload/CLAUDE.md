# Reglas globales

## Agentes
Solo estos: `tech-leader` (orquestador), `dev-coder`, `qa-test-author`, `qa-test-runner`, `debugger`, `documenter`.
Nunca Explore, Plan, general-purpose ni otros integrados.
Los subagentes se invocan por nombre y solo desde `tech-leader` (CLI: `claude --agent tech-leader`) o desde la skill `/pipeline` (Desktop). Máximo 2 a la vez.
Comandos de build/test/lint y estructura: en el CLAUDE.md de cada proyecto.

## Ahorro de tokens
Búsqueda
- Grep antes de Read. Primero `output_mode: files_with_matches`, luego `content` con `head_limit` ≤40 y `-C` ≤2.
- Filtrar siempre con `type` o `glob`. Patrón específico (símbolo exacto).

Lectura y edición
- Read con `offset`/`limit`. Archivo >300 líneas nunca entero.
- Edit en vez de reescribir. No releer tras editar.

Salida
- Sin preámbulo, sin resumen de pasos, sin ofrecer extras.
- Mostrar solo diffs o `ruta:línea`. Explicar solo si pregunto.
- Bash: filtrar salida (`| tail -30`, `grep -E "error|FAIL"`). Sin watchers ni servidores.

Tests
- Máximo 10 nuevos por tarea: casos borde + OWASP Top 10:2025 aplicable. Nada trivial.
- Correr solo los tests afectados.

Sesión
- Una tarea, una conversación. `/clear` entre tareas.
- Mismo error 2 veces: parar y reportar.
