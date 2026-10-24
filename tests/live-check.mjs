// Smoke check of the deployed site (not part of `npm test`):
//   node live-check.mjs [base-url]
import { chromium } from 'playwright';

const base = process.argv[2] || 'https://ahmetfarukozkan77-coder.github.io/jobpilot-web/';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(new URL('app.html', base).href);
await page.waitForURL(/index\.html$/, { timeout: 15000 });
console.log('signed-out app.html → index.html: ok');

await page.goto(new URL('privacy.html', base).href);
console.log('privacy page title:', await page.title());

await page.goto(base);
const [req] = await Promise.all([
  page.waitForRequest(r => /\/auth\/v1\/authorize/.test(r.url()), { timeout: 15000 }),
  page.click('#btn-signin'),
]);
const u = new URL(req.url());
console.log('authorize provider:', u.searchParams.get('provider'), '| redirect_to:', u.searchParams.get('redirect_to'));
await page.waitForURL(/accounts\.google\.com/, { timeout: 20000 }).then(
  () => console.log('reached Google sign-in: ok'),
  () => console.log('did not reach Google; now at', page.url()));

console.log(errors.length ? `page errors:\n  ${errors.join('\n  ')}` : 'no page errors');
await browser.close();
