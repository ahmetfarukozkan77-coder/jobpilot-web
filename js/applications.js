// Applications section: the history the extension records (replaces the
// extension's Tracker page).  Status changes are appended to status_history
// the same way the extension does it.
import { sb, h, must, toast, busy, fmtDate } from './db.js';

const STATUSES = ['detected', 'in-progress', 'submitted', 'interview', 'offer', 'rejected', 'withdrawn'];
const label = s => s.replace('-', ' ').replace(/^./, c => c.toUpperCase());

async function list(userId) {
  return must(await sb.from('applications')
    .select('id, job, application, ats, notes, follow_up_date, status_history, created_at, updated_at')
    .eq('user_id', userId).order('updated_at', { ascending: false }).limit(1000));
}

function csv(rows) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Date', 'Company', 'Title', 'Location', 'Status', 'ATS (original)', 'ATS (tailored)', 'URL', 'Notes'];
  const lines = rows.map(r => [r.created_at?.slice(0, 10), r.job?.company, r.job?.title, r.job?.location,
    r.application?.status, r.ats?.originalScore, r.ats?.tailoredScore, r.job?.jobUrl, r.notes].map(esc).join(','));
  return [head.map(esc).join(','), ...lines].join('\n');
}

function download(name, text, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}

export async function render(view, { user }) {
  let rows = await list(user.id);
  const filter = h('select', {}, h('option', { value: '' }, 'All statuses'), STATUSES.map(s => h('option', { value: s }, label(s))));
  const search = h('input', { type: 'search', placeholder: 'Search company or title' });
  const body = h('div');

  function draw() {
    const q = search.value.trim().toLowerCase();
    const shown = rows.filter(r => (!filter.value || r.application?.status === filter.value) &&
      (!q || `${r.job?.company} ${r.job?.title}`.toLowerCase().includes(q)));
    if (!shown.length) {
      body.replaceChildren(h('p.empty', {}, rows.length ? 'Nothing matches.' : 'No applications yet. They appear here once the extension reads a job posting.'));
      return;
    }
    body.replaceChildren(h('table', {},
      h('thead', {}, h('tr', {}, ['Company', 'Role', 'Status', 'ATS', 'Updated', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, shown.map(r => {
        const status = h('select', {}, STATUSES.map(s => h('option', { value: s }, label(s))));
        status.value = r.application?.status || 'detected';
        status.addEventListener('change', () => busy(null, async () => {
          const prev = r.application?.status || 'detected';
          const now = new Date().toISOString();
          const application = { ...(r.application || {}), status: status.value,
            ...(status.value === 'submitted' && !r.application?.submittedAt ? { submittedAt: now } : {}) };
          const history = [...(r.status_history || []), { from: prev, to: status.value, at: now }];
          must(await sb.from('applications').update({ application, status_history: history, updated_at: now })
            .eq('user_id', user.id).eq('id', r.id));
          Object.assign(r, { application, status_history: history, updated_at: now });
          toast(`Marked as ${label(status.value).toLowerCase()}.`);
        }));
        const ats = [r.ats?.originalScore, r.ats?.tailoredScore].filter(v => v != null);
        return h('tr', {},
          h('td', {}, r.job?.company || '—'),
          h('td', {}, r.job?.jobUrl ? h('a', { href: r.job.jobUrl, target: '_blank', rel: 'noopener' }, r.job?.title || 'Untitled') : (r.job?.title || 'Untitled'),
            r.job?.location ? h('div.sub', {}, r.job.location) : null),
          h('td', {}, status),
          h('td', {}, ats.length ? ats.map(Math.round).join(' → ') : '—'),
          h('td.sub', {}, fmtDate(r.updated_at)),
          h('td', {}, h('button.btn.small.danger', { type: 'button', onclick: e => {
            if (!confirm(`Delete ${r.job?.company || 'this'} — ${r.job?.title || 'application'}?`)) return;
            busy(e.target, async () => {
              must(await sb.from('applications').delete().eq('user_id', user.id).eq('id', r.id));
              rows = rows.filter(x => x.id !== r.id); draw(); toast('Deleted.');
            });
          } }, 'Delete')));
      }))));
  }
  filter.addEventListener('change', draw);
  search.addEventListener('input', draw);
  draw();

  const counts = STATUSES.map(s => [s, rows.filter(r => r.application?.status === s).length]).filter(([, n]) => n);
  view.replaceChildren(
    h('div.panel', {},
      h('div.item-head', {}, h('h2', {}, 'Applications'),
        h('div.row', {},
          h('button.btn.small', { type: 'button', onclick: () => download('jobpilot-applications.csv', csv(rows), 'text/csv') }, 'Export CSV'),
          h('button.btn.small', { type: 'button', onclick: () => download('jobpilot-applications.json', JSON.stringify(rows, null, 2), 'application/json') }, 'Export JSON'))),
      h('p.sub', {}, counts.length ? counts.map(([s, n]) => `${n} ${label(s).toLowerCase()}`).join(' · ') : 'Nothing recorded yet.'),
      h('div.row', { style: 'margin-top:12px' }, search, filter)),
    h('div.panel', { style: 'overflow-x:auto' }, body));
  return {};
}
