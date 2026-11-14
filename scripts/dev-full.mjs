import { spawn } from 'node:child_process';
import { buildCommand } from './go-bin.mjs';

const argv = process.argv.slice(2);
const take = (flag, fallback) => {
  const i = argv.indexOf(flag);
  if (i === -1) return fallback;
  const value = argv[i + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  argv.splice(i, 2);
  return value;
};
const apiPort = take('--api-port', '8000');
const webPort = take('--web-port', '5173');
// Remaining flags (e.g. --dem, --dem-config) are forwarded to the backend.
const backendArgs = ['--host', '0.0.0.0', '--port', apiPort, ...argv];

const children = [];
let shuttingDown = false;

function run(name, command, args) {
  const env = name === 'web' ? { ...process.env, CHANDRA_API_PORT: apiPort } : process.env;
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: name === 'web' && process.platform === 'win32', env });
  children.push(child);
  const prefix = `[${name}] `;
  child.stdout.on('data', (d) => process.stdout.write(prefix + d.toString().replace(/\n/g, '\n' + prefix)));
  child.stderr.on('data', (d) => process.stderr.write(prefix + d.toString().replace(/\n/g, '\n' + prefix)));
  child.on('error', (err) => { console.error(`${name}: ${err.message}`); shutdown(1); });
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

console.log(`Starting CHANDRA Terrain Lab API (port ${apiPort}) and Vite console (port ${webPort})…`);
let apiBinary;
try {
  apiBinary = buildCommand('chandra-api');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
run('api', apiBinary, backendArgs);
run('web', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev', '--', '--port', webPort, '--strictPort']);
