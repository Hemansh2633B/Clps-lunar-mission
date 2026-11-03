import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
const python = existsSync('.venv/bin/python') ? '.venv/bin/python' : (process.platform === 'win32' ? 'python' : 'python3');
const child = spawn(python, ['-m', 'pytest', '-q'], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
