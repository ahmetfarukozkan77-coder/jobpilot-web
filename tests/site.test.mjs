// Drives the website in Chromium against an in-memory fake of the Supabase
// REST, Storage and Functions APIs, with a signed-in session preset.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SB = 'https://mbuwjwmmvojkemuwivbf.supabase.co';
const UID = '11111111-1111-4111-8111-111111111111';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };

let server, base, browser, db, calls;

function seed() {
  db = {
    user_profiles: [{ user_id: UID, personal: { firstName: 'Ahmet', lastName: 'Ozkan', email: 'a@example.com' },
      work_preferences: { desiredRoles: ['Data Analyst'], workModes: ['remote'] }, short_answers: {}, reference: [],
      voluntary_disclosures: {}, education: {}, settings: { atsThreshold: 70, answerMode: 'smart' } }],
    resumes: [],
    answer_bank: [{ id: 'a1', user_id: UID, question: 'How did you hear about us?', question_key: 'how did you hear about us',
      answer: 'LinkedIn', category: 'unknowable', times_used: 2, last_used_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }],
    applications: [{ id: 'p1', user_id: UID, job: { company: 'Acme', title: 'Analyst', jobUrl: 'https://acme.jobs/1' },
      application: { status: 'detected' }, ats: { originalScore: 61, tailoredScore: 84 }, status_history: [],
      created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' }],
    credit_balances: [{ user_id: UID, balance: 42 }],
    usage_logs: [{ user_id: UID, operation: 'ats_score', model: 'claude-sonnet-5-5', credits_charged: 2, created_at: new Date().toISOString() }],
    subscriptions: [],
  };
  calls = [];
}

// Minimal PostgREST: eq / neq filters, order, limit, upsert on conflict.
function rest(method, url, headers, body) {
  const table = url.pathname.replace('/rest/v1/', '');
  const rows = db[table] || (db[table] = []);
  const filters = [...url.searchParams].filter(([k, v]) => /^(eq|neq)\./.test(v));
  const match = r => filters.every(([k, v]) => {
    const [op, ...rest] = v.split('.'); const want = rest.join('.');
    return op === 'eq' ? String(r[k]) === want : String(r[k]) !== want;
  });
  calls.push({ method, table, query: url.search, body });
  const one = /vnd\.pgrst\.object/.test(headers.accept || '');
  if (method === 'GET') {
    const out = rows.filter(match);
    return one ? (out[0] ? [200, out[0]] : [406, { code: 'PGRST116', message: 'no rows' }]) : [200, out];
  }
  if (method === 'POST') {
    const items = Array.isArray(body) ? body : [body];
    const conflict = (url.searchParams.get('on_conflict') || 'id').split(',');
    for (const it of items) {
      const i = rows.findIndex(r => conflict.every(c => r[c] !== undefined && r[c] === it[c]));
      if (i >= 0 && /merge-duplicates/.test(headers.prefer || '')) rows[i] = { ...rows[i], ...it };
      else rows.push({ id: it.id || `gen-${rows.length + 1}`, ...it });
    }
    return [201, /return=representation/.test(headers.prefer || '') ? items : null];
  }
  if (method === 'PATCH') { rows.filter(match).forEach(r => Object.assign(r, body)); return [204, null]; }
  if (method === 'DELETE') { db[table] = rows.filter(r => !match(r)); return [204, null]; }
  return [400, { message: 'unsupported' }];
}

before(async () => {
  server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
});
after(async () => { await browser?.close(); server?.close(); });
beforeEach(seed);

async function open(hash = '', { signedIn = true } = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => { throw e; });
  if (signedIn) {
    await page.addInitScript(([uid]) => {
      const now = Math.floor(Date.now() / 1000);
      localStorage.setItem('sb-mbuwjwmmvojkemuwivbf-auth-token', JSON.stringify({
        access_token: 'test-token', refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
        user: { id: uid, email: 'a@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
      }));
    }, [UID]);
  }
  await page.route(`${SB}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const headers = req.headers();
    let body = null;
    try { body = req.postDataJSON(); } catch (_) { body = null; }
    if (url.pathname.startsWith('/rest/v1/')) {
      const [status, json] = rest(req.method(), url, headers, body);
      return route.fulfill({ status, contentType: 'application/json', body: json == null ? '' : JSON.stringify(json) });
    }
    if (url.pathname.startsWith('/storage/v1/')) {
      calls.push({ method: req.method(), storage: url.pathname, size: req.postDataBuffer()?.length || 0 });
      if (url.pathname.includes('/object/sign/')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signedURL: '/object/sign/x?token=t' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: url.pathname }) });
    }
    if (url.pathname.startsWith('/functions/v1/')) {
      calls.push({ method: 'POST', fn: url.pathname.split('/').pop(), body, auth: headers.authorization });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: `${base}/index.html#stripe` }) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${base}/app.html${hash}`);
  return page;
}

// A one-page PDF whose text is "Jane Doe Data Analyst".
function samplePdf() {
  const stream = 'BT /F1 18 Tf 72 720 Td (Jane Doe Data Analyst) Tj ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

const last = (pred) => [...calls].reverse().find(pred);

test('signed out: the app sends you to the sign-in page', async () => {
  const page = await open('', { signedIn: false });
  await page.waitForURL(/index\.html$/);
  assert.ok(await page.isVisible('#btn-signin'));
});

test('profile loads and saves into the same row the extension reads', async () => {
  const page = await open('#profile');
  await page.waitForSelector('[data-path="personal.firstName"]');
  assert.equal(await page.inputValue('[data-path="personal.firstName"]'), 'Ahmet');
  assert.equal(await page.inputValue('[data-path="workPreferences.desiredRoles"]'), 'Data Analyst');
  assert.equal(await page.isChecked('[data-path="workPreferences.workModes"] input[value="remote"]'), true);

  await page.fill('[data-path="personal.firstName"]', 'Ahmet Faruk');
  await page.fill('[data-path="workPreferences.desiredSalaryMin"]', '90000');
  await page.check('[data-path="workPreferences.workModes"] input[value="hybrid"]');
  await page.click('text=Add reference');
  await page.locator('.item input').first().fill('Jane Ref');
  await page.click('text=Save profile');
  await page.waitForFunction(() => document.querySelector('#toast')?.classList.contains('show'));

  const row = db.user_profiles[0];
  assert.equal(row.personal.firstName, 'Ahmet Faruk');
  assert.equal(row.work_preferences.desiredSalaryMin, 90000);
  assert.deepEqual(row.work_preferences.workModes, ['remote', 'hybrid']);
  assert.equal(row.reference[0].name, 'Jane Ref');
  assert.equal(row.settings.answerMode, 'smart'); // untouched settings survive
});

test('uploading a PDF stores the file and its text, and makes the first one default', async () => {
  const page = await open('#resumes');
  await page.waitForSelector('text=No resumes yet.');
  await page.fill('input[placeholder^="Name"]', 'Main');
  await page.setInputFiles('input[type=file]', { name: 'jane.pdf', mimeType: 'application/pdf', buffer: samplePdf() });
  await page.waitForSelector('.badge.blue');

  const r = db.resumes[0];
  assert.equal(r.alias, 'Main');
  assert.equal(r.is_default, true);
  assert.equal(r.storage_path, `${UID}/${r.id}`);
  assert.match(r.text_content, /Jane Doe Data Analyst/);
  assert.ok(last(c => c.storage)?.storage.endsWith(`/object/resumes/${UID}/${r.id}`));
});

test('saved answers: add, edit and delete', async () => {
  const page = await open('#answers');
  await page.waitForSelector('text=How did you hear about us?');
  await page.fill('input[placeholder^="Question"]', 'Are you willing to Relocate?');
  await page.fill('textarea[placeholder="Your answer"]', 'Yes, within the US');
  await page.selectOption('select', 'preference');
  await page.click('text=Add answer');
  await page.waitForSelector('text=Are you willing to Relocate?');
  const added = db.answer_bank.find(a => a.question === 'Are you willing to Relocate?');
  assert.equal(added.question_key, 'are you willing to relocate');
  assert.equal(added.category, 'preference');

  const card = page.locator('.item', { hasText: 'How did you hear about us?' });
  await card.locator('textarea').fill('A friend');
  await card.locator('text=Save').click();
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent === 'Saved.');
  assert.equal(db.answer_bank.find(a => a.id === 'a1').answer, 'A friend');

  page.once('dialog', d => d.accept());
  await card.locator('text=Delete').click();
  await page.waitForFunction(() => !document.body.textContent.includes('How did you hear about us?'));
  assert.equal(db.answer_bank.some(a => a.id === 'a1'), false);
});

test('applications: status change is recorded with history', async () => {
  const page = await open('#applications');
  await page.waitForSelector('text=Acme');
  assert.ok((await page.textContent('#view')).includes('61 → 84'));
  await page.locator('tbody select').selectOption('interview');
  await page.waitForFunction(() => document.querySelector('#toast')?.classList.contains('show'));
  const a = db.applications[0];
  assert.equal(a.application.status, 'interview');
  assert.deepEqual(a.status_history.map(h => [h.from, h.to]), [['detected', 'interview']]);
});

test('settings: answer mode and the fill-statistics opt-in merge into the profile settings', async () => {
  const page = await open('#settings');
  await page.waitForSelector('text=Fill statistics');
  assert.equal(await page.isChecked('input[type=checkbox]'), false); // off by default
  await page.selectOption('select', 'ask_all');
  await page.check('input[type=checkbox]');
  await page.click('text=Save settings');
  await page.waitForFunction(() => document.querySelector('#toast')?.textContent === 'Settings saved.');
  assert.deepEqual(db.user_profiles[0].settings, { atsThreshold: 70, answerMode: 'ask_all', shareFillStats: true });
  assert.equal(db.user_profiles[0].personal.firstName, 'Ahmet'); // profile untouched
});

test('credits: balance, usage, and checkout through the backend function', async () => {
  const page = await open('#credits');
  await page.waitForSelector('.big');
  assert.equal(await page.textContent('.big'), '42');
  assert.ok((await page.textContent('#view')).includes('ATS score'));
  await page.click('text=Buy credits');
  await page.waitForURL(/#stripe$/);
  const fn = last(c => c.fn);
  assert.equal(fn.fn, 'create-checkout-session');
  assert.equal(fn.auth, 'Bearer test-token');
  assert.equal(fn.body.mode, 'credits');
  assert.match(fn.body.successUrl, /app\.html#credits\?checkout=success$/);
});
