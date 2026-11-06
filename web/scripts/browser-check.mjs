// Checks the built site in Chrome: every page, the not-found page, links
// through the router, the Lean model and its popovers, the dark mode button,
// the pages with scripts off, and the One ID trip from check-in to "Board".
// Any console error fails a check, so a script or style the content security
// policy blocks fails too.
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
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const DIST = new URL('../dist/verified-airline/browser/', import.meta.url).pathname;
const content = JSON.parse(readFileSync(new URL('../src/generated/content.json', import.meta.url)));
const shots = opt('--shots');
if (shots) mkdirSync(shots, { recursive: true });
const oneIdModel = JSON.parse(readFileSync(new URL('../../model/one-id/model.json', import.meta.url)));
const oneIdScenarios = JSON.parse(readFileSync(new URL('../../model/one-id/scenarios.json', import.meta.url)));
const oneIdReadings = JSON.parse(readFileSync(new URL('../../model/one-id/readings.json', import.meta.url)));
const oneIdPresentationScenarios = JSON.parse(readFileSync(new URL('../../model/one-id/presentation/scenarios.json', import.meta.url)));
const oneIdPresentationReadings = JSON.parse(readFileSync(new URL('../../model/one-id/presentation/readings.json', import.meta.url)));
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

function watch(page) {
  page.problems = [];
  page.on('console', (m) => { if (m.type() === 'error') page.problems.push(m.text()); });
  page.on('pageerror', (e) => page.problems.push(String(e)));
  return page;
}

/** A page that records console errors, failed requests and page errors. */
async function watched(context) {
  return watch(await context.newPage());
}

/** What a traveler must not read with the Lean model hidden. */
const BANNED = /\b(rules?|theorems?|criterion|criteria)\b|\b(?:ONE|OO|OID)-\d{3}(?:\.\d+)?\b|\bG-\d{2}\b/i;
const hiddenWords = async (page) => (await page.locator('body').innerText()).match(BANNED)?.[0] ?? null;

/** Clicks a link that opens a tab of its own and returns the tab, watched. */
async function opensTab(context, page, selector) {
  const [tab] = await Promise.all([context.waitForEvent('page'), page.locator(selector).click()]);
  watch(tab);
  await tab.waitForLoadState('networkidle');
  return tab;
}

