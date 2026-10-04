import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const F = (host: string, file: string) => `https://${host}.selequo.invalid/${file}`;
let n = 0;
export const uniqueEmail = (p = 'e2e') => `${p}-${Date.now()}-${n++}@example.com`;

/** Sign up through the UI and return workspace id + csrf for API helpers. */
export async function signupUI(page: Page, name = 'E2Eユーザー') {
  const email = uniqueEmail();
  await page.goto('/signup');
  await page.getByLabel('お名前').fill(name);
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード').fill('correct-horse-battery');
  await page.getByRole('button', { name: '登録してはじめる' }).click();
  await page.waitForURL(/\/w\/[0-9a-f-]+$/);
  const ws = page.url().split('/w/')[1];
  const me = await (await page.request.get('/api/auth/me')).json();
  return { ws, csrf: me.csrf as string, email };
}

export function apiOf(req: APIRequestContext, ws: string, csrf: string) {
  const h = { 'x-csrf-token': csrf };
  const wrap = async (r: Promise<any>) => {
    const res = await r;
    expect(res.status(), await res.text()).toBeLessThan(400);
    return res.json();
  };
  return {
    get: (p: string) => wrap(req.get(`/api/w/${ws}${p}`)),
    post: (p: string, data?: unknown) => wrap(req.post(`/api/w/${ws}${p}`, { data: data ?? {}, headers: h })),
    patch: (p: string, data?: unknown) => wrap(req.patch(`/api/w/${ws}${p}`, { data: data ?? {}, headers: h })),
    put: (p: string, data?: unknown) => wrap(req.put(`/api/w/${ws}${p}`, { data: data ?? {}, headers: h })),
  };
}

export async function waitSourcesReady(page: Page, count: number) {
  await expect(page.getByTestId('source-row')).toHaveCount(count, { timeout: 30_000 });
  await expect(page.getByText('処理中', { exact: true })).toHaveCount(0, { timeout: 45_000 });
}
