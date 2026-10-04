import { readFileSync } from 'node:fs';
import { devices, expect, test } from '@playwright/test';
import { apiOf, F, signupUI, waitSourcesReady } from './helpers';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
});

test('1) 3候補 URL/PDF/Screenshot → 抽出 → 正規化 → 比較 → 不足情報 → Brief', async ({ page }) => {
  await signupUI(page);
  await page.getByRole('button', { name: '新しい比較' }).click();
  await page.getByLabel('タイトル').fill('E2E ノートPC比較');
  await page.getByRole('button', { name: '作成して情報を取り込む' }).click();
  await page.waitForURL(/\/import$/);
  for (const name of ['Arcfield Air 14', 'Arcfield Pro 16', 'Arcfield Lite 15']) {
    await page.getByLabel('候補名').fill(name);
    await page.getByRole('button', { name: '追加' }).last().click();
    await expect(page.locator('.list-item b', { hasText: name })).toBeVisible();
  }
  const add = async (cand: string, url: string, quality: string) => {
    await page.getByLabel('候補', { exact: true }).selectOption({ label: cand });
    await page.getByLabel('出典の種類（Source Quality）').selectOption(quality);
    await page.getByPlaceholder('https://').fill(url);
    await page.getByRole('button', { name: 'URLを取り込む' }).click();
    await expect(page.getByPlaceholder('https://')).toHaveValue('');
  };
  await add('Arcfield Air 14', F('official', 'air14.html'), 'official');
  await add('Arcfield Air 14', F('shop', 'air14.html'), 'marketplace');
  await add('Arcfield Pro 16', F('official', 'pro16.html'), 'official');
  await add('Arcfield Lite 15', F('official', 'lite15.html'), 'official');
  await page.getByRole('tab', { name: 'PDF・スクショ・CSV' }).click();
  await page.getByLabel('候補', { exact: true }).selectOption({ label: 'Arcfield Pro 16' });
  await page.getByLabel('出典の種類（Source Quality）').selectOption('manufacturer');
  await page.locator('input[type=file][accept="application/pdf"]').setInputFiles('fixtures/sample/raw/pro16-specsheet.pdf');
  await page.getByLabel('候補', { exact: true }).selectOption({ label: 'Arcfield Lite 15' });
  await page.locator('input[type=file][accept^="image/"]').setInputFiles('fixtures/sample/raw/lite15-screenshot.png');
  await waitSourcesReady(page, 6);

  // review: confirm all mapped facts
  await page.getByRole('link', { name: '根拠レビュー' }).click();
  await expect(page.getByTestId('fact-row').first()).toBeVisible();
  await page.getByRole('button', { name: '項目ありを全選択' }).click();
  await page.getByRole('button', { name: /選択をConfirm/ }).click();
  await expect(page.getByRole('button', { name: '選択をConfirm（0）' })).toBeVisible();

  // compare: normalization + Unknown
  await page.getByRole('link', { name: '比較表' }).first().click();
  const table = page.getByTestId('compare-table');
  await expect(table).toBeVisible();
  const memRow = table.locator('tr', { has: page.locator('th.attr', { hasText: 'メモリ' }) });
  await expect(memRow).toContainText('16 GB');
  await expect(memRow).toContainText('32 GB');
  const storageRow = table.locator('tr', { has: page.locator('th.attr', { hasText: 'ストレージ' }) });
  await expect(storageRow).toContainText('1024 GB'); // 1TB → 1024GB
  const batteryRow = table.locator('tr', { has: page.locator('th.attr', { hasText: 'バッテリー駆動時間' }) });
  await expect(batteryRow.locator('td').nth(2)).toContainText('Unknown');

  // PDF page citation in evidence
  await table.locator('tr', { has: page.locator('th.attr', { hasText: 'バッテリー駆動時間' }) }).locator('td').nth(1).click();
  await expect(page.getByRole('dialog', { name: '根拠（Evidence）' })).toBeVisible();
  await page.getByRole('button', { name: '閉じる' }).click();

  // missing information
  await page.getByRole('link', { name: /不明点・質問/ }).click();
  await expect(page.getByTestId('missing-item').filter({ hasText: 'Arcfield Lite 15 / バッテリー駆動時間' })).toBeVisible();

  // brief
  await page.getByRole('link', { name: 'Decision Brief' }).click();
  await expect(page.getByTestId('brief')).toContainText('主な違い');
  await expect(page.getByTestId('brief')).toContainText('Unknown');
  const dl = page.waitForEvent('download');
  await page.getByRole('link', { name: 'MD' }).click();
  const md = readFileSync(await (await dl).path(), 'utf8');
  expect(md).toContain('# Decision Brief: E2E ノートPC比較');
  expect(md).toContain('## Evidence（出典）');
  expect(md).toContain('official.selequo.invalid');
});

