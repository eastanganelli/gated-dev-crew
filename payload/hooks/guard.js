#!/usr/bin/env node
/*
 * Guardas globales para Claude Code: anti-loop y tope de subagentes en paralelo.
 *
 *   guard.js loop        PreToolUse Bash|Grep|Glob: bloquea la misma llamada repetida
 *                        sin que haya cambiado ningún archivo entre medio.
 *   guard.js reset       PostToolUse Edit|Write: borra los contadores de repetición.
 *   guard.js spawn-pre   PreToolUse Agent: bloquea si ya hay MAX_PARALLEL subagentes activos.
 *   guard.js spawn-done  SubagentStop: libera un cupo.
 *
 * Variables de entorno (opcionales):
 *   GUARD_MAX_REPEAT (3)    bloquea al llegar a la N-ésima llamada idéntica
 *   GUARD_MAX_PARALLEL (2)  subagentes simultáneos permitidos
 *   GUARD_TTL (900)         segundos tras los que un cupo se considera abandonado
 *
 * Falla en abierto: ante cualquier error interno no bloquea nada (exit 0).
 * Bloqueo: exit 2 y mensaje por stderr (Claude lo recibe como motivo).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const num = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const MAX_REPEAT = num(process.env.GUARD_MAX_REPEAT, 3);
const MAX_PARALLEL = num(process.env.GUARD_MAX_PARALLEL, 2);
const TTL_MS = num(process.env.GUARD_TTL, 900) * 1000;

function sleep(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (e) { /* sin espera */ }
}

function statePath(session, name) {
  const safe = String(session || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'default';
  const dir = path.join(os.tmpdir(), 'claude-guard', safe);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

function load(file, dflt) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return dflt;
  }
}

function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data), 'utf8');
}

// Lock por mkdir (atómico y multiplataforma). Un lock huérfano se descarta tras 2 s.
function withLock(file, fn) {
  const lock = file + '.lock';
  const deadline = Date.now() + 2000;
  let held = false;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      held = true;
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') break;
      if (Date.now() > deadline) {
        try { fs.rmdirSync(lock); } catch (e2) { /* nada */ }
        try { fs.mkdirSync(lock); held = true; } catch (e3) { /* seguimos sin lock */ }
        break;
      }
      sleep(30);
    }
  }
  try {
    return fn();
  } finally {
    if (held) {
      try { fs.rmdirSync(lock); } catch (e) { /* nada */ }
    }
  }
}

function block(msg) {
  process.stderr.write(msg + '\n');
  process.exit(2);
}

const modes = {
  loop(p) {
    const agent = String(p.agent_id || 'main');
    const raw = String(p.tool_name || '') + JSON.stringify(p.tool_input || {});
    const key = agent + ':' + crypto.createHash('sha1').update(raw).digest('hex');
    const file = statePath(p.session_id, 'repeats.json');
    const n = withLock(file, () => {
      const counts = load(file, {});
      counts[key] = (counts[key] || 0) + 1;
      save(file, counts);
      return counts[key];
    });
    if (n >= MAX_REPEAT) {
      block(
        'BLOQUEADO: misma llamada repetida ' + n + ' veces sin cambios en archivos. ' +
        'Cambiar de enfoque o reportar BLOQUEADO. No reintentar igual.'
      );
    }
  },

  reset(p) {
    const file = statePath(p.session_id, 'repeats.json');
    withLock(file, () => save(file, {}));
  },

  'spawn-pre'(p) {
    const file = statePath(p.session_id, 'spawns.json');
    const now = Date.now();
    const active = withLock(file, () => {
      const list = load(file, []).filter((t) => now - t < TTL_MS);
      if (list.length >= MAX_PARALLEL) {
        save(file, list);
        return list.length;
      }
      list.push(now);
      save(file, list);
      return -1;
    });
    if (active >= 0) {
      block(
        'BLOQUEADO: ya hay ' + active + ' subagentes activos (máximo ' + MAX_PARALLEL + '). ' +
        'Esperar a que termine uno y relanzar.'
      );
    }
  },

  'spawn-done'(p) {
    const file = statePath(p.session_id, 'spawns.json');
    const now = Date.now();
    withLock(file, () => {
      const list = load(file, []).filter((t) => now - t < TTL_MS);
      list.shift();
      save(file, list);
    });
  },
};

function main() {
  const mode = process.argv[2];
  if (!Object.prototype.hasOwnProperty.call(modes, mode)) return;
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (e) {
    return; // falla en abierto
  }
  try {
    modes[mode](payload || {});
  } catch (e) {
    // falla en abierto
  }
}

main();
