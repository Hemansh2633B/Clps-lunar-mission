import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const python = existsSync('.venv/bin/python') ? '.venv/bin/python' : (process.platform === 'win32' ? 'python' : 'python3');
const children = [];
let shuttingDown = false;

function run(name, command, args) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  children.push(child);
  const prefix = `[${name}] `;
  child.stdout.on('data', (d) => process.stdout.write(prefix + d.toString().replace(/\n/g, '\n' + prefix)));
  child.stderr.on('data', (d) => process.stderr.write(prefix + d.toString().replace(/\n/g, '\n' + prefix)));
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`${name} exited with code ${code}.`);
      shutdown(code ?? 1);
    }
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('Starting SELENE Terrain Lab API (port 8000) and Vite console (port 5173)…');
console.log('If Python dependencies are missing: python3 -m venv .venv && .venv/bin/python -m pip install -r backend/requirements.txt');
run('api', python, ['-m', 'backend.server', '--host', '0.0.0.0', '--port', '8000']);
run('web', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev']);
