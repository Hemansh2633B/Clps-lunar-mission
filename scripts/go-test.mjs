// Native backend quality gate: formatting, vet and the Go test-suite
// (golden parity against the former Python backend, API contract replay,
// acquisition, Horizons parsing). Extra args are passed to `go test`.
import { spawnSync } from 'node:child_process';
import { goBin } from './go-bin.mjs';
import { existsSync } from 'node:fs';
import path from 'node:path';

let go;
try { go = goBin(); } catch (err) { console.error(err.message); process.exit(1); }
const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit' }).status ?? 1;

// Resolve the gofmt binary: prefer $GOROOT/bin/gofmt, fall back to PATH.
function gofmtBin() {
  const gorOOT = spawnSync(go, ['env', 'GOROOT'], { encoding: 'utf8' }).stdout.trim();
  const exe = process.platform === 'win32' ? 'gofmt.exe' : 'gofmt';
  if (gorOOT) {
    const candidate = path.join(gorOOT, 'bin', exe);
    if (existsSync(candidate)) return candidate;
  }
  return exe;
}
const fmt = spawnSync(gofmtBin(), ['-l', 'api', 'backend', 'cmd'], { encoding: 'utf8' });
if (fmt.status !== 0 || fmt.stdout.trim()) {
  console.error(`gofmt needs to be run on:\n${fmt.stdout || fmt.stderr}`);
  process.exit(1);
}
const extra = process.argv.slice(2);
process.exit(run(go, ['vet', './...']) || run(go, ['test', ...(extra.length ? extra : ['./...'])]));
