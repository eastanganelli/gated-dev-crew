#!/usr/bin/env node
'use strict';
/*
 * Instalador de Shipwright. Sin dependencias, solo Node >= 16.
 *
 *   node install.js              instala
 *   node install.js --dry-run    muestra qué haría, sin escribir nada
 *   node install.js --uninstall  revierte lo instalado
 *   node install.js --help
 *
 * Opciones: --target <dir>  --no-settings  --no-claude-md  --no-read-deny
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = __dirname;
const PAYLOAD = path.join(ROOT, 'payload');
const SPECIAL = new Set(['CLAUDE.md', 'settings.fragment.json']);
const MD_START = '<!-- shipwright:start -->';
const MD_END = '<!-- shipwright:end -->';
const MANIFEST = '.shipwright.json';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const optVal = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

if (has('--help') || has('-h')) {
  console.log(`Uso: node install.js [opciones]

  --dry-run        Muestra los cambios sin escribir nada
  --uninstall      Quita lo instalado (agentes, skill, hook, reglas, settings)
  --target <dir>   Carpeta de config de Claude (default: ~/.claude o $CLAUDE_CONFIG_DIR)
  --no-settings    No toca settings.json (los hooks y denies no se instalan)
  --no-claude-md   No toca CLAUDE.md
  --no-read-deny   No agrega los deny de Read (lockfiles, node_modules, etc.)`);
  process.exit(0);
}

const DRY = has('--dry-run');
const CLAUDE_DIR = path.resolve(
  optVal('--target') || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
);
const BACKUP_DIR = path.join(
  CLAUDE_DIR,
  'backups',
  'shipwright-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
);
const log = (m) => console.log((DRY ? '[dry-run] ' : '') + m);
const fwd = (p) => p.replace(/\\/g, '/');

function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

function backup(file) {
  if (!fs.existsSync(file)) return;
  const dest = path.join(BACKUP_DIR, path.relative(CLAUDE_DIR, file));
  log('backup: ' + dest);
  if (DRY) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}

function writeAtomic(file, data) {
  if (DRY) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

const manifestPath = path.join(CLAUDE_DIR, MANIFEST);
const loadManifest = () => {
  try {
    return readJson(manifestPath);
  } catch (e) {
    return {};
  }
};

function mdBlock() {
  const body = fs.readFileSync(path.join(PAYLOAD, 'CLAUDE.md'), 'utf8').trim();
  return MD_START + '\n' + body + '\n' + MD_END + '\n';
}
const stripBlock = (txt) =>
  txt.replace(new RegExp('\\n*' + MD_START + '[\\s\\S]*?' + MD_END + '\\n?', 'g'), '\n').replace(/^\n+/, '');

const sameCmd = (a, b) => fwd(String(a)).toLowerCase() === fwd(String(b)).toLowerCase();

function hookCommand(mode) {
  return 'node "' + fwd(path.join(CLAUDE_DIR, 'hooks', 'guard.js')) + '" ' + mode;
}

// ---------------------------------------------------------------- install
function install() {
  if (!fs.existsSync(PAYLOAD)) throw new Error('Falta la carpeta payload/ junto a install.js');
  log('Destino: ' + CLAUDE_DIR);
  const manifest = { version: 1, files: [], denyAdded: [], hooksAdded: [], claudeMd: false };
  const prev = loadManifest();

  // 1. archivos (agentes, skill, hook)
  for (const rel of walk(PAYLOAD)) {
    if (SPECIAL.has(rel)) continue;
    const src = path.join(PAYLOAD, rel);
    const dst = path.join(CLAUDE_DIR, rel);
    manifest.files.push(fwd(rel));
    if (fs.existsSync(dst) && fs.readFileSync(dst).equals(fs.readFileSync(src))) {
      log('sin cambios: ' + fwd(rel));
      continue;
    }
    backup(dst);
    log('copia: ' + fwd(rel));
    if (!DRY) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }

  // 2. CLAUDE.md global (bloque delimitado, reinstalar lo actualiza)
  if (!has('--no-claude-md')) {
    const file = path.join(CLAUDE_DIR, 'CLAUDE.md');
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const base = stripBlock(cur).trimEnd();
    const next = (base ? base + '\n\n' : '') + mdBlock();
    if (next !== cur) {
      backup(file);
      log('CLAUDE.md: bloque de reglas ' + (cur ? 'agregado/actualizado' : 'creado'));
      writeAtomic(file, next);
    }
    manifest.claudeMd = true;
  }

  // 3. settings.json (merge, nunca pisa lo del usuario)
  if (!has('--no-settings')) {
    const file = path.join(CLAUDE_DIR, 'settings.json');
    let settings;
    try {
      settings = readJson(file);
    } catch (e) {
      console.error('ERROR: settings.json no es JSON válido (' + e.message + '). No lo toco.');
      console.error('Corregilo o corré con --no-settings.');
      process.exit(1);
    }
    const frag = readJson(path.join(PAYLOAD, 'settings.fragment.json'));
    const before = JSON.stringify(settings);

    settings.permissions = settings.permissions || {};
    const deny = (settings.permissions.deny = settings.permissions.deny || []);
    const wanted = [...frag.permissions.deny, ...(has('--no-read-deny') ? [] : frag.permissions.denyReads)];
    for (const d of wanted) {
      if (!deny.includes(d)) {
        deny.push(d);
        manifest.denyAdded.push(d);
      }
    }

    settings.hooks = settings.hooks || {};
    for (const [event, items] of Object.entries(frag.hooks)) {
      const groups = (settings.hooks[event] = settings.hooks[event] || []);
      for (const it of items) {
        const command = hookCommand(it.command);
        const exists = groups.some((g) => (g.hooks || []).some((h) => sameCmd(h.command, command)));
        if (exists) continue;
        const group = { hooks: [{ type: 'command', command }] };
        if (it.matcher) group.matcher = it.matcher;
        groups.push(group);
        manifest.hooksAdded.push({ event, command });
      }
    }

    // conservar lo agregado por una instalación previa (no se pierde al reinstalar)
    manifest.denyAdded = [...new Set([...(prev.denyAdded || []), ...manifest.denyAdded])];
    manifest.hooksAdded = [
      ...(prev.hooksAdded || []),
      ...manifest.hooksAdded.filter((h) => !(prev.hooksAdded || []).some((p) => p.event === h.event && sameCmd(p.command, h.command))),
    ];

    if (JSON.stringify(settings) !== before) {
      backup(file);
      log('settings.json: +' + manifest.denyAdded.length + ' deny, hooks de guard.js');
      writeAtomic(file, JSON.stringify(settings, null, 2) + '\n');
    } else {
      log('settings.json: sin cambios');
    }
  } else {
    manifest.denyAdded = prev.denyAdded || [];
    manifest.hooksAdded = prev.hooksAdded || [];
  }

  writeAtomic(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log('\nListo. Reiniciá Claude Code y probá:');
  console.log('  claude --agent tech-leader     (CLI)');
  console.log('  /pipeline <tarea>              (Desktop / sesión normal)');
}

// -------------------------------------------------------------- uninstall
function uninstall() {
  const m = loadManifest();
  if (!m.files) {
    console.log('No encontré ' + MANIFEST + ' en ' + CLAUDE_DIR + '. Nada que desinstalar.');
    return;
  }
  log('Destino: ' + CLAUDE_DIR);
  for (const rel of m.files) {
    const f = path.join(CLAUDE_DIR, rel);
    if (!fs.existsSync(f)) continue;
    backup(f);
    log('borra: ' + rel);
    if (!DRY) {
      fs.unlinkSync(f);
      let d = path.dirname(f);
      while (d !== CLAUDE_DIR && fs.existsSync(d) && fs.readdirSync(d).length === 0) {
        fs.rmdirSync(d);
        d = path.dirname(d);
      }
    }
  }

  const md = path.join(CLAUDE_DIR, 'CLAUDE.md');
  if (m.claudeMd && fs.existsSync(md)) {
    const cur = fs.readFileSync(md, 'utf8');
    const next = stripBlock(cur).trimEnd();
    if (next !== cur.trimEnd()) {
      backup(md);
      log('CLAUDE.md: quito bloque');
      if (!DRY) next ? writeAtomic(md, next + '\n') : fs.unlinkSync(md);
    }
  }

  const sf = path.join(CLAUDE_DIR, 'settings.json');
  if (fs.existsSync(sf) && ((m.denyAdded || []).length || (m.hooksAdded || []).length)) {
    const s = readJson(sf);
    const before = JSON.stringify(s);
    if (s.permissions && Array.isArray(s.permissions.deny)) {
      s.permissions.deny = s.permissions.deny.filter((d) => !(m.denyAdded || []).includes(d));
      if (!s.permissions.deny.length) delete s.permissions.deny;
      if (!Object.keys(s.permissions).length) delete s.permissions;
    }
    for (const { event, command } of m.hooksAdded || []) {
      const groups = (s.hooks && s.hooks[event]) || [];
      for (const g of groups) g.hooks = (g.hooks || []).filter((h) => !sameCmd(h.command, command));
      s.hooks[event] = groups.filter((g) => (g.hooks || []).length);
      if (!s.hooks[event].length) delete s.hooks[event];
    }
    if (s.hooks && !Object.keys(s.hooks).length) delete s.hooks;
    if (JSON.stringify(s) !== before) {
      backup(sf);
      log('settings.json: quito deny y hooks agregados');
      writeAtomic(sf, JSON.stringify(s, null, 2) + '\n');
    }
  }

  if (!DRY && fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
  console.log('\nDesinstalado.');
}

try {
  has('--uninstall') ? uninstall() : install();
} catch (e) {
  console.error('ERROR: ' + e.message);
  process.exit(1);
}
