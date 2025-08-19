#!/usr/bin/env node
// Dev orchestrator: starts backend & frontend; cleans up on exit.
// Usage: node dev-all.mjs  (optionally set FRONTEND_PORT / PORT env vars beforehand)

import { spawn, spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const processes = [];

function logPrefix(name, colorCode) {
  return (data) => {
    const lines = data.toString().split(/\r?\n/);
    for (const l of lines) {
      if (!l.trim()) continue;
      process.stdout.write(`\x1b[${colorCode}m[${name}]\x1b[0m ${l}\n`);
    }
  };
}

function spawnProc(name, color, cmd, args, cwd) {
  const absCwd = path.resolve(cwd);
  const useShell = platform() === 'win32';
  const child = spawn(cmd, args, {
    cwd: absCwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
    shell: useShell,
  });
  child.stdout.on('data', logPrefix(name, color));
  child.stderr.on('data', logPrefix(name, color));
  child.on('error', (err) => {
    console.error(`[orchestrator] failed to start ${name}:`, err.message);
    shutdown(`${name} spawn error`);
  });
  child.on('exit', (code, sig) => {
    console.log(`[orchestrator] ${name} exited code=${code} sig=${sig}`);
    // If one exits unexpectedly (non-zero), tear down others.
    if (code !== 0) {
      shutdown(`Child ${name} exited with code ${code}`);
    }
  });
  processes.push({ name, child });
  return child;
}

let shuttingDown = false;
function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[orchestrator] Shutting down (${reason || 'signal'})...`);
  for (const { child, name } of processes) {
    if (child.exitCode != null) continue;
    try {
      if (platform() === 'win32') {
        // taskkill ensures tree termination on Windows
        const tk = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
        tk.on('exit', () => {});
      } else {
        child.kill('SIGTERM');
        // Fallback hard kill after timeout
        setTimeout(() => {
          if (child.exitCode == null) child.kill('SIGKILL');
        }, 5000);
      }
    } catch (e) {
      console.warn(`[orchestrator] error killing ${name}:`, e.message);
    }
  }
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (e) => {
  console.error(e);
  shutdown('uncaughtException');
});

// Start backend then frontend; allow both to run concurrently.
function ensureInstall(dir) {
  const nm = path.join(dir, 'node_modules');
  if (fs.existsSync(nm)) return;
  console.log(`[orchestrator] Installing dependencies in ${dir} (npm install)...`);
  const res = spawnSyncLogged(getNpmCmd(), ['install'], dir);
  if (res !== 0) {
    console.error(`[orchestrator] Failed to install dependencies in ${dir}`);
    process.exit(1);
  }
}

function spawnSyncLogged(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env } });
  return r.status ?? 1;
}

function getNpmCmd() {
  return platform() === 'win32' ? 'npm.cmd' : 'npm';
}

// Always use npm
ensureInstall('./backend');
ensureInstall('./frontend');

console.log('[orchestrator] Starting backend dev with npm ...');
spawnProc('backend', '36', getNpmCmd(), ['run', 'dev'], './backend');

console.log('[orchestrator] Starting frontend dev with npm ...');
spawnProc('frontend', '35', getNpmCmd(), ['run', 'dev'], './frontend');

console.log('[orchestrator] Both processes started. Press Ctrl+C to stop.');
