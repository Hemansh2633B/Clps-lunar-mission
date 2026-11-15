// Vercel deployment validation without credentials.
//
//   node scripts/vercel-check.mjs            static checks of vercel.json / go.mod / api/index.go
//   node scripts/vercel-check.mjs --built    + validate an existing .vercel/output and EXECUTE the built
//                                              Go function through a local AWS-Lambda-runtime emulator
//   node scripts/vercel-check.mjs --build    run `vercel build` first (needs network; uses a placeholder
//                                              project link when the repo is not linked), then as --built
//
// This proves the deployable artifact routes and runs the native backend. It does
// NOT prove a live deployment: that needs a Vercel account (see docs/deployment/vercel.md).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const VERCEL_CLI = 'vercel@65.16.0';
const args = new Set(process.argv.slice(2));
const ok = (msg) => console.log(`  ✓ ${msg}`);

// ---------------------------------------------------------------- static checks
console.log('vercel.json / project layout');
const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
assert.equal(config.framework, 'vite', 'framework must be pinned to vite (a root go.mod must not select the Go server preset)');
assert.equal(config.outputDirectory, 'dist');
assert.ok(config.functions?.['api/index.go'], 'api/index.go must be configured as a function');
assert.ok(config.functions['api/index.go'].maxDuration <= 300 && config.functions['api/index.go'].maxDuration >= 30);
const goMod = readFileSync('go.mod', 'utf8');
assert.match(goMod, /^module chandra$/m, 'go.mod must sit at the project root (Vercel Go runtime requirement)');
assert.match(goMod, /^go 1\.\d+/m);
assert.ok(!/^require /m.test(goMod), 'the backend is standard-library only: go.mod must not gain third-party requirements');
const entry = readFileSync('api/index.go', 'utf8');
assert.match(entry, /^package handler$/m);
assert.match(entry, /^func Handler\(w http\.ResponseWriter, r \*http\.Request\)/m, 'api/index.go must export an http.HandlerFunc');
for (const forbidden of ['cmd/api/main.go', 'cmd/server/main.go', 'main.go']) {
  assert.ok(!existsSync(forbidden), `${forbidden} would trigger the Go server framework preset`);
}
const [apiRewrite, spaRewrite] = config.rewrites;
assert.equal(apiRewrite.source, '/api/:route*');
assert.equal(apiRewrite.destination, '/api/index?__route=:route*');
const spa = new RegExp(`^${spaRewrite.source}$`);
for (const p of ['/', '/terrain', '/data-hub/sources', '/index.html']) assert.ok(spa.test(p), `${p} should fall back to the SPA`);
for (const p of ['/api', '/api/', '/api/health', '/api/unknown/deep', '/assets/missing.js']) assert.ok(!spa.test(p), `${p} must never be rewritten to index.html`);
const csp = config.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
assert.ok(/default-src 'self'/.test(csp) && !/unsafe-eval/.test(csp) && /object-src 'none'/.test(csp), 'a restrictive CSP is required');
// Every remote imagery layer in the catalogue must be allowed by img-src, and nothing else may be:
// a layer added without its host would load in development (no CSP there) and fail only when deployed.
const catalogue = JSON.parse(readFileSync('backend/catalog/catalogue.json', 'utf8'));
const layerHosts = new Set(catalogue.sources.filter((s) => s.layer && s.layer.type !== 'bundled')
  .map((s) => new URL(s.layer.url_template ?? s.layer.endpoint).origin));
