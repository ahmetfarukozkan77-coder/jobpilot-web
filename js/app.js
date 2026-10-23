// Account app: one page, one section per hash (#profile, #resumes, …).
// Every section reads and writes the signed-in user's own rows directly;
// row-level security on the backend enforces that.
import { sb, $, h, currentUser, toast } from './db.js';
import * as profile from './profile.js';
import * as resumes from './resumes.js';
import * as answers from './answers.js';
import * as applications from './applications.js';
import * as credits from './credits.js';
import * as settings from './settings.js';

const SECTIONS = { profile, resumes, answers, applications, credits, settings };
let current = null; // the section on screen: { name, dirty() }

const user = await currentUser();
if (!user) {
  location.replace('index.html');
} else {
  $('#who-email').textContent = user.email || '';
  $('#btn-signout').addEventListener('click', async () => {
    await sb.auth.signOut();
    location.replace('index.html');
  });
  window.addEventListener('hashchange', show);
  show();
}

async function show() {
  const name = (location.hash || '#profile').slice(1).split('?')[0];
  const section = SECTIONS[name] ? name : 'profile';
  if (current?.dirty?.() && !confirm('You have unsaved changes. Leave this section anyway?')) {
    history.replaceState(null, '', `#${current.name}`);
    return;
  }
  document.querySelectorAll('nav.tabs a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${section}`));
  const view = $('#view');
  view.replaceChildren(h('p.empty', {}, 'Loading…'));
  try {
    current = { name: section, ...(await SECTIONS[section].render(view, { user })) };
  } catch (e) {
    view.replaceChildren(h('div.panel', {}, h('p', {}, `Could not load this section: ${e.message}`)));
    toast(e.message, 'error');
  }
}

window.addEventListener('beforeunload', e => {
  if (current?.dirty?.()) { e.preventDefault(); e.returnValue = ''; }
});
