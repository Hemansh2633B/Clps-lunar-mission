import { spawn } from 'node:child_process';
import { pythonBin } from './python-bin.mjs';

// Forward `npm run dev:api -- --dem ... --dem-config ... --port ...` to Flask.
const args = ['-m', 'backend.server', '--host', '0.0.0.0', '--port', '8000', ...process.argv.slice(2)];
const child = spawn(pythonBin(), args, { stdio: 'inherit' });
child.on('error', (err) => { console.error(err.message); process.exit(1); });
child.on('exit', (code) => process.exit(code ?? 0));
