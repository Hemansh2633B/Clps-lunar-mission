// Locates the Go toolchain used for CHANDRA's native terrain API.
// The console itself (npm run dev / build / test) never needs Go.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const MIN_GO = [1, 23];
const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);

export function goBin() {
  const candidates = [
    process.env.CHANDRA_GO,
    process.env.GOROOT && path.join(process.env.GOROOT, 'bin', exe('go')),
    exe('go'),
    '/usr/local/go/bin/go',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['env', 'GOVERSION'], { encoding: 'utf8' });
    if (probe.status !== 0) continue;
    const match = /go(\d+)\.(\d+)/.exec(probe.stdout);
    if (match && (Number(match[1]) > MIN_GO[0] || (Number(match[1]) === MIN_GO[0] && Number(match[2]) >= MIN_GO[1]))) return candidate;
    throw new Error(`Found ${probe.stdout.trim()} at ${candidate}, but CHANDRA's terrain API needs Go ${MIN_GO.join('.')} or newer.`);
  }
  throw new Error(
    `Go ${MIN_GO.join('.')}+ was not found. It is only needed for the native terrain API (real DEMs, DEM acquisition, JPL Horizons verification).\n` +
    '  Install: https://go.dev/dl/   — or point CHANDRA_GO at an existing go binary.\n' +
    '  The console still runs without it: npm run dev (synthetic demo, Data Hub, mission planner).',
  );
}

/** Compile one command from ./cmd into a private cache dir and return the binary path. */
export function buildCommand(name) {
  const go = goBin();
  const outDir = path.join('node_modules', '.cache', 'chandra-native');
  mkdirSync(outDir, { recursive: true });
  const out = path.resolve(outDir, exe(name));
  const build = spawnSync(go, ['build', '-o', out, `./cmd/${name}`], { stdio: 'inherit' });
  if (build.status !== 0 || !existsSync(out)) throw new Error(`go build ./cmd/${name} failed`);
  return out;
}
