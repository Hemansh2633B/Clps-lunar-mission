// Starts CHANDRA's native terrain API (Go).
// Forward flags after `--`:  npm run dev:api -- --dem-config data/lola_example_config.json --port 8000
import { spawn } from 'node:child_process';
import { buildCommand } from './go-bin.mjs';

let binary;
try {
  binary = buildCommand('chandra-api');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const argv = process.argv.slice(2);
const args = [...(argv.includes('--host') ? [] : ['--host', '0.0.0.0']), ...(argv.includes('--port') ? [] : ['--port', process.env.CHANDRA_API_PORT || '8000']), ...argv];
const child = spawn(binary, args, { stdio: 'inherit' });
child.on('error', (err) => { console.error(err.message); process.exit(1); });
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
