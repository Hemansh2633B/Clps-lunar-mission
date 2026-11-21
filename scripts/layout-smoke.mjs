import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(30000);

const assert = (condition, message) => {
  if (!condition) throw new Error(`LAYOUT ASSERTION FAILED: ${message}`);
};

try {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.locator('.app-header .display').waitFor();
  const skip = page.getByRole('button', { name: 'Skip for now' });
  if (await skip.count()) await skip.click();
  await page.locator('.workspace').waitFor();

  assert(await page.locator('.ticker').count() === 0, 'decorative ticker has been removed');
  assert(await page.locator('.app-header').innerText().then((text) => text.includes('LUNAR MISSION ANALYSIS')), 'header describes the full lunar mission scope');
  assert(await page.getByRole('radio', { name: /PLAN/i }).count() === 1, 'Plan mode is available');
  assert(await page.getByRole('radio', { name: /TEACH/i }).count() === 1, 'Teach mode is available');

  const clock = page.getByRole('button', { name: /Mission clock/ });
  assert(await clock.count() === 1, 'mission clock disclosure is present');
  assert(await clock.getAttribute('aria-expanded') === 'false', 'mission clock starts collapsed');
  await clock.click();
  assert(await page.locator('#mission-clock-details').isVisible(), 'clock details open on activation');
  assert(await page.locator('#mission-clock-details .cluster').count() === 4, 'all four scientific clock readouts remain available');
  await clock.click();
  assert(!(await page.locator('#mission-clock-details').isVisible()), 'clock details close on second activation');

  for (const viewport of [
    { width: 1440, height: 960, label: 'desktop' },
    { width: 1024, height: 768, label: 'tablet' },
    { width: 390, height: 844, label: 'phone' },
    { width: 320, height: 568, label: 'narrow phone' },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(100);
    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const r = element.getBoundingClientRect();
        return { top: r.top, left: r.left, right: r.right, width: r.width };
      };
      const workspace = document.querySelector('.workspace');
      return {
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        columns: getComputedStyle(workspace).gridTemplateColumns.split(' ').length,
        center: rect('.center-stack'),
        sites: rect('.site-rail'),
        telemetry: rect('.telemetry-rail'),
      };
    });
    assert(layout.scrollWidth <= layout.viewportWidth, `${viewport.label}: no page-level horizontal overflow (${layout.scrollWidth}px > ${layout.viewportWidth}px)`);
    assert(layout.center && layout.sites && layout.telemetry, `${viewport.label}: all core workspace regions exist`);
    if (viewport.width > 900) {
      assert(layout.columns >= 3, 'desktop retains the three-column planning layout');
      assert(layout.sites.left < layout.center.left && layout.center.left < layout.telemetry.left, 'desktop rail ordering is sites → analysis → telemetry');
    } else {
      assert(layout.center.top <= layout.sites.top && layout.sites.top <= layout.telemetry.top, `${viewport.label}: mobile reading order is analysis → sites → telemetry`);
    }

    const clockButton = page.getByRole('button', { name: /Mission clock/ });
    await clockButton.click();
    assert(await page.locator('#mission-clock-details').isVisible(), `${viewport.label}: mission clock opens`);
    const expandedWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    assert(expandedWidth <= viewport.width, `${viewport.label}: expanded clock does not cause horizontal overflow`);
    await clockButton.click();
  }
  console.log('Responsive layout smoke passed: desktop, tablet, 390px and 320px; clock disclosure; mobile reading order; no page-level horizontal overflow.');
} finally {
  await browser.close();
}
