// Device-class checks (emulated): iPhone / Android / iPad / Desktop. Real-device testing is still required before release.
import { devices, expect, test } from '@playwright/test';
import { apiOf, F, signupUI, waitSourcesReady } from './helpers';

const DEVICES = [
  { name: 'iPhone 13', d: devices['iPhone 13'], mobile: true },
  { name: 'Pixel 7 (Android)', d: devices['Pixel 7'], mobile: true },
  { name: 'iPad Pro 11', d: devices['iPad Pro 11'], mobile: false },
];

test('pair compare, bottom nav and no horizontal page overflow on phones/tablets', async ({ browser, page }) => {
  const { ws, csrf } = await signupUI(page);
  const api = apiOf(page.request, ws, csrf);
  const p = await api.post('/projects', { title: 'Device E2E', category: 'laptop' });
  const air = await api.post(`/projects/${p.id}/candidates`, { name: 'Arcfield Air 14' });
  const pro = await api.post(`/projects/${p.id}/candidates`, { name: 'Arcfield Pro 16' });
  await api.post(`/projects/${p.id}/sources/url`, { url: F('official', 'air14.html'), candidateId: air.id, quality: 'official' });
  await api.post(`/projects/${p.id}/sources/url`, { url: F('official', 'pro16.html'), candidateId: pro.id, quality: 'official' });
  await page.goto(`/w/${ws}/p/${p.id}/import`);
  await waitSourcesReady(page, 2);
  const state = await page.context().storageState();
  for (const dev of DEVICES) {
    const ctx = await browser.newContext({ ...dev.d, baseURL: page.url().split('/w/')[0], storageState: state });
    const m = await ctx.newPage();
    await m.goto(`/w/${ws}/p/${p.id}/compare`);
    if (dev.mobile) {
      await expect(m.getByTestId('pair-picker'), dev.name).toBeVisible();
      await expect(m.getByTestId('pair-list')).toContainText('32 GB');
      await expect(m.locator('.bottom-nav')).toBeVisible();
      // tap a value → evidence drawer
      await m.getByTestId('pair-list').getByRole('button', { name: '32 GB' }).click();
      await expect(m.getByRole('dialog', { name: '根拠（Evidence）' })).toBeVisible();
      await m.getByRole('button', { name: '閉じる' }).click();
      await m.getByRole('button', { name: 'カード' }).click();
      await expect(m.getByRole('heading', { name: 'Arcfield Pro 16' })).toBeVisible();
    } else {
      await expect(m.getByTestId('compare-table'), dev.name).toBeVisible();
    }
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${dev.name} horizontal overflow`).toBeLessThanOrEqual(1);
    for (const path of ['', '/import', '/questions', '/decision', '/criteria']) {
      await m.goto(`/w/${ws}/p/${p.id}${path}`);
      await m.waitForLoadState('networkidle');
      const o = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(o, `${dev.name} ${path} overflow`).toBeLessThanOrEqual(1);
    }
    await ctx.close();
  }
});

test('PWA: manifest, icons and service worker are served', async ({ page, request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some((i: any) => i.purpose === 'maskable')).toBe(true);
  for (const i of manifest.icons) expect((await request.get(i.src)).status(), i.src).toBe(200);
  const sw = await request.get('/sw.js');
  expect(sw.status()).toBe(200);
  expect(await sw.text()).toContain("startsWith('/api/')"); // API data is never cached
  await page.goto('/login');
  await expect(page.locator('link[rel=manifest]')).toHaveAttribute('href', '/manifest.webmanifest');
});

test('accessibility basics: labelled controls, landmarks, keyboard focus on compare cells', async ({ page }) => {
  const { ws, csrf } = await signupUI(page);
  const api = apiOf(page.request, ws, csrf);
  const p = await api.post('/projects', { title: 'A11y E2E', category: 'laptop' });
  const air = await api.post(`/projects/${p.id}/candidates`, { name: 'Arcfield Air 14' });
  await api.post(`/projects/${p.id}/sources/url`, { url: F('official', 'air14.html'), candidateId: air.id, quality: 'official' });
  await page.goto(`/w/${ws}/p/${p.id}/import`);
  await waitSourcesReady(page, 1);
  for (const path of ['', '/import', '/review', '/compare', '/criteria', '/questions', '/decision', '/settings']) {
    await page.goto(`/w/${ws}/p/${p.id}${path}`);
    await page.waitForLoadState('networkidle');
    const unlabeled = await page.evaluate(() =>
      [...document.querySelectorAll('input:not([type=hidden]):not(.sr-only), select, textarea')]
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .filter((el) => !el.getAttribute('aria-label') && !el.closest('label') && !(el.id && document.querySelector(`label[for="${el.id}"]`)) && !el.getAttribute('placeholder'))
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(unlabeled, path).toEqual([]);
    await expect(page.getByRole('navigation', { name: 'メインメニュー' })).toBeAttached();
  }
  await page.goto(`/w/${ws}/p/${p.id}/compare`);
  const cell = page.getByTestId('cell-weight').first();
  await cell.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '根拠（Evidence）' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
