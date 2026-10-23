// Saved answers (the answer bank): answers you gave in the extension's chat
// panel.  The extension reuses them when a similar question appears.
import { sb, h, must, toast, busy, fmtDate } from './db.js';

// Same normalization as the extension (background/answer-bank.js) and the
// backend (_shared/bank.ts), so edits here keep matching.
function questionKey(q) {
  return String(q || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 300);
}

const CATEGORIES = [
  ['unknowable', 'Only you know (referrals, how you heard of us…)'],
  ['preference', 'Preference (salary, start date, relocation…)'],
  ['open_ended', 'Written answer (adapted to each job)'],
  ['sensitive',  'Sensitive (authorization, EEO…)'],
];
const LABEL = Object.fromEntries(CATEGORIES);

async function list(userId) {
  return must(await sb.from('answer_bank')
    .select('id, question, answer, category, times_used, last_used_at, updated_at')
    .eq('user_id', userId).order('updated_at', { ascending: false }));
}

export async function render(view, { user }) {
  let rows = await list(user.id);
  let dirty = false;
  const search = h('input', { type: 'search', placeholder: 'Search questions and answers' });
  const listBox = h('div');

  function draw() {
    const q = search.value.trim().toLowerCase();
    const shown = rows.filter(r => !q || `${r.question} ${r.answer}`.toLowerCase().includes(q));
    if (!shown.length) {
      listBox.replaceChildren(h('p.empty', {}, rows.length ? 'Nothing matches.' :
        'No saved answers yet. When the extension asks you something in its chat panel, tick "Remember this answer" and it shows up here.'));
      return;
    }
    listBox.replaceChildren(...shown.map(r => {
      const answer = h('textarea', { rows: 3, value: r.answer });
      const save = h('button.btn.small.primary', { type: 'button', disabled: true }, 'Save');
      answer.addEventListener('input', () => { save.disabled = false; dirty = true; });
      save.addEventListener('click', () => busy(save, async () => {
        const text = answer.value.trim();
        if (!text) throw new Error('An answer cannot be empty — delete it instead.');
        must(await sb.from('answer_bank').update({ answer: text }).eq('user_id', user.id).eq('id', r.id));
        r.answer = text; dirty = false; toast('Saved.');
      }).then(() => { save.disabled = !dirty; }));
      return h('div.item', {},
        h('div.item-head', {}, h('strong', {}, r.question), h('span.badge', {}, LABEL[r.category] ? r.category.replace('_', ' ') : r.category)),
        h('p.sub', {}, r.times_used ? `Reused ${r.times_used}× · last ${fmtDate(r.last_used_at)}` : `Saved ${fmtDate(r.updated_at)}`),
        answer,
        h('div.row', { style: 'margin-top:8px' }, save,
          h('button.btn.small.danger', { type: 'button', onclick: e => {
            if (!confirm('Delete this saved answer?')) return;
            busy(e.target, async () => {
              must(await sb.from('answer_bank').delete().eq('user_id', user.id).eq('id', r.id));
              rows = rows.filter(x => x.id !== r.id); draw(); toast('Deleted.');
            });
          } }, 'Delete')));
    }));
  }
  search.addEventListener('input', draw);
  draw();

  // Add an answer before the extension ever asks.
  const newQ = h('input', { type: 'text', placeholder: 'Question, e.g. "How did you hear about us?"' });
  const newA = h('textarea', { rows: 2, placeholder: 'Your answer' });
  const newC = h('select', {}, CATEGORIES.map(([v, l]) => h('option', { value: v }, l)));
  const add = h('button.btn.primary', { type: 'button' }, 'Add answer');
  add.addEventListener('click', () => busy(add, async () => {
    const question = newQ.value.trim(), answer = newA.value.trim();
    if (!question || !answer) throw new Error('Write both the question and the answer.');
    must(await sb.from('answer_bank').upsert({
      user_id: user.id, question, question_key: questionKey(question), answer, category: newC.value,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,question_key' }));
    newQ.value = ''; newA.value = '';
    rows = await list(user.id); draw(); toast('Answer saved.');
  }));

  view.replaceChildren(
    h('div.panel', {},
      h('h2', {}, 'Saved answers'),
      h('p.sub', {}, 'The extension offers these when a similar question appears. Written answers are adapted to each job rather than copied. Consent questions are never answered from here.'),
      h('div.grid', { style: 'margin-top:12px' },
        h('label.f.full', {}, 'Question', newQ), h('label.f.full', {}, 'Answer', newA),
        h('label.f', {}, 'Kind', newC)),
      h('div.row', { style: 'margin-top:10px' }, add)),
    h('div.panel', {}, search, h('div', { style: 'margin-top:12px' }, listBox)));
  return { dirty: () => dirty };
}