// Every page has the same event replay script, so a change of one page's events cannot need a new policy.
if (!opt('--url')) {
  const scripts = new Set(htmlFiles(DIST).filter((f) => !f.endsWith('index.csr.html')).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/__jsaction_bootstrap\(document\.body,"ng",(\[[^\]]*\])/g)].map((m) => m[1])));
  check('every page lists the same events for replay', scripts.size === 1, [...scripts].join(' '));
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

  // The One ID trip, in three tabs that talk through a BroadcastChannel, with
  // the Lean model hidden: the default scenario from check-in to "Board".
  const words = content.oneId;
  const defaultScenario = oneIdScenarios.scenarios.find((s) => s.default);
  ctx = await browser.newContext({ colorScheme: 'light', viewport: { width: 1280, height: 900 } });
  page = await watched(ctx);
  await page.goto(BASE + '/check-in', { waitUntil: 'networkidle' });
  const shot = async (p, name) => { if (shots) await p.screenshot({ path: join(shots, `${name}.png`), fullPage: true }); };
  const pageH1 = (p) => p.locator('h1').first().textContent();
  // The trip map on a tab: the stop the trip waits at, and whether that stop is in this tab's app.
  const mapAt = (p, stop, here) => p.locator(`[data-state="trip-map"][data-at="${stop}"][data-here="${here}"]`).waitFor({ timeout: 5000 }).then(() => true, () => false);
  const start = { h1: await pageH1(page), words: await hiddenWords(page), current: await page.locator('header.site nav a[aria-current]').textContent(), title: await page.title() };
  const siteLook = await page.evaluate(() => ({ accent: getComputedStyle(document.querySelector('.oid-button')).backgroundColor, font: getComputedStyle(document.body).fontFamily }));
  check('the website keeps its look', siteLook.accent === 'rgb(43, 58, 103)' && /Fira/.test(siteLook.font), JSON.stringify(siteLook));
  check('/check-in starts the trip with the model hidden', start.h1 === words.traveler.checkIn.title && start.words === null
    && start.current === 'Check in' && start.title === `${words.traveler.checkIn.documentTitle}: ${content.airline}`, JSON.stringify(start));
  const firstStop = await page.locator('[data-state="trip-map"]').evaluate((m) => ({ stops: m.querySelectorAll('.oid-map-dot').length, pin: m.querySelector('.oid-map-pin')?.textContent, link: m.querySelector('[data-action="map-go"]') !== null, screen: m.querySelector('.this-screen')?.dataset.app }));
  check('the trip map starts on the website, with no link away', await mapAt(page, 'openWallet', true) && firstStop.stops === 6 && firstStop.pin === words.traveler.map.here && !firstStop.link && firstStop.screen === 'website', JSON.stringify(firstStop));
  await shot(page, 'check-in-hidden');

  let wallet = await opensTab(ctx, page, '[data-action="open-wallet"]');
  await wallet.locator('[data-sheet="consent"]').waitFor();
  check('the map moves to the wallet, and the website points there', await mapAt(wallet, 'share', true) && await mapAt(page, 'share', false) && await page.locator('[data-action="map-go"][href="/wallet"]').count() === 1);
  const consentText = await wallet.locator('[data-sheet="consent"]').innerText();
  const family = defaultScenario.credentials[0].mdoc.nameSpaces[0].elements[0].value.text;
  const sheet = { h1: await pageH1(wallet), words: await hiddenWords(wallet), hasName: consentText.includes(family), share: await wallet.locator('[data-action="share"]').textContent(),
    credentials: await wallet.locator('[data-credential]').count(), specimens: await wallet.locator('.oid-specimen').count() };
  const walletLook = await wallet.evaluate(() => ({
    brand: document.querySelector('.brand, .wordmark') !== null, site: document.querySelector('header.site, footer.site') !== null,
    font: getComputedStyle(document.querySelector('.surface-wallet')).fontFamily, title: document.title,
    accent: getComputedStyle(document.querySelector('.oid-button')).backgroundColor,
  }));
  const walletMap = await wallet.evaluate(() => Object.fromEntries(['website', 'wallet', 'gate'].map((app) => [app, getComputedStyle(document.querySelector(`.oid-map-lane[data-app="${app}"] .oid-map-app`)).color])));
  check("the wallet's map shows none of the airline's colors", walletMap.website !== 'rgb(43, 58, 103)' && walletMap.gate !== 'rgb(91, 42, 134)' && walletMap.website === walletMap.gate && walletMap.wallet !== walletMap.website, JSON.stringify(walletMap));
  check('the wallet is its own app, with no sign of the airline brand', !walletLook.brand && !walletLook.site && !/Fira/.test(walletLook.font) && walletLook.title === words.traveler.wallet.documentTitle && walletLook.accent !== 'rgb(43, 58, 103)', JSON.stringify(walletLook));
  check('the wallet is titled Demo wallet and asks for the items, each credential a specimen', sheet.h1 === 'Demo wallet' && sheet.words === null && sheet.hasName
    && /3/.test(sheet.share) && sheet.credentials > 0 && sheet.credentials === sheet.specimens, JSON.stringify(sheet));
  await shot(wallet, 'wallet-consent-hidden');
  await shot(page, 'check-in-waiting-hidden');

  await wallet.locator('[data-action="share"]').click();
  await page.locator('[data-action="add-pass"]').waitFor();
  const done = { h1: await pageH1(page), words: await hiddenWords(page), credentials: await page.locator('[data-credential]').count(), specimens: await page.locator('.oid-specimen').count() };
  check('sharing in the wallet checks the traveler in on the website', /checked in/.test(done.h1) && done.words === null && done.credentials === 1 && done.specimens === 1, JSON.stringify(done));
  check('the map comes back to the website for the boarding pass', await mapAt(page, 'addPass', true) && await mapAt(wallet, 'addPass', false));
  await shot(page, 'checked-in-hidden');

  await page.locator('[data-action="add-pass"]').click();
  await wallet.locator('[data-credential="boardingPass"]').waitFor();
  const held = { words: await hiddenWords(wallet), credentials: await wallet.locator('[data-credential]').count(), specimens: await wallet.locator('.oid-specimen').count(), check: await wallet.locator('[data-state="pass-check"]').textContent() };
  check('the boarding pass reaches the wallet and is checked there', held.words === null && held.credentials === 2 && held.specimens === 2 && held.check === words.traveler.wallet.passOk, JSON.stringify(held));
  check('the map goes to the wallet to present at the gate', await mapAt(wallet, 'present', true));
  const presentFirst = await wallet.evaluate(() => document.querySelector('[data-action="present"]').getBoundingClientRect().top < document.querySelector('[data-credential]').getBoundingClientRect().top);
  check("the wallet's Present at the gate comes before the credentials", presentFirst);
  check('the website says the pass is in the wallet once it is', await page.locator('.band .lede').textContent() === words.traveler.checkIn.addedLede);
  const passAction = await page.locator('[data-action="present-from-pass"]').textContent();
  check('the boarding pass on the website offers Present at the gate', passAction === words.traveler.wallet.present, passAction);
  await shot(wallet, 'wallet-home-hidden');

  await wallet.locator('[data-action="present"]').click();
  await wallet.locator('[data-sheet="consent"][data-for="gate"]').waitFor();
  const gateSheet = { words: await hiddenWords(wallet), share: await wallet.locator('[data-action="share-gate"]').textContent(), text: await wallet.locator('[data-sheet="consent"]').innerText() };
  check('the gate asks through a consent sheet before anything is presented', gateSheet.words === null && /4/.test(gateSheet.share) && gateSheet.text.includes('MARTIN / ALICE'), JSON.stringify({ words: gateSheet.words, share: gateSheet.share }));
  check('the map stays in the wallet for the consent sheet', await mapAt(wallet, 'shareGate', true));
  await shot(wallet, 'wallet-gate-consent-hidden');
  let gate = await opensTab(ctx, wallet, '[data-action="share-gate"]');
  await gate.locator('[data-state="gate-result"]').waitFor();
  const gateLook = await gate.evaluate(() => ({
    bar: document.querySelector('.gate-bar .wordmark')?.textContent, h1: document.querySelector('h1')?.textContent, site: document.querySelector('header.site, footer.site, .chat-open') !== null,
    font: getComputedStyle(document.body).fontFamily, status: document.querySelector('.gate-bar [data-state="gate-status"]')?.textContent,
    color: getComputedStyle(document.querySelector('.gate-bar')).backgroundColor, button: getComputedStyle(document.querySelector('.surface-gate')).getPropertyValue('--accent'),
  }));
  check('the gate reader has its own color, plum', gateLook.color === 'rgb(58, 28, 85)' && /#5B2A86/.test(gateLook.button), JSON.stringify(gateLook));
  check('the map ends at the gate, and the other apps point there', await mapAt(gate, 'answer', true) && await mapAt(page, 'answer', false) && await mapAt(wallet, 'answer', false)
    && await gate.locator('.oid-map-cta').count() === 0 && await page.locator('[data-action="map-go"][href="/gate"]').count() === 1);
  check('the gate reader has its own header, in the airline design', gateLook.bar === content.airline && gateLook.h1 === words.traveler.gate.title && !gateLook.site && /Fira/.test(gateLook.font) && /VA 118/.test(gateLook.status), JSON.stringify(gateLook));
  const noPanel = !(await gate.locator('[data-panel="presenter"]').isVisible());
  check('the presenter panel does not show with the model hidden', noPanel);
  const result = { word: await gate.locator('.oid-banner-word').textContent(), words: await hiddenWords(gate), checks: await gate.locator('[data-check]').first().isVisible().catch(() => false), url: new URL(gate.url()).pathname };
  check('the trip from check-in reaches "Board" under the content security policy', result.word === words.traveler.gate.board && result.words === null && !result.checks && result.url === '/gate', JSON.stringify(result));
  await shot(gate, 'gate-hidden');
  // On a phone the map keeps its route and its line, and nothing runs off the screen.
  for (const [name, tab] of [['website', page], ['wallet', wallet], ['gate', gate]]) {
    await tab.setViewportSize({ width: 390, height: 800 });
    const narrow = await tab.evaluate(() => ({ wide: document.documentElement.scrollWidth, width: document.documentElement.clientWidth, dots: [...document.querySelectorAll('.oid-map-dot')].filter((d) => d.getBoundingClientRect().right <= document.documentElement.clientWidth).length }));
    check(`on a phone the ${name} map fits the screen`, narrow.wide <= narrow.width && narrow.dots === 6, JSON.stringify(narrow));
    await shot(tab, `${name}-map-narrow`);
    await tab.setViewportSize({ width: 1280, height: 900 });
  }
  const tripProblems = [page, wallet, gate].flatMap((p) => p.problems);
  check('the trip logs no console error', tripProblems.length === 0, tripProblems.join(' | '));
  await ctx.close();

  // The tours on the home page, each from a clean start, with an older trip still open in another tab.
  ctx = await browser.newContext({ colorScheme: 'light', viewport: { width: 1280, height: 900 } });
  page = await watched(ctx);
  const homeTours = async () => {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    return page.locator('.tour');
  };
  const tours = await homeTours();
  const tourWords = { count: await tours.count(), words: await hiddenWords(page) };
  check('the home page offers three tours, in words a traveler can read', tourWords.count === 3 && tourWords.words === null, JSON.stringify(tourWords));
  await shot(page, 'home-tours');
  const older = await watched(ctx);
  await older.goto(BASE + '/wallet', { waitUntil: 'networkidle' });
  await (await homeTours()).nth(1).click();
  await page.locator('[data-state="gate-decide"]').waitFor();
  const decision = page.locator('[data-panel="presenter"]');
  const stopTour = { url: new URL(page.url()), panel: await decision.isVisible(), pressed: await decision.locator('[data-scenario="two-john-smiths"][aria-pressed="true"]').count() };
  check('the decision tour lands on the two John Smiths, stopped, with the model shown', stopTour.url.pathname === '/gate' && stopTour.url.search === '' && stopTour.panel && stopTour.pressed === 1, JSON.stringify(stopTour));
  await shot(page, 'tour-decision');
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-state="gate-decide"]').waitFor();
  check('a reload keeps the tour\'s trip', await page.locator('[data-panel="presenter"] [data-scenario="two-john-smiths"][aria-pressed="true"]').count() === 1);
  await page.locator('[data-decision] [data-option]').first().click();
  await page.locator('[data-state="gate-decide"]').waitFor({ state: 'detached' });
  const chosen = await page.locator('[data-state="gate-decide"]').count();
  await (await homeTours()).nth(1).click();
  await page.locator('[data-state="gate-decide"]').waitFor();
  check('taking the decision tour again starts it undecided', chosen === 0 && await page.locator('[data-state="gate-decide"]').isVisible(), JSON.stringify({ chosen }));
  await (await homeTours()).nth(0).click();
  // The prerendered page already shows the first stop, so wait for the link to have started the trip.
  await page.waitForURL((u) => u.pathname === '/check-in' && u.search === '');
  await page.locator('[data-state="trip-map"][data-at="openWallet"]').waitFor();
  const tripTour = { url: new URL(page.url()), lean: await page.evaluate(() => document.documentElement.classList.contains('lean-on')), action: await page.locator('[data-action="open-wallet"]').count(), older: await mapAt(older, 'openWallet', false) };
  check('the trip tour starts a fresh trip with the model hidden, and other tabs follow', tripTour.url.pathname === '/check-in' && tripTour.url.search === '' && !tripTour.lean && tripTour.action === 1 && tripTour.older, JSON.stringify(tripTour));
  await (await homeTours()).nth(2).click();
  await page.waitForLoadState('networkidle');
  const policyTour = { path: new URL(page.url()).pathname, lean: await page.evaluate(() => document.documentElement.classList.contains('lean-on')), markers: await page.locator('button.lean-marker:visible').count() };
  check('the policy tour opens a policy page with its markers showing', policyTour.path.startsWith('/policies/') && policyTour.lean && policyTour.markers > 0, JSON.stringify(policyTour));
  const tourProblems = [page, older].flatMap((p) => p.problems);
  check('the tours log no console error', tourProblems.length === 0, tourProblems.join(' | '));
  await ctx.close();

  // The same trip driven from the map's button, which stops at each consent sheet.
  ctx = await browser.newContext({ colorScheme: 'light', viewport: { width: 1280, height: 900 } });
  page = await watched(ctx);
  await page.goto(BASE + '/check-in', { waitUntil: 'networkidle' });
  const mapNext = (p) => p.locator('[data-state="trip-map"] [data-action="map-next"]');
  check('the map offers the website its next action', await mapNext(page).textContent() === words.traveler.checkIn.open && await page.locator('.oid-map-stop.current a').count() === 1);
  wallet = await opensTab(ctx, page, '[data-state="trip-map"] [data-action="map-next"]');
  await wallet.locator('[data-sheet="consent"]').waitFor();
  check('at the check-in consent sheet the map offers no action', await mapNext(wallet).count() === 0 && await mapNext(page).count() === 0);
  await wallet.locator('[data-action="share"]').click();
  await page.locator('[data-action="add-pass"]').waitFor();
  check('the map offers to add the boarding pass', await mapNext(page).textContent() === words.traveler.checkIn.add);
  await mapNext(page).click();
  await wallet.locator('[data-action="present"]').waitFor();
  check('adding from the map puts the pass in the wallet', await mapAt(page, 'present', false) && await mapNext(page).textContent() === words.traveler.wallet.present);
  const tabs = ctx.pages().length;
  await mapNext(page).click();
  await wallet.locator('[data-sheet="consent"][data-for="gate"]').waitFor();
  check('presenting from the map reaches the gate sheet in the same wallet tab', ctx.pages().length === tabs && await mapNext(wallet).count() === 0 && await mapNext(page).count() === 0 && await mapAt(wallet, 'shareGate', true), JSON.stringify({ tabs, now: ctx.pages().length }));
  const watching = await watched(ctx);
  await watching.goto(BASE + '/gate', { waitUntil: 'networkidle' });
  const stillWaiting = await mapAt(watching, 'shareGate', false) && await watching.locator('[data-state="gate-waiting"]').isVisible() && await watching.locator('[data-state="gate-result"]').count() === 0;
  check('an open gate keeps waiting until the wallet shares', stillWaiting);
  await watching.close();
  await page.locator('[data-state="trip-map"] .oid-map-stop.current a').click();
  check('the active stop on the map goes to the wallet', ctx.pages().length === tabs);
  gate = await opensTab(ctx, wallet, '[data-action="share-gate"]');
  await gate.locator('[data-state="gate-result"]').waitFor();
  check('the trip from the map reaches the same answer', await gate.locator('.oid-banner-word').textContent() === words.traveler.gate.board);
  const mapProblems = [page, wallet, gate].flatMap((p) => p.problems);
  check('the trip from the map logs no console error', mapProblems.length === 0, mapProblems.join(' | '));
  await ctx.close();

  // The same trip with the model shown: markers on each check, their popovers
  // from model.json, and the model's own answer beside each computed one.
  ctx = await browser.newContext({ colorScheme: 'light', viewport: { width: 1280, height: 900 } });
  page = await watched(ctx);
  await page.goto(BASE + '/check-in?lean=1', { waitUntil: 'networkidle' });
  const requestMarker = page.locator('main .heading-row button.lean-marker').first();
  await shot(page, 'check-in-shown');
  const mapMarker = page.locator('[data-state="trip-map"] button.lean-marker');
  await mapMarker.click();
  const mapPop = { grey: await mapMarker.evaluate((b) => b.classList.contains('partial')), text: await page.locator(`#${await mapMarker.getAttribute('aria-controls')}`).innerText() };
  check("with the model shown the map says its route is not in the model yet", mapPop.grey && mapPop.text.includes(words.lean.grey.map.title), JSON.stringify(mapPop));
  await page.keyboard.press('Escape');
  await requestMarker.click();
  const requestPop = await page.locator(`#${await requestMarker.getAttribute('aria-controls')}`).innerText();
  await shot(page, 'check-in-request-popover-shown');
  await page.keyboard.press('Escape');
  check('with the model shown the request carries the marker of its requirement, and the items their identifiers',
    requestPop.includes(oneIdModel.requirements['OID-203'].ears) && !(await requestMarker.evaluate((b) => b.classList.contains('partial')))
    && (await page.locator('.oid-row code.oid-id').first().isVisible()) && (await page.locator('.lean-legend').isVisible()), '');
  wallet = await opensTab(ctx, page, '[data-action="open-wallet"]');
  await wallet.locator('[data-sheet="consent"]').waitFor();
  await shot(wallet, 'wallet-consent-shown');
  const consentMarker = wallet.locator('[data-sheet="consent"] .heading-row button.lean-marker');
  await consentMarker.click();
  const consentPop = await wallet.locator(`#${await consentMarker.getAttribute('aria-controls')}`).innerText();
  await wallet.keyboard.press('Escape');
  check('the consent sheet carries the marker of its requirement, and the wallet says it checked who asks',
    consentPop.includes(oneIdModel.requirements['OID-201'].ears) && (await wallet.locator('[data-check="walletFindings"]').getAttribute('data-status')) === 'passed', '');
  await wallet.locator('[data-action="share"]').click();
  await page.locator('[data-action="add-pass"]').waitFor();
  const photoidMarker = page.locator('[data-check="photoid"] button.lean-marker');
  await photoidMarker.click();
  const popText = await page.locator(`#${await photoidMarker.getAttribute('aria-controls')}`).innerText();
  const req = oneIdModel.requirements['OID-101'];
  check('a marker opens the requirement, its criteria and their statuses, from model.json',
    popText.includes(req.ears) && req.criteria.every((c) => popText.includes(c.id)) && (await photoidMarker.evaluate((b) => b.classList.contains('open'))), '');
  await shot(page, 'checked-in-popover-shown');
  await page.keyboard.press('Escape');
  await shot(page, 'checked-in-shown');
  await page.locator('[data-action="add-pass"]').click();
  await wallet.locator('[data-credential="boardingPass"]').waitFor();
  await shot(wallet, 'wallet-home-shown');
  const presentationChecks = await page.locator('.oid-list [data-check="refusals"]').getAttribute('data-status');
  check('check-in shows the wallet\'s answer accepted under the model\'s rules', presentationChecks === 'passed', presentationChecks);
  await wallet.locator('[data-action="present"]').click();
  await wallet.locator('[data-sheet="consent"][data-for="gate"]').waitFor();
  await shot(wallet, 'wallet-gate-consent-shown');
  gate = await opensTab(ctx, wallet, '[data-action="share-gate"]');
  await gate.locator('[data-state="gate-result"]').waitFor();
  await gate.locator('[data-model-answer]').first().waitFor();
  const rows = gate.locator('[data-check]');
  const same = await gate.locator('[data-model-answer][data-same="true"]').count();
  const shownGate = { word: await gate.locator('.oid-banner-word').textContent(), rows: await rows.count(), same, visible: await rows.first().isVisible() };
  check('with the model shown the gate lists the checks that ran, each agreeing with the model', shownGate.word === words.traveler.gate.board && shownGate.rows === 13 && shownGate.same === 13 && shownGate.visible, JSON.stringify(shownGate));
  await shot(gate, 'gate-shown');

  // The presenter's panel: its travelers and switches, from the model's files.
  const panel = gate.locator('[data-panel="presenter"]');
  const onPanel = { visible: await panel.isVisible(), travelers: await panel.locator('[data-scenario]').count(), switches: await panel.locator('[data-reading]').count(), first: await panel.locator('[data-scenario]').first().textContent() };
  const allSwitches = new Set([...oneIdReadings.readings, ...oneIdPresentationReadings.readings].map((r) => r.id)).size;
  check('the panel shows a traveler for each scenario and a switch for each reading', onPanel.visible && onPanel.travelers === oneIdScenarios.scenarios.length + oneIdPresentationScenarios.scenarios.length
    && onPanel.switches === allSwitches && onPanel.first === oneIdScenarios.scenarios[0].title, JSON.stringify(onPanel));

  const clipped = await panel.locator('.oid-choice').evaluateAll((buttons) => buttons.filter((b) => { const r = document.createRange(); r.selectNodeContents(b); return r.getBoundingClientRect().height > b.getBoundingClientRect().height; }).map((b) => b.textContent));
  check('every button on the panel shows its whole label', clipped.length === 0, clipped.join(' | '));

  // What the panel changes draws in one pass, so its pressed state says the reader has redrawn too.
  const pickTraveler = async (id) => {
    await panel.locator(`[data-scenario="${id}"]`).click();
    await panel.locator(`[data-scenario="${id}"][aria-pressed="true"]`).waitFor();
  };
  const setSwitch = async (reading, setting) => {
    await panel.locator(`[data-reading="${reading}"] [data-setting="${setting}"]`).click();
    await panel.locator(`[data-reading="${reading}"] [data-setting="${setting}"][aria-pressed="true"]`).waitFor();
  };
  const bannerWord = () => gate.locator('.oid-banner-word').textContent();

  // A trip that rests on an undecided point stops at it, and choosing goes on.
  const decide = words.lean.decision;
  const decideBanner = gate.locator('[data-state="gate-decide"]');
  await pickTraveler('accented-name');
  const stopped = { stopped: await decideBanner.isVisible(), result: await gate.locator('[data-state="gate-result"]').count(), word: await bannerWord(),
    previews: await gate.locator('[data-decision="MatchReading"] [data-preview]').allTextContents(), counts: await gate.locator('[data-decision="MatchReading"] [data-wrong-count]').allTextContents(),
    rows: await gate.locator('[data-decision="MatchReading"] [data-consequence]').count(), considerations: await gate.locator('[data-decision="MatchReading"] .oid-considerations li').count() };
  check('a trip resting on an undecided point stops, with each setting and what it leads to', stopped.stopped && stopped.result === 0 && stopped.word === decide.needs
    && stopped.previews.join() === [decide.preview.board, decide.preview.refer].join() && stopped.rows === 4 && stopped.counts.every((c) => c === 'Wrong for 2 of 4 travelers holding both credentials') && stopped.counts.length === 2 && stopped.considerations > 0, JSON.stringify(stopped));
  await shot(gate, 'decision-accented-name');
  await pickTraveler('two-john-smiths');
  check('the two John Smiths stop too, though they board under every setting', await decideBanner.isVisible());
  await shot(gate, 'decision-two-john-smiths');
  await pickTraveler('default-trip');
  check('the default trip does not stop', !(await decideBanner.isVisible()) && (await bannerWord()) === words.traveler.gate.board);
  await pickTraveler('accented-name');
  await gate.locator('[data-decision="MatchReading"] [data-option-none]').click();
  await gate.locator('[data-state="left-open"]').waitFor();
  check('"None of these" keeps the trip stopped', await decideBanner.isVisible());
  await gate.locator('[data-decision="MatchReading"] [data-option="namesAgree"]').click();
  await gate.locator('[data-trail="MatchReading"]').filter({ hasText: 'names agree' }).waitFor();
  check('choosing a setting goes on to its result and joins the decisions so far', !(await decideBanner.isVisible()) && (await bannerWord()) === words.traveler.gate.refer);
  await shot(gate, 'decision-accented-name-chosen');
  await gate.locator('[data-trail="MatchReading"] button').click();
  await decideBanner.waitFor();
  check('undoing a decision stops the trip again', await decideBanner.isVisible());
  const walletSeesIt = await wallet.locator('[data-credential="boardingPass"] .oid-name').filter({ hasText: 'GARCIA' }).waitFor({ timeout: 5000 }).then(() => true, () => false);
  check('decisions and the traveler reach the other tabs', walletSeesIt);

  // For each traveler in turn, both settings of the matching rule: the result on
  // the screen against the model's table.
  const answers = Object.fromEntries(readFileSync(new URL('../../model/one-id/decisions.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map((line) => {
    const d = JSON.parse(line);
    return [d.name, d.response.result];
  }));
  const pair = oneIdScenarios.scenarios.filter((s) => s.credentials.length === 2);
  const matchSettings = oneIdReadings.readings.find((r) => r.id === 'MatchReading').settings.map((s) => s.value);
  const seen = [];
  for (const scenario of pair) {
    await pickTraveler(scenario.id);
    for (const setting of matchSettings) {
      await setSwitch('MatchReading', setting);
      await gate.locator('[data-check="match"] [data-model-answer]').waitFor();
      const word = await bannerWord();
      const model = answers[`${scenario.id} travelerMatch MatchReading=${setting}`];
      const differ = await gate.locator('[data-model-answer][data-same="false"]').count();
      seen.push({ scenario: scenario.id, setting, word, right: word === (model ? words.traveler.gate.board : words.traveler.gate.refer) && differ === 0 });
      await shot(gate, `panel-${scenario.id}-${setting}`);
    }
  }
  check('each traveler under both matching settings shows what the model answers', seen.length === pair.length * matchSettings.length && seen.every((s) => s.right)
    && seen.some((s) => s.word === words.traveler.gate.refer) && seen.some((s) => s.word === words.traveler.gate.board),
    seen.map((s) => `${s.scenario}/${s.setting}=${s.word}${s.right ? '' : ' WRONG'}`).join(', '));

  // A traveler picked on the panel reaches a surface in another tab.
  await pickTraveler('another-travelers-pass');
  const reached = await wallet.locator('[data-credential="boardingPass"] .oid-name').filter({ hasText: 'KELLER' }).waitFor({ timeout: 5000 }).then(() => true, () => false);
  check('a traveler picked on the panel reaches the other tabs', reached);

  // Every scenario with its checks on the panel: each agrees with the model.
  const differing = [];
  for (const scenario of oneIdScenarios.scenarios) {
    await pickTraveler(scenario.id);
    await gate.locator('[data-model-answer]').first().waitFor();
    const differ = await gate.locator('[data-model-answer][data-same="false"]').count();
    if (differ) differing.push(`${scenario.id}: ${differ}`);
    if (!pair.some((s) => s.id === scenario.id)) await shot(gate, `panel-${scenario.id}`);
  }
  check('every traveler can be shown, and every check agrees with the model', differing.length === 0 && gate.problems.length === 0, [...differing, ...gate.problems].join(' | '));

  // The exact instant a validity ends: one switch turns one traveler's result.
  await pickTraveler('end-of-validity');
  await setSwitch('ExpiryReading.validAtEnd', 'true');
  const atEnd = await bannerWord();
  const affected = await panel.locator('[data-reading="ExpiryReading.validAtEnd"] [data-affects]').count();
  const credentialBanner = await gate.locator('.oid-banner.credential').count();
  const boarded = await gate.locator('.oid-banner.board').count();
  await setSwitch('ExpiryReading.validAtEnd', 'false');
  const pastEnd = await bannerWord();
  check('one credential gets a credential check, and a switch turns its result', atEnd === decide.preview.accepted && pastEnd === decide.preview.refused && affected === 1 && credentialBanner === 1 && boarded === 0, JSON.stringify({ atEnd, pastEnd, affected, credentialBanner, boarded }));
  await shot(gate, 'credential-end-of-validity');
  const lone = oneIdScenarios.scenarios.filter((s) => s.credentials.length < 2);
  const boardedAlone = [];
  for (const scenario of lone) {
    await pickTraveler(scenario.id);
    if (await gate.locator('.oid-banner.board').count()) boardedAlone.push(scenario.id);
  }
  check('no traveler holding one credential is shown as boarding', boardedAlone.length === 0, boardedAlone.join());
  await panel.locator('[data-action="clear-decisions"]').click();
  await panel.locator('[data-trail]').first().waitFor({ state: 'detached' });

  // The presentations: a replay is refused with no decision, and a shared phone stops at the points the model leaves open.
  const presentationAnswers = Object.fromEntries(readFileSync(new URL('../../model/one-id/presentation/decisions.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map((line) => {
    const d = JSON.parse(line);
    return [d.name, d.response.result];
  }));
  await pickTraveler('replay-openid4vp');
  const replay = { word: await bannerWord(), stopped: await decideBanner.isVisible(), status: await gate.locator('[data-check="refusals"]').getAttribute('data-status'), found: await gate.locator('[data-check="refusals"] code').first().textContent() };
  check('a replayed response is refused, under the model\'s rule', replay.word === decide.preview.refused && !replay.stopped && replay.status === 'failed' && /otherRequest/.test(replay.found), JSON.stringify(replay));
  await shot(gate, 'presentation-replay-openid4vp');
  await pickTraveler('default-proximity');
  check('the default proximity presentation is accepted, with no decision', (await bannerWord()) === decide.preview.accepted && !(await decideBanner.isVisible()));
  await pickTraveler('two-travelers-one-device');
  const shared = { stopped: await decideBanner.isVisible(), points: await gate.locator('[data-decision]').evaluateAll((els) => els.map((e) => e.getAttribute('data-decision'))) };
  check('two travelers on one phone stop at what ties a pair together', shared.stopped && shared.points.includes('PairReading.sameDeviceKey'), JSON.stringify(shared));
  await shot(gate, 'presentation-two-travelers-one-device');
  await pickTraveler('partial-consent');
  const partial = { stopped: await decideBanner.isVisible(), points: await gate.locator('[data-decision]').evaluateAll((els) => els.map((e) => e.getAttribute('data-decision'))) };
  check('a holder who approves part of a request stops at what the wallet then does', partial.stopped && partial.points.join() === 'ConsentReading', JSON.stringify(partial));
  await panel.locator('[data-action="clear-decisions"]').click().catch(() => undefined);
  const differingPresentations = [];
  for (const scenario of oneIdPresentationScenarios.scenarios) {
    await pickTraveler(scenario.id);
    const differ = await gate.locator('[data-model-answer][data-same="false"]').count();
    if (differ) differingPresentations.push(`${scenario.id}: ${differ}`);
  }
  check('every presentation can be shown, and every check agrees with the model', differingPresentations.length === 0 && gate.problems.length === 0 && Object.keys(presentationAnswers).length > 0, [...differingPresentations, ...gate.problems].join(' | '));

  // Hiding the model hides the panel and goes back to the default trip.
  await gate.locator('.lean-toggle').click();
  const returned = await gate.locator('.oid-names').filter({ hasText: 'MARTIN' }).waitFor({ timeout: 5000 }).then(() => true, () => false);
  const hiddenAgain = { returned, panel: await panel.isVisible(), words: await hiddenWords(gate), word: await bannerWord() };
  check('hiding the model hides the panel and returns to the default trip', returned && !hiddenAgain.panel && hiddenAgain.words === null && hiddenAgain.word === words.traveler.gate.board, JSON.stringify(hiddenAgain));
  const shownProblems = [page, wallet, gate].flatMap((p) => p.problems);
  check('the trip with the model shown logs no console error', shownProblems.length === 0, shownProblems.join(' | '));
  await ctx.close();

  // The wallet on a phone, in dark mode.
  ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page = await watched(ctx);
  await page.goto(BASE + '/wallet', { waitUntil: 'networkidle' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('the wallet fits a phone', overflow <= 0 && page.problems.length === 0, `overflow ${overflow}`);
  await shot(page, 'wallet-phone-dark-hidden');
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
  for (const [path, want] of [['/check-in', words.traveler.checkIn.title], ['/wallet', words.traveler.wallet.title], ['/gate', words.traveler.gate.title]]) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    const offPage = await page.evaluate(() => ({ h1: document.querySelector('h1')?.textContent, panel: document.querySelector('[data-panel="presenter"]') ? getComputedStyle(document.querySelector('[data-panel="presenter"]')).display : null }));
    check(`with scripts off ${path} reads, and shows no presenter panel`, offPage.h1 === want && (offPage.panel === null || offPage.panel === 'none'), JSON.stringify(offPage));
  }
  await ctx.close();
} finally {
  await browser.close();
  server?.close();
}
console.log(`${BASE}\n${results.join('\n')}`);
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
