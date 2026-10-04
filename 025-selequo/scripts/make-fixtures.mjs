// Generates binary sample fixtures (PDF spec sheet, phone screenshot PNG) from HTML sources with headless Chromium.
import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
await page.setContent(await readFile('fixtures/sample/raw/pro16-specsheet.html', 'utf8'));
await writeFile('fixtures/sample/raw/pro16-specsheet.pdf', await page.pdf({ format: 'A4' }));
const shot = await browser.newPage({ viewport: { width: 390, height: 300 }, deviceScaleFactor: 2 });
await shot.setContent(await readFile('fixtures/sample/raw/lite15-screenshot.html', 'utf8'));
await writeFile('fixtures/sample/raw/lite15-screenshot.png', await shot.screenshot());
await browser.close();
console.log('fixtures generated');
