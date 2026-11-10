// Opens the map page and the README image in Chromium, Firefox and WebKit, the engine inside Safari.
// CI installs Playwright for this. Locally: npm install --no-save playwright, then node tests/browser.mjs [chromium firefox webkit]
// Set PW_CHANNEL=chrome to use an installed Chrome instead of Playwright's Chromium.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from '../skills/skill-map/scripts/skill-map.mjs';

const pw = await import('playwright');
const TRIP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'trip');
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox', 'webkit'];
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-map-browser-'));
await run([TRIP, '--out', out], { log: () => {} });
fs.writeFileSync(path.join(out, 'img.html'), '<!doctype html><img id="i" src="skill-map.svg" alt="">');
const url = (f) => pathToFileURL(path.join(out, f)).href;

let failed = 0;
for (const name of names) {
  const browser = await pw[name].launch(name === 'chromium' && process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const checks = [];
  const check = (what, ok) => checks.push([what, !!ok]);
  try {
    await page.goto(url('skill-map.html'));
    await page.waitForSelector('#map .sm-n');
    check('draws six skills', (await page.locator('#map .sm-n').count()) === 6);
    check('plays chains', (await page.locator('#map animateMotion').count()) > 0);
    const at = async (id) => {
      const i = await page.evaluate((x) => window.app.S.map.nodes.findIndex((n) => n.id === x), id);
      const box = await page.locator('#map .sm-n[data-i="' + i + '"] circle').nth(1).boundingBox();
      return [box.x + box.width / 2, box.y + box.height / 2];
    };
    let [x, y] = await at('plan-trip');
    await page.mouse.move(x, y);
    await page.waitForTimeout(400);
    check('hover lights the chain', (await page.locator('#map .sm-e.h1').count()) > 0);
    await page.mouse.click(x, y);
    await page.waitForSelector('#panel.open');
    check('click opens the panel', (await page.textContent('#panel h2')) === 'plan-trip');
    check('panel shows the sentence', (await page.textContent('#panel')).includes('Use the `book-flight` skill to buy the tickets.'));
    await page.keyboard.press('Escape');
    await page.fill('#q', 'pack');
    await page.press('#q', 'Enter');
    check('search finds a skill', (await page.textContent('#panel h2')) === 'pack-bag');
    // Filters: size by every sentence that names a skill, and hand-offs only.
    await page.click('#filtersBtn');
    await page.click('#sizeSeg [data-v="named"]');
    check('size filter applies', (await page.getAttribute('#sizeSeg [data-v="named"]', 'aria-pressed')) === 'true' && (await page.evaluate(() => window.app.S.sizeBy)) === 'named');
    await page.click('#swMent');
    check('mentions filter hides dashed lines', (await page.locator('#map .sm-e.m').count()) === 0);
    await page.click('#swMent');
    // The image maker: a square light image with the open skill lit, saved as a PNG at twice the size and as an SVG.
    await page.click('#makeImg');
    await page.waitForSelector('#studio[open]');
    await page.click('#stFormat [data-v="square"]');
    await page.click('#stTheme [data-v="light"]');
    const pv = await page.evaluate(() => decodeURIComponent(document.getElementById('stImg').src.split(',')[1]));
    check('image maker previews the options', pv.includes('viewBox="0 0 1200 1200"') && pv.includes('fill="#ffffff"') && pv.includes('The chains from pack-bag'));
    let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#stPng')]);
    const png = fs.readFileSync(await dl.path());
    check('saves a PNG at twice the size', png.slice(1, 4).toString() === 'PNG' && png.readUInt32BE(16) === 2400 && png.readUInt32BE(20) === 2400 && dl.suggestedFilename() === 'skill-map-square-pack-bag.png');
    await page.click('#stFormat [data-v="readme"]');
    await page.click('#stFocus');
    [dl] = await Promise.all([page.waitForEvent('download'), page.click('#stSvg')]);
    const svgOut = fs.readFileSync(await dl.path(), 'utf8');
    check('saves the README SVG', dl.suggestedFilename() === 'skill-map.svg' && svgOut.includes('<animateMotion') && svgOut.includes('viewBox="0 0 900 940"'));
    await page.keyboard.press('Escape');
    check('Escape closes the image maker', !(await page.evaluate(() => document.getElementById('studio').open)));
    await page.goto(url('img.html'));
    const w = await page.evaluate(() => new Promise((r) => { const im = document.getElementById('i'); if (im.complete && im.naturalWidth) r(im.naturalWidth); else { im.onload = () => r(im.naturalWidth); im.onerror = () => r(0); } }));
    check('the image loads in an <img>', w === 900);
    await page.setViewportSize({ width: 920, height: 960 });
    const a = await page.screenshot();
    await page.waitForTimeout(1500);
    const b = await page.screenshot();
    check('the image moves', !a.equals(b));
  } catch (e) { errors.push('stopped: ' + e.message.split('\n')[0]); }
  check('no errors', !errors.length);
  await browser.close();
  for (const [what, ok] of checks) { console.log((ok ? 'ok   ' : 'FAIL ') + name + ': ' + what); if (!ok) failed++; }
  errors.forEach((e) => console.log('     ' + name + ' error: ' + e));
}
fs.rmSync(out, { recursive: true, force: true });
if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('All passed in ' + names.join(', ') + '.');
