// Checks the built site in Chrome: every page, the not-found page, links
// through the router, the Lean model and its popovers, the dark mode button,
// and the pages with scripts off.  Any console error fails a check, so a
// script or style the content security policy blocks fails too.
//
//   node scripts/browser-check.mjs                  the build in dist/, served as CloudFront serves it
//   node scripts/browser-check.mjs --url https://air.dengler.io
//   node scripts/browser-check.mjs --shots DIR      also save screenshots
//
// Served locally, a path ending in / or with no extension gets its
// index.html, an unknown path gets index.csr.html with status 404, and every
// response carries the policy in ../infra/csp.txt with the hashes of the
// build's inline scripts, as infra/ sets them.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const DIST = new URL('../dist/verified-airline/browser/', import.meta.url).pathname;
const content = JSON.parse(readFileSync(new URL('../src/generated/content.json', import.meta.url)));
const shots = opt('--shots');
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? htmlFiles(p) : f.endsWith('.html') ? [p] : [];
  });
}

/** The policy in infra/csp.txt with the hash of every inline script in the build. */
function contentSecurityPolicy(dist = DIST) {
  const hashes = new Set();
  for (const f of htmlFiles(dist)) {
    for (const [, attrs, body] of readFileSync(f, 'utf8').matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (body.trim() && !/application\/json/.test(attrs)) hashes.add(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
    }
  }
  const template = readFileSync(new URL('../../infra/csp.txt', import.meta.url), 'utf8').trim();
  return template.replace('{script_hashes}', [...hashes].sort().join(' '));
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain' };

function serve() {
  const csp = contentSecurityPolicy();
  const server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    else if (!extname(path)) path += '/index.html';
    const file = join(DIST, path);
    const found = file.startsWith(DIST) && existsSync(file) && statSync(file).isFile();
    res.writeHead(found ? 200 : 404, { 'content-type': (found ? TYPES[extname(file)] : TYPES['.html']) ?? 'application/octet-stream', 'content-security-policy': csp });
    res.end(readFileSync(found ? file : join(DIST, 'index.csr.html')));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** A page that records console errors, failed requests and page errors. */
async function watched(context) {
  const page = await context.newPage();
  page.problems = [];
  page.on('console', (m) => { if (m.type() === 'error') page.problems.push(m.text()); });
  page.on('pageerror', (e) => page.problems.push(String(e)));
  return page;
}

const server = opt('--url') ? null : await serve();
const BASE = (opt('--url') ?? `http://127.0.0.1:${server.address().port}`).replace(/\/$/, '');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  // Every page, at its address with and without the final slash.
  let ctx = await browser.newContext({ colorScheme: 'light', viewport: { width: 1280, height: 900 } });
  let page = await watched(ctx);
  for (const [slug, p] of Object.entries(content.pages)) {
    for (const path of p.path === '/' ? ['/'] : [p.path, p.path.replace(/\/$/, '')]) {
      page.problems = [];
      const res = await page.goto(BASE + path, { waitUntil: 'networkidle' });
      const title = await page.title();
      const h1 = await page.locator('h1').first().textContent();
      check(`${path} renders ${slug}`, res.status() === 200 && title === p.title && !!h1?.trim() && page.problems.length === 0,
        `status ${res.status()}, title "${title}"${page.problems.length ? `, ${page.problems.join(' | ')}` : ''}`);
    }
  }
  if (shots) {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.screenshot({ path: join(shots, 'home-light.png') });
  }

  // An unknown address.
  page.problems = [];
  let res = await page.goto(BASE + '/no-such-page', { waitUntil: 'networkidle' });
  const h1 = await page.locator('h1').first().textContent();
  // Chrome logs the 404 itself as a console error.
  const others = page.problems.filter((m) => !/status of 404/.test(m));
  check('an unknown address answers 404 with the not-found page', res.status() === 404 && h1 === 'Page not found' && others.length === 0,
    `status ${res.status()}, h1 "${h1}"${page.problems.length ? `, console: ${page.problems.join(' | ')}` : ''}`);

  // facts.json, which the legend links.
  res = await page.goto(BASE + '/facts.json', { waitUntil: 'networkidle' });
  check('facts.json is served', res.status() === 200 && /json/.test(res.headers()['content-type'] ?? ''));

  // Links within the site go through the router: the page does not reload.
  page.problems = [];
  await page.goto(BASE + '/policies/changes/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { window.__stayed = true; });
  const related = page.locator('.related a').first();
  const target = await related.getAttribute('href');
  const want = Object.values(content.pages).find((p) => p.path === target);
  const before = await page.locator('h1').first().textContent();
  await related.click();
  // The address changes a moment before the new page draws; wait for its heading.
  await page.waitForFunction(([t, b]) => {
    const h = document.querySelector('h1')?.textContent ?? '';
    return h !== b && t.startsWith(h);
  }, [want.title, before]);
  const stayed = await page.evaluate(() => window.__stayed === true);
  check('a related link changes page without a reload', stayed && new URL(page.url()).pathname === target.replace(/\/$/, ''), target);
  const toc = page.locator('.toc a').nth(1);
  const anchor = (await toc.getAttribute('href')).split('#')[1];
  await toc.click();
  await page.waitForFunction((a) => location.hash === `#${a}`, anchor,);
  check('a section link stays on the page and moves to the section', await page.evaluate(() => window.__stayed === true), `#${anchor}`);
  // The search form on the home page stays on the page.
  await page.locator('a.brand').click();
  await page.waitForFunction(() => location.pathname === '/');
  await page.locator('.search button').click();
  await page.waitForTimeout(300);
  check('the search form stays on the page', new URL(page.url()).pathname === '/' && !new URL(page.url()).search
    && (await page.evaluate(() => window.__stayed === true)) && page.problems.length === 0, page.url());

  // The Lean model: the button, a marker's popover, Escape, and the remembered choice.
  await page.goto(BASE + '/policies/paying/', { waitUntil: 'networkidle' });
  await page.locator('.lean-toggle').click();
  const leanOn = await page.evaluate(() => document.documentElement.classList.contains('lean-on'));
  const pressed = await page.locator('.lean-toggle').getAttribute('aria-pressed');
  const marker = page.locator('button.lean-marker').first();
  await marker.click();
  const pop = page.locator(`#${await marker.getAttribute('aria-controls')}`);
  const shown = await pop.isVisible();
  await page.keyboard.press('Escape');
  const hidden = await pop.isHidden();
  await page.reload({ waitUntil: 'networkidle' });
  const remembered = await page.evaluate(() => document.documentElement.classList.contains('lean-on'));
  check('the Lean model shows, a popover opens and Escape closes it', leanOn && pressed === 'true' && shown && hidden && remembered,
    JSON.stringify({ leanOn, pressed, shown, hidden, remembered }));
  await page.locator('.lean-toggle').click();
  await ctx.close();

  // Dark mode follows the system; the button overrides it.
  ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 900 } });
  page = await watched(ctx);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const theme = () => page.evaluate(() => [document.documentElement.getAttribute('data-theme'), localStorage.getItem('verified-airline-theme')]);
  const dark = await theme();
  const darkPressed = await page.locator('.theme-toggle').getAttribute('aria-pressed');
  if (shots) await page.screenshot({ path: join(shots, 'home-dark.png') });
  await page.locator('.theme-toggle').click();
  const light = await theme();
  await page.locator('.theme-toggle').click();
  const back = await theme();
  check('dark mode follows the system, and the button overrides it', dark[0] === 'dark' && darkPressed === 'true' && light[0] === 'light'
    && light[1] === 'light' && back[0] === 'dark' && back[1] === null && page.problems.length === 0, JSON.stringify({ dark, light, back }));
  if (shots) {
    await page.goto(BASE + '/policies/changes/?lean=1', { waitUntil: 'networkidle' });
    await page.locator('button.lean-marker.proven').first().click();
    await page.screenshot({ path: join(shots, 'changes-dark-lean.png') });
    await page.goto(BASE + '/policies/changes/?lean=0', { waitUntil: 'networkidle' });
  }
  await ctx.close();

  // A phone.
  ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page = await watched(ctx);
  await page.goto(BASE + '/policies/refunds/', { waitUntil: 'networkidle' });
  const button = await page.locator('.theme-toggle').boundingBox();
  const brand = await page.locator('.brand').boundingBox();
  check('on a phone the dark mode button sits on the brand line', Math.abs(button.y + button.height / 2 - (brand.y + brand.height / 2)) < 6 && button.x > 300);
  if (shots) await page.screenshot({ path: join(shots, 'refunds-phone-dark.png') });
  await ctx.close();

  // The chat: its panel opens under the policy.  A local server has no chat
  // API, so the start fails and says so; --url checks the live chat instead.
  ctx = await browser.newContext({ colorScheme: 'light', viewport: { width: 1280, height: 900 } });
  page = await watched(ctx);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const chatButtons = await page.locator('.chat-open').count();
  await page.locator('.chat-open').click();
  let opened;
  if (server) {
    await page.locator('.chat-panel .chat-note').last().waitFor();
    opened = (await page.locator('.chat-panel .chat-note').last().textContent()) === content.chat.traveler.startFailed;
  } else {
    await page.locator('.chat-panel .msg.airline').first().waitFor({ timeout: 30000 });
    opened = (await page.locator('.chat-panel .msg.airline').first().textContent()).trim() === content.chat.traveler.greeting;
  }
  const unexpected = page.problems.filter((m) => !/status of (404|405)/.test(m));
  check('the chat opens under the policy', chatButtons === 1 && opened && unexpected.length === 0,
    JSON.stringify({ chatButtons, opened, unexpected }));
  await ctx.close();

  // Scripts off: the prerendered page reads, and the buttons that need scripts are hidden.
  ctx = await browser.newContext({ colorScheme: 'dark', javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
  page = await ctx.newPage();
  await page.goto(BASE + '/policies/refunds/', { waitUntil: 'networkidle' });
  const off = await page.evaluate(() => ({
    h1: document.querySelector('h1')?.textContent,
    sections: document.querySelectorAll('#content section').length,
    theme: getComputedStyle(document.querySelector('.theme-toggle')).display,
    lean: getComputedStyle(document.querySelector('.lean-toggle')).display,
    bg: getComputedStyle(document.body).backgroundColor,
  }));
  check('with scripts off the page reads and follows the system theme', off.h1 === 'Refunds' && off.sections > 2 && off.theme === 'none'
    && off.lean === 'none' && off.bg === 'rgb(14, 19, 32)', JSON.stringify(off));
  await ctx.close();
} finally {
  await browser.close();
  server?.close();
}
console.log(`${BASE}\n${results.join('\n')}`);
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
