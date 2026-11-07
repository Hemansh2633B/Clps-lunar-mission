import { existsSync } from 'node:fs';

/** Prefer the project virtualenv; fall back to a system Python. */
export function pythonBin() {
  for (const candidate of ['.venv/bin/python', '.venv/Scripts/python.exe']) {
    if (existsSync(candidate)) return candidate;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}
