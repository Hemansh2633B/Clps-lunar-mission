// Runs one of the native commands in ./cmd:  node scripts/go-run.mjs <command> [args…]
import { spawnSync } from 'node:child_process';
import { buildCommand } from './go-bin.mjs';

const [name, ...args] = process.argv.slice(2);
if (!name) { console.error('usage: node scripts/go-run.mjs <command> [args…]'); process.exit(2); }
let binary;
try { binary = buildCommand(name); } catch (err) { console.error(err.message); process.exit(1); }
process.exit(spawnSync(binary, args, { stdio: 'inherit' }).status ?? 1);
