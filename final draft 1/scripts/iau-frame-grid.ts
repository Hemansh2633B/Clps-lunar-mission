// Dumps the astronomy-engine IAU 2015 Moon frame (IAU->J2000, row-major) on a
// monthly grid. Consumed by scripts/generate-frame-constants.py so the shipped
// ME->IAU correction targets the app's ACTUAL ephemeris frame.
import * as A from 'astronomy-engine';
import { moonBodyFrame } from '../src/engine/ephemeris';
const out: string[] = [];
for (let y = 2020; y <= 2035; y++) for (let m = 0; m < 12; m++) {
  const iso = new Date(Date.UTC(y, m, 15)).toISOString();
  const f = moonBodyFrame(new A.AstroTime(new Date(Date.parse(iso))));
  out.push([iso, f.x.x, f.y.x, f.z.x, f.x.y, f.y.y, f.z.y, f.x.z, f.y.z, f.z.z].join(','));
}
console.log(out.join('\n'));
