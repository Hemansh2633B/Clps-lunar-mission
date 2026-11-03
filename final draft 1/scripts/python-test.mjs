import { spawn } from 'node:child_process';
import { pythonBin } from './python-bin.mjs';

const child = spawn(pythonBin(), ['-m', 'pytest', '-q', ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('error', (err) => { console.error(err.message); process.exit(1); });
child.on('exit', (code) => process.exit(code ?? 0));