test('2) 公式/販売サイトの Conflict → Review → 出典を保持', async ({ page }) => {
  const { ws, csrf } = await signupUI(page);
  const api = apiOf(page.request, ws, csrf);
  const p = await api.post('/projects', { title: 'Conflict E2E', category: 'laptop' });
  const air = await api.post(`/projects/${p.id}/candidates`, { name: 'Arcfield Air 14' });
  await api.post(`/projects/${p.id}/sources/url`, { url: F('official', 'air14.html'), candidateId: air.id, quality: 'official' });
  await api.post(`/projects/${p.id}/sources/url`, { url: F('shop', 'air14.html'), candidateId: air.id, quality: 'marketplace' });
  await page.goto(`/w/${ws}/p/${p.id}/import`);
  await waitSourcesReady(page, 2);
  await page.goto(`/w/${ws}/p/${p.id}/questions`);
  const conflict = page.getByTestId('conflict-item').filter({ hasText: '重量' });
  await expect(conflict).toContainText('1.18 kg vs 1.25 kg');
  await conflict.getByRole('button', { name: '根拠を確認' }).click();
  const drawer = page.getByRole('dialog', { name: '根拠（Evidence）' });
  await expect(drawer).toContainText('Conflict');
  await expect(drawer).toContainText('official.selequo.invalid');
  await drawer.getByRole('button', { name: /表示中の値（約1.18kg）を採用/ }).click();
  await expect(drawer.getByText('Superseded')).toBeVisible();
  await page.getByRole('button', { name: '閉じる' }).click();
  await expect(page.getByTestId('conflict-item')).toHaveCount(0);
  // the superseded shop value is still kept with its source
  const facts = await api.get(`/projects/${p.id}/facts?attributeKey=weight`);
  const shop = facts.find((f: any) => f.rawValue === '1.25kg');
  expect(shop.reviewState).toBe('superseded');
  expect(shop.sourceId).toBeTruthy();
});

