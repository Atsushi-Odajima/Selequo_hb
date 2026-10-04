// Renders PWA / app icons and the horizontal logo from the SVG sources with headless Chromium.
// Inter (SIL OFL 1.1, @fontsource/inter) is used for the wordmark; no font is extracted from the brand board image.
import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';

const symbol = (await readFile('src/web/assets/symbol.svg', 'utf8')).replace(/<\?xml[^>]*>/, '');
const inter = (await readFile('node_modules/@fontsource/inter/files/inter-latin-800-normal.woff2')).toString('base64');
const fontCss = `@font-face{font-family:InterX;font-weight:800;src:url(data:font/woff2;base64,${inter}) format('woff2')}`;
const shapes = symbol.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replaceAll('#1E3A8A', '#3557D6').replaceAll('#2B4FC2', '#3557D6');
const iconSvg = (size, { pad, radius, bg }) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512"><rect width="512" height="512" rx="${radius}" fill="${bg}"/><g transform="translate(${256 - 197 * pad} ${256 - 231 * pad}) scale(${pad})">${shapes}</g></svg>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
async function png(svg, w, h, out) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><head><style>${fontCss} html,body{margin:0;background:transparent}</style></head><body>${svg}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await writeFile(out, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } }));
}
const sized = (s, n) => s.replace('width="512" height="512"', `width="${n}" height="${n}"`);
const std = iconSvg(512, { pad: 0.95, radius: 112, bg: '#0B0F1A' });
const maskable = iconSvg(512, { pad: 0.7, radius: 0, bg: '#0B0F1A' });
await writeFile('public/icons/icon.svg', std);
for (const n of [512, 192, 180, 32]) await png(sized(std, n), n, n, `public/icons/${n === 180 ? 'apple-touch-icon' : 'icon-' + n}.png`);
await png(sized(maskable, 512), 512, 512, 'public/icons/maskable-512.png');
// horizontal logo (symbol + wordmark + tagline)
const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="360" viewBox="0 0 1200 360"><rect width="1200" height="360" fill="#fff"/>
<g transform="translate(-20 -40) scale(0.95)">${symbol.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}</g>
<text x="370" y="225" font-family="InterX" font-weight="800" font-size="190" letter-spacing="-6" fill="#0B0F1A">Selequo</text>
<text x="378" y="300" font-family="InterX" font-weight="800" font-size="30" letter-spacing="14" fill="#0B0F1A">COMPARE. CLARIFY. DECIDE.</text></svg>`;
await png(logo, 1200, 360, 'public/icons/logo-horizontal.png');
await writeFile('public/icons/logo-horizontal.svg', logo.replace('font-family="InterX"', 'font-family="Inter, sans-serif"').replace('font-family="InterX"', 'font-family="Inter, sans-serif"'));
await browser.close();
console.log('icons generated');