assert.ok(layerHosts.size >= 2, 'the catalogue should describe at least two remote imagery hosts');
const imgSrc = (/img-src ([^;]*)/.exec(csp)?.[1] ?? '').split(/\s+/).filter(Boolean);
for (const origin of layerHosts) assert.ok(imgSrc.includes(origin), `CSP img-src must allow the catalogue imagery host ${origin}`);
for (const token of imgSrc.filter((t) => /^https?:/.test(t))) assert.ok(layerHosts.has(token), `CSP img-src allows ${token}, which no catalogue layer uses`);
assert.ok(/connect-src 'self'(;|$)/.test(csp), 'the console may only call its own origin');
for (const text of [JSON.stringify(config), entry]) assert.ok(!/BLOB_READ_WRITE_TOKEN\s*[:=]\s*["'][^"']+/.test(text), 'no credential may be committed');

// .vercelignore removes files BEFORE the build runs on Vercel, which a local `vercel build`
// does not reproduce. Check that it cannot remove anything the build needs. Only three
// pattern shapes are accepted, so that this check understands every line of the file.
const ignoreRules = readFileSync('.vercelignore', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((pattern) => {
  if (/^\/[\w.-]+$/.test(pattern)) return { pattern, test: (f) => f === pattern.slice(1) || f.startsWith(`${pattern.slice(1)}/`) };
  if (/^\*[\w.-]+$/.test(pattern)) return { pattern, test: (f) => f.split('/').pop().endsWith(pattern.slice(1)) };
  if (/^\.[\w-]+\*$/.test(pattern)) return { pattern, test: (f) => f.split('/').some((part) => part.startsWith(pattern.slice(0, -1))) };
  throw new assert.AssertionError({ message: `.vercelignore pattern "${pattern}" is not root-anchored ("/name"), a suffix glob ("*.ext") or a dot-prefix glob (".name*"). A bare directory name matches at every depth and can remove source directories.` });
});
const tracked = spawnSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 << 20 });
if (tracked.status === 0 && tracked.stdout.trim()) {
  const files = tracked.stdout.split('\n').filter(Boolean);
  const needed = files.filter((f) => /^(src|public|api|backend|cmd)\//.test(f) && !f.endsWith('_test.go') && !/\/testdata\//.test(f))
    .concat(['index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', 'go.mod', 'vercel.json']);
  assert.ok(needed.length > 100, 'expected the repository file list');
  for (const f of needed) {
    const hit = ignoreRules.find((r) => r.test(f));
    assert.ok(!hit, `.vercelignore pattern "${hit?.pattern}" would remove ${f}, which the Vercel build needs`);
  }
  ok(`.vercelignore keeps all ${needed.length} files the build needs (${ignoreRules.length} anchored rules)`);
} else {
  ok(`.vercelignore rules are anchored (${ignoreRules.length}); file-level check skipped outside a Git checkout`);
}
ok(`framework pinned, single Go function, API rewrite precedes the SPA fallback, no secrets, restrictive CSP (imagery hosts: ${[...layerHosts].join(', ')})`);

if (!args.has('--built') && !args.has('--build')) {
  console.log('Static Vercel checks passed. Run with --build (network) or --built to validate and execute the built function.');
  process.exit(0);
}

// ---------------------------------------------------------------- vercel build
if (args.has('--build')) {
  if (!existsSync('.vercel/project.json')) {
    mkdirSync('.vercel', { recursive: true });
    writeFileSync('.vercel/project.json', JSON.stringify({
      projectId: 'prj_local_validation_only', orgId: 'team_local_validation_only',
      settings: { framework: 'vite', buildCommand: 'npm run build', installCommand: 'npm ci', outputDirectory: 'dist', nodeVersion: '22.x' },
    }));
    console.log('  (wrote a placeholder .vercel/project.json — local validation only, not a real project link)');
  }
  const cli = process.env.VERCEL_CLI_BIN || 'npx';
  const cliArgs = process.env.VERCEL_CLI_BIN ? ['build', '--yes'] : ['--yes', VERCEL_CLI, 'build', '--yes'];
  const build = spawnSync(cli, cliArgs, { stdio: 'inherit', shell: process.platform === 'win32' });
  assert.equal(build.status, 0, 'vercel build failed');
}

// ---------------------------------------------------------------- built output
console.log('.vercel/output');
const out = '.vercel/output';
assert.ok(existsSync(`${out}/config.json`), 'no build output: run with --build, or `vercel build` first');
const built = JSON.parse(readFileSync(`${out}/config.json`, 'utf8'));
assert.equal(built.version, 3);
assert.ok(existsSync(`${out}/static/index.html`), 'static console missing from the build output');
const fn = `${out}/functions/api/index.func`;
const vc = JSON.parse(readFileSync(`${fn}/.vc-config.json`, 'utf8'));
assert.equal(vc.runtimeLanguage, 'go', 'the API function must be a Go function');
assert.equal(vc.handler, 'bootstrap');
assert.equal(vc.maxDuration, config.functions['api/index.go'].maxDuration);
// filePathMap entries are relative to the project root; without a map the binary sits in the .func directory.
const bootstrap = vc.filePathMap?.bootstrap ? path.resolve(vc.filePathMap.bootstrap) : path.resolve(fn, 'bootstrap');
assert.ok(existsSync(bootstrap) && statSync(bootstrap).size > 1e6, 'compiled Go bootstrap binary missing');
ok(`Go function built: runtime ${vc.runtime}, ${vc.architecture}, ${vc.memory} MB, maxDuration ${vc.maxDuration}s, ${(statSync(bootstrap).size / 1e6).toFixed(1)} MB binary`);

// Resolve a request path with the GENERATED routing table (same order Vercel applies).
function resolve(urlPath) {
  let phase = null;
  for (const r of built.routes) {
    if (r.handle) { phase = r.handle; if (phase === 'filesystem' && existsSync(path.join(out, 'static', urlPath)) && urlPath !== '/' && statSync(path.join(out, 'static', urlPath)).isFile()) return { static: urlPath }; continue; }
    if (phase !== 'filesystem' || !r.src) continue;
    const m = new RegExp(r.src).exec(urlPath);
    if (!m) continue;
    if (r.status && !r.dest) return { status: r.status };
    if (r.dest) {
      const dest = r.dest.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? '');
      const [destPath, query = ''] = dest.split('?');
      if (destPath === '/api/index') return { fn: true, path: destPath, query };
      if (existsSync(path.join(out, 'static', destPath))) return { static: destPath };
    }
  }
  return { status: 404 };
}
const expectStatic = { '/': '/index.html', '/terrain': '/index.html', '/verification/report': '/index.html', '/assets/lroc-south-pole.jpg': '/assets/lroc-south-pole.jpg' };
for (const [p, want] of Object.entries(expectStatic)) assert.deepEqual(resolve(p), { static: want }, `${p} should serve ${want}`);
for (const p of ['/api/health', '/api/terrain', '/api/terrain/metadata', '/api/ephemeris/verify', '/api/does-not-exist', '/api']) {
  assert.ok(resolve(p).fn, `${p} must reach the Go function, never HTML`);
}
assert.equal(resolve('/api/terrain/metadata').query.split('&')[0], '__route=terrain/metadata');
assert.deepEqual(resolve('/assets/missing-chunk.js'), { status: 404 }, 'a missing asset must be a 404, not the HTML shell');
ok('generated routes: SPA fallback for client routes; every /api/* path reaches the function; missing assets 404');

// ---------------------------------------------------------------- execute the function
console.log('executing the built Go function (Lambda runtime emulator)');
const pending = [];
let waiting = null;
const results = new Map();
const emulator = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (req.method === 'GET' && req.url.endsWith('/runtime/invocation/next')) {
      const deliver = (job) => {
        res.writeHead(200, { 'Lambda-Runtime-Aws-Request-Id': job.id, 'Lambda-Runtime-Deadline-Ms': String(Date.now() + 60000),
          'Lambda-Runtime-Invoked-Function-Arn': 'arn:aws:lambda:local:0:function:chandra', 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ body: JSON.stringify(job.request) }));
      };
      if (pending.length) deliver(pending.shift()); else waiting = deliver;
      return;
    }
    const m = /\/runtime\/invocation\/([^/]+)\/(response|error)$/.exec(req.url);
    if (req.method === 'POST' && m) {
      results.get(m[1])?.({ kind: m[2], body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(202); res.end('{}');
      return;
    }
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => emulator.listen(0, '127.0.0.1', r));
const child = spawn(bootstrap, [], {
  // VERCEL is deliberately absent: the function must identify itself as a Vercel
  // deployment even when the project does not expose system variables at runtime.
  env: { PATH: process.env.PATH, HOME: process.env.HOME ?? '/tmp', CHANDRA_RATE_LIMIT: 'off', CHANDRA_HORIZONS: 'off',
    AWS_LAMBDA_RUNTIME_API: `127.0.0.1:${emulator.address().port}`, AWS_LAMBDA_FUNCTION_NAME: 'chandra', _HANDLER: 'bootstrap' },
  stdio: ['ignore', 'inherit', 'inherit'], cwd: path.dirname(bootstrap),
});
let seq = 0;
function invoke(method, urlPath, body) {
  const route = resolve(urlPath.split('?')[0]);
  assert.ok(route.fn, `${urlPath} did not route to the function`);
  const extra = urlPath.includes('?') ? `&${urlPath.split('?')[1]}` : '';
  const request = { host: 'chandra.local', path: `${route.path}?${route.query}${extra}`, method,
    headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : '' };
  const job = { id: `req-${++seq}`, request };
  return new Promise((resolveJob, reject) => {
    const timer = setTimeout(() => reject(new Error(`function did not answer ${method} ${urlPath}`)), 30000);
    results.set(job.id, (r) => {
      clearTimeout(timer);
      if (r.kind === 'error') return reject(new Error(`function error: ${r.body}`));
      const parsed = JSON.parse(r.body);
      const text = parsed.encoding === 'base64' ? Buffer.from(parsed.body, 'base64').toString('utf8') : parsed.body;
      resolveJob({ status: parsed.statusCode, headers: parsed.headers, json: JSON.parse(text) });
    });
    if (waiting) { const deliver = waiting; waiting = null; deliver(job); } else pending.push(job);
  });
}
try {
  const health = await invoke('GET', '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.engine, 'chandra-native-go');
  const cfg = await invoke('GET', '/api/config');
  assert.equal(cfg.json.deployment, 'vercel');
  assert.equal(cfg.json.dem_ready, false, 'no DEM ships with the deployment');
  assert.deepEqual(cfg.json.storage, { kind: 'local', persistent: false }, 'without a Blob store the function must report its storage as temporary');
  assert.equal(cfg.json.storage.kind, 'local');
  const terrain = await invoke('POST', '/api/terrain', { latitude: -89.5, longitude: 45, radius_km: 2, quality: 'low', mode: 'synthetic' });
  assert.equal(terrain.status, 200);
  assert.equal(terrain.json.synthetic, true);
  assert.equal(terrain.json.grid.elevations_m.length, 129 * 129);
  const real = await invoke('POST', '/api/terrain', { latitude: -89.5, longitude: 45, radius_km: 2, quality: 'low', mode: 'real' });
  assert.equal(real.status, 400, 'real mode without a DEM must fail explicitly, never fall back');
  assert.match(real.json.error, /No DEM configured/);
  const horizon = await invoke('POST', '/api/horizon', { latitude: -89.5, longitude: 45, radius_km: 2, quality: 'low', mode: 'synthetic', az_step_deg: 10 });
  assert.equal(horizon.json.azimuths_deg.length, 36);
  const sources = await invoke('GET', '/api/sources');
  assert.ok(sources.json.sources.length >= 15 && sources.json.runtime.deployment === 'vercel');
  const meta = await invoke('GET', '/api/terrain/metadata?dataset_id=configured');
  assert.equal(meta.status, 400);
  const missing = await invoke('GET', '/api/does-not-exist');
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error, 'Unknown API endpoint.');
  assert.match(String(missing.headers['Content-Type'] ?? missing.headers['content-type']), /application\/json/);
  const verify = await invoke('POST', '/api/ephemeris/verify', { site: {} });
  assert.equal(verify.status, 503, 'Horizons was disabled for this offline run and must say so');
  ok('built function answered health, config, terrain (synthetic + real-mode refusal), horizon, sources, metadata, 404 and verify through the generated rewrites');
} finally {
  child.kill('SIGKILL');
  emulator.close();
}
console.log('Vercel build output validated and executed locally. Live deployment still requires a Vercel account.');