test('3) SaaS 月額/年額/席数 → Scenario 比較', async ({ page }) => {
  const { ws, csrf } = await signupUI(page);
  const api = apiOf(page.request, ws, csrf);
  const p = await api.post('/projects', { title: 'SaaS E2E', category: 'saas', defaultParams: { seats: 10, costBasis: 'annual_total' } });
  const ids: Record<string, string> = {};
  for (const n of ['alpha', 'beta', 'gamma']) {
    ids[n] = (await api.post(`/projects/${p.id}/candidates`, { name: n.toUpperCase() })).id;
    await api.post(`/projects/${p.id}/sources/url`, { url: F('saas', `${n}.html`), candidateId: ids[n], quality: 'official' });
  }
  await page.goto(`/w/${ws}/p/${p.id}/import`);
  await waitSourcesReady(page, 3);
  const facts = await api.get(`/projects/${p.id}/facts?kind=fact&state=candidate`);
  await api.post(`/projects/${p.id}/facts/bulk-review`, { factIds: facts.filter((f: any) => f.attributeKey).map((f: any) => f.id), action: 'confirm' });
  const cost = await api.post(`/projects/${p.id}/criteria`, { name: '年間コスト', weight: 5, direction: 'lower_better', linkedAttributes: ['price'] });
  const sso = await api.post(`/projects/${p.id}/criteria`, { name: 'SSO', weight: 3, direction: 'boolean', linkedAttributes: ['sso'], mustHave: true });
  // scenarios through the UI
  await page.goto(`/w/${ws}/p/${p.id}/criteria`);
  await page.getByRole('button', { name: 'Scenarioを追加' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Scenario名').fill('Small Team');
  await dlg.getByLabel('年間コストのWeight').fill('10');
  await dlg.getByLabel('SSOのWeight').fill('0');
  await page.getByRole('dialog').getByRole('checkbox').last().uncheck();
  await page.getByLabel(/席数/).fill('5');
  await page.getByRole('button', { name: '保存' }).click();
  await page.getByRole('button', { name: 'Scenarioを追加' }).click();
  await dlg.getByLabel('Scenario名').fill('Enterprise Security');
  await dlg.getByLabel('年間コストのWeight').fill('1');
  await dlg.getByLabel('SSOのWeight').fill('10');
  await page.getByLabel(/席数/).fill('40');
  await page.getByRole('button', { name: '保存' }).click();
  const matrix = page.getByTestId('scenario-matrix');
  await expect(matrix.locator('tr', { hasText: 'Small Team' }).locator('td').nth(1)).toContainText('このScenarioで最も高い'); // BETA (cheapest monthly, no SSO not required)
  await expect(matrix.locator('tr', { hasText: 'Enterprise Security' }).locator('td').nth(1)).not.toContainText('このScenarioで最も高い');
  await expect(page.getByText('条件（Scenario）によって、スコアが最も高い候補が変わります。')).toBeVisible();
  // monthly and annual are shown as separate offers, never as a conflict
  await page.goto(`/w/${ws}/p/${p.id}/compare`);
  const priceRow = page.getByTestId('compare-table').locator('tr', { has: page.locator('th.attr', { hasText: '価格' }) });
  await expect(priceRow.locator('td').first()).toContainText('¥1,200/月/席');
  await expect(priceRow.locator('td').first()).toContainText('¥12,000/年/席');
  await expect(priceRow).not.toContainText('Conflict');
  expect(cost.id && sso.id).toBeTruthy();
});

test('4) Must-have Unknown → 追加Source → Pass', async ({ page }) => {
  const { ws, csrf } = await signupUI(page);
  const api = apiOf(page.request, ws, csrf);
  const p = await api.post('/projects', { title: 'Must-have E2E', category: 'laptop' });
  const lite = await api.post(`/projects/${p.id}/candidates`, { name: 'Arcfield Lite 15' });
  await api.post(`/projects/${p.id}/sources/url`, { url: F('official', 'lite15.html'), candidateId: lite.id, quality: 'official' });
  await api.post(`/projects/${p.id}/criteria`, { name: 'バッテリー8時間以上', weight: 5, direction: 'higher_better', linkedAttributes: ['battery_life'], mustHave: true, target: { op: '>=', value: 8, unit: 'h' } });
  await page.goto(`/w/${ws}/p/${p.id}/compare`);
  await expect(page.getByTestId('compare-table').locator('.score-row')).toContainText('Unknown');
  // add a vendor answer as a text source, confirm it
  await page.goto(`/w/${ws}/p/${p.id}/import`);
  await page.getByRole('tab', { name: 'テキスト' }).click();
  await page.getByLabel('候補', { exact: true }).selectOption({ label: 'Arcfield Lite 15' });
  await page.getByLabel('出典の種類（Source Quality）').selectOption('vendor');
  await page.getByLabel('タイトル').fill('販売店からの回答');
  await page.getByRole('textbox', { name: /テキスト/ }).fill('バッテリー駆動時間: 最大9時間');
  await page.getByRole('button', { name: 'テキストを取り込む' }).click();
  await waitSourcesReady(page, 2);
  await page.goto(`/w/${ws}/p/${p.id}/review`);
  await expect(page.getByTestId('fact-row').first()).toBeVisible();
  await page.getByRole('button', { name: '項目ありを全選択' }).click();
  await page.getByRole('button', { name: /選択をConfirm/ }).click();
  await page.goto(`/w/${ws}/p/${p.id}/compare`);
  await expect(page.getByTestId('compare-table').locator('.score-row')).toContainText('Pass');
});

test('5) iPhoneでスクショ追加 → PCで根拠レビュー（画像領域）', async ({ browser, page }) => {
  const { ws, csrf } = await signupUI(page);
  const api = apiOf(page.request, ws, csrf);
  const p = await api.post('/projects', { title: 'Screenshot E2E', category: 'laptop' });
  await api.post(`/projects/${p.id}/candidates`, { name: 'Arcfield Lite 15' });
  // phone session (same account, iPhone viewport)
  const phone = await browser.newContext({ ...devices['iPhone 13'], baseURL: page.url().split('/w/')[0], storageState: await page.context().storageState() });
  const mp = await phone.newPage();
  await mp.goto(`/w/${ws}/p/${p.id}/import`);
  await expect(mp.locator('.bottom-nav')).toBeVisible();
  await mp.getByRole('tab', { name: 'PDF・スクショ・CSV' }).click();
  await mp.locator('input[type=file][accept^="image/"]').setInputFiles('fixtures/sample/raw/lite15-screenshot.png');
  await expect(mp.getByTestId('source-row')).toHaveCount(1);
  await phone.close();
  // PC review: select a region and record the value
  await page.goto(`/w/${ws}/p/${p.id}/review`);
  const picker = page.getByTestId('region-picker');
  await expect(picker).toBeVisible();
  const box = (await picker.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.22);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.4, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText('（領域を選択済み）')).toBeVisible();
  await page.getByLabel('比較項目').selectOption({ label: '価格' });
  await page.getByLabel('ラベル（画像内の表記）').fill('セール価格');
  await page.getByLabel('値（画像に書かれている通りに）').fill('¥127,600（税込）');
  await page.getByRole('button', { name: '記録する' }).click();
  await page.getByRole('button', { name: '¥127,600（税込）' }).click();
  const drawer = page.getByRole('dialog', { name: '根拠（Evidence）' });
  await expect(drawer).toContainText('スクショ');
  await expect(drawer.locator('.region')).toBeVisible();
  await drawer.getByRole('button', { name: 'Confirm' }).click();
  await expect(drawer.getByText('Confirmed').first()).toBeVisible();
});

test('6) AI OFF → AIプロバイダ呼び出し 0 回', async ({ page }) => {
  const { ws, csrf } = await signupUI(page);
  const api = apiOf(page.request, ws, csrf);
  const p = await api.post('/projects', { title: 'AI OFF E2E', category: 'saas' });
  const c = await api.post(`/projects/${p.id}/candidates`, { name: 'Alpha' });
  await page.goto(`/w/${ws}/p/${p.id}/settings`);
  await page.getByLabel(/このプロジェクトでAI/).click();
  await expect(page.getByText('このプロジェクトでAIをOFFにしました')).toBeVisible();
  await api.post(`/projects/${p.id}/sources/url`, { url: F('saas', 'alpha.html'), candidateId: c.id });
  await page.goto(`/w/${ws}/p/${p.id}/import`);
  await waitSourcesReady(page, 1);
  await page.goto(`/w/${ws}/p/${p.id}/questions`);
  await page.getByPlaceholder(/自由に質問/).fill('SSOには対応している？');
  await page.getByRole('button', { name: '質問', exact: true }).click();
  await expect(page.getByTestId('assistant-answer')).toContainText('AIはOFF');
  await page.goto(`/w/${ws}/p/${p.id}/settings`);
  await expect(page.getByTestId('ai-calls')).toHaveText('0');
  // control: with AI ON the (mock) provider is called
  await page.getByLabel(/このプロジェクトでAI/).click();
  await expect(page.getByText('このプロジェクトでAIをONにしました')).toBeVisible();
  await page.goto(`/w/${ws}/p/${p.id}/questions`);
  await page.getByPlaceholder(/自由に質問/).fill('SSOには対応している？');
  await page.getByRole('button', { name: '質問', exact: true }).click();
  await expect(page.getByTestId('assistant-answer')).toBeVisible();
  await page.goto(`/w/${ws}/p/${p.id}/settings`);
  await expect(page.getByTestId('ai-calls')).toHaveText('1');
});

test('7) MCP「不足情報」→ 引用付きの回答', async ({ page }) => {
  const { ws, csrf } = await signupUI(page);
  const api = apiOf(page.request, ws, csrf);
  const p = await api.post('/projects', { title: 'MCP E2E', category: 'laptop' });
  const lite = await api.post(`/projects/${p.id}/candidates`, { name: 'Arcfield Lite 15' });
  const air = await api.post(`/projects/${p.id}/candidates`, { name: 'Arcfield Air 14' });
  await api.post(`/projects/${p.id}/sources/url`, { url: F('official', 'lite15.html'), candidateId: lite.id, quality: 'official' });
  await api.post(`/projects/${p.id}/sources/url`, { url: F('official', 'air14.html'), candidateId: air.id, quality: 'official' });
  await page.goto(`/w/${ws}/p/${p.id}/import`);
  await waitSourcesReady(page, 2);
  await page.goto(`/w/${ws}/settings`);
  await page.getByLabel('トークン名').fill('Codex');
  await page.getByRole('button', { name: '作成', exact: true }).first().click();
  const token = (await page.getByTestId('new-token').textContent())!.trim();
  const rpc = async (method: string, params: unknown) =>
    (await page.request.post('/mcp', { headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream' }, data: { jsonrpc: '2.0', id: 1, method, params } })).json();
  const missing = await rpc('tools/call', { name: 'ask_research_assistant', arguments: { projectId: p.id, preset: 'missing' } });
  const ans = JSON.parse(missing.result.content[0].text);
  expect(ans.answer).toContain('Arcfield Lite 15: バッテリー駆動時間 が Unknown');
  const conflicts = await rpc('tools/call', { name: 'ask_research_assistant', arguments: { projectId: p.id, preset: 'big_differences' } });
  const diff = JSON.parse(conflicts.result.content[0].text);
  expect(diff.citations.length).toBeGreaterThan(0);
  expect(diff.citations[0].sourceTitle).toBeTruthy();
  // read-only token cannot write
  const write = await rpc('tools/call', { name: 'add_candidate', arguments: { projectId: p.id, name: 'X' } });
  expect(write.result.isError).toBe(true);
});

test('8) 判断を記録 → 90日後に振り返り', async ({ page }) => {
  const { ws, csrf } = await signupUI(page, '判断 花子');
  const api = apiOf(page.request, ws, csrf);
  const p = await api.post('/projects', { title: 'Decision E2E', category: 'laptop' });
  await api.post(`/projects/${p.id}/candidates`, { name: 'Arcfield Air 14' });
  await api.post(`/projects/${p.id}/candidates`, { name: 'Arcfield Pro 16' });
  await page.goto(`/w/${ws}/p/${p.id}/decision`);
  await page.getByLabel('選んだ候補').selectOption({ label: 'Arcfield Air 14' });
  await page.getByLabel('理由').fill('出張が多く軽さを優先した');
  await page.getByLabel('振り返りまでの日数').fill('90');
  await page.getByRole('button', { name: 'この内容で判断を記録' }).click();
  const expected = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  await expect(page.getByText(`振り返り予定日: ${expected}`).first()).toBeVisible();
  await expect(page.getByText('判断 花子 さんが')).toBeVisible();
  await expect(page.getByTestId('brief')).toContainText('出張が多く軽さを優先した');
  await page.getByLabel('実際の結果').fill('軽量で移動が楽になった');
  await page.getByLabel('学び（Lessons）').fill('重量は公式値を確認する');
  await page.getByRole('button', { name: '振り返りを記録' }).click();
  await expect(page.getByText('軽量で移動が楽になった').first()).toBeVisible();
  const d = await api.get(`/projects/${p.id}/decision`);
  expect(d.status).toBe('reviewed');
});

test('9) Export → Restore → 関連の一致', async ({ page }) => {
  const { ws, csrf } = await signupUI(page);
  const api = apiOf(page.request, ws, csrf);
  const p = await api.post('/projects', { title: 'Backup E2E', category: 'laptop' });
  const air = await api.post(`/projects/${p.id}/candidates`, { name: 'Arcfield Air 14' });
  await api.post(`/projects/${p.id}/sources/url`, { url: F('official', 'air14.html'), candidateId: air.id, quality: 'official' });
  await page.goto(`/w/${ws}/p/${p.id}/import`);
  await waitSourcesReady(page, 1);
  await api.post(`/projects/${p.id}/criteria`, { name: '軽さ', weight: 3, direction: 'lower_better', linkedAttributes: ['weight'] });
  const before = await api.get(`/projects/${p.id}/facts`);
  await page.goto(`/w/${ws}/settings`);
  const dl = page.waitForEvent('download');
  await page.getByRole('link', { name: 'バックアップをダウンロード' }).click();
  const zipPath = await (await dl).path();
  await page.locator('input[type=file][accept=".zip,application/zip"]').setInputFiles(zipPath);
  await page.waitForURL((u) => !u.pathname.includes(ws) && /\/w\/[0-9a-f-]+$/.test(u.pathname), { timeout: 30_000 });
  const ws2 = page.url().split('/w/')[1];
  await expect(page.getByText('Backup E2E')).toBeVisible();
  const api2 = apiOf(page.request, ws2, csrf);
  const projects = await api2.get('/projects');
  const p2 = projects.find((x: any) => x.title === 'Backup E2E');
  const after = await api2.get(`/projects/${p2.id}/facts`);
  const sig = (fs: any[]) => fs.map((f) => `${f.attributeKey}|${f.rawValue}|${f.reviewState}|${f.sourceRange.type}`).sort();
  expect(sig(after)).toEqual(sig(before));
  const crit = await api2.get(`/projects/${p2.id}/criteria`);
  expect(crit.map((c: any) => c.name)).toEqual(['軽さ']);
  expect(new Set(after.map((f: any) => f.sourceId)).size).toBe(1);
});
