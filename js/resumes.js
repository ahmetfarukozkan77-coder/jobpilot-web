// Resumes section.  Same layout the extension uses: the file in the private
// "resumes" bucket at <user id>/<resume id>, its plain text in the resumes
// table (for ATS scoring, tailoring and answers).
import { sb, h, must, toast, busy, fmtDate } from './db.js';

const ACCEPT = '.pdf,.txt,.doc,.docx';

let pdfjs = null;
async function pdfText(file) {
  if (!pdfjs) {
    pdfjs = await import('./vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    // Keep line breaks: a new line starts wherever pdf.js marks one.
    pages.push(content.items.map(it => it.str + (it.hasEOL ? '\n' : '')).join(''));
  }
  return pages.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function textOf(file) {
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return pdfText(file);
  if (/\.txt$/i.test(file.name) || file.type.startsWith('text/')) return (await file.text()).trim();
  return ''; // .doc / .docx: the user pastes the text
}

async function list(userId) {
  return must(await sb.from('resumes')
    .select('id, alias, filename, content_type, storage_path, text_content, is_default, uploaded_at')
    .eq('user_id', userId).order('uploaded_at'));
}

async function makeDefault(userId, id) {
  must(await sb.from('resumes').update({ is_default: false }).eq('user_id', userId).neq('id', id));
  must(await sb.from('resumes').update({ is_default: true }).eq('user_id', userId).eq('id', id));
}

async function upload(userId, file, alias, isFirst) {
  const id = crypto.randomUUID();
  const path = `${userId}/${id}`;
  const contentType = file.type || 'application/octet-stream';
  const text = await textOf(file).catch(() => '');
  must(await sb.storage.from('resumes').upload(path, file, { contentType, upsert: false }));
  must(await sb.from('resumes').insert({
    id, user_id: userId, alias: alias || file.name.replace(/\.[^.]+$/, ''), filename: file.name,
    content_type: contentType, storage_path: path, text_content: text, is_default: isFirst,
    uploaded_at: new Date().toISOString(),
  }));
  return text;
}

async function remove(userId, r, others) {
  if (r.storage_path) must(await sb.storage.from('resumes').remove([r.storage_path]));
  must(await sb.from('resumes').delete().eq('user_id', userId).eq('id', r.id));
  if (r.is_default && others.length) await makeDefault(userId, others[0].id);
}

export async function render(view, { user }) {
  let rows = await list(user.id);
  let dirty = false;

  const fileInput = h('input', { type: 'file', accept: ACCEPT, class: 'hidden' });
  const aliasInput = h('input', { type: 'text', placeholder: 'Name, e.g. "Data analyst"' });
  const addBtn = h('button.btn.primary', { type: 'button' }, 'Upload resume');
  addBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => busy(addBtn, async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) throw new Error('That file is over 10 MB.');
    const text = await upload(user.id, file, aliasInput.value.trim(), rows.length === 0);
    aliasInput.value = '';
    toast(text ? 'Resume uploaded.' : 'Uploaded. No text could be read from it — paste the text below so JobPilot can use it.');
    rows = await list(user.id);
    draw();
  }));

  const listBox = h('div');
  function draw() {
    if (!rows.length) { listBox.replaceChildren(h('p.empty', {}, 'No resumes yet.')); return; }
    listBox.replaceChildren(...rows.map(r => {
      const alias = h('input', { type: 'text', value: r.alias || '' });
      const text = h('textarea', { rows: 10, value: r.text_content || '' });
      const save = h('button.btn.small.primary', { type: 'button', disabled: true }, 'Save');
      const changed = () => { save.disabled = false; dirty = true; };
      alias.addEventListener('input', changed);
      text.addEventListener('input', changed);
      save.addEventListener('click', () => busy(save, async () => {
        must(await sb.from('resumes').update({ alias: alias.value.trim(), text_content: text.value })
          .eq('user_id', user.id).eq('id', r.id));
        r.alias = alias.value.trim(); r.text_content = text.value;
        dirty = false;
        toast('Saved.');
      }).then(() => { save.disabled = !dirty; }));

      const details = h('details', {}, h('summary.sub', {}, `Resume text (${(r.text_content || '').length} characters)`), text);
      return h('div.item', {},
        h('div.item-head', {},
          h('div', {}, h('strong', {}, r.alias || r.filename || 'Resume'), ' ',
            r.is_default ? h('span.badge.blue', {}, 'Default') : null),
          h('span.sub', {}, `${r.filename || ''} · ${fmtDate(r.uploaded_at)}`)),
        h('label.f', { style: 'margin-top:8px' }, 'Name', alias),
        details,
        !r.text_content ? h('p.sub', {}, 'No text yet. Paste your resume text above so JobPilot can score and use it.') : null,
        h('div.row', { style: 'margin-top:10px' },
          save,
          r.is_default ? null : h('button.btn.small', { type: 'button', onclick: e => busy(e.target, async () => {
            await makeDefault(user.id, r.id); rows = await list(user.id); draw(); toast('Default resume changed.');
          }) }, 'Make default'),
          r.storage_path ? h('button.btn.small', { type: 'button', onclick: e => busy(e.target, async () => {
            const { signedUrl } = must(await sb.storage.from('resumes').createSignedUrl(r.storage_path, 60, { download: r.filename || true }));
            location.href = signedUrl;
          }) }, 'Download') : null,
          h('button.btn.small.danger', { type: 'button', onclick: e => {
            if (!confirm(`Delete "${r.alias || r.filename}"?`)) return;
            busy(e.target, async () => {
              await remove(user.id, r, rows.filter(x => x.id !== r.id));
              rows = await list(user.id); draw(); toast('Resume deleted.');
            });
          } }, 'Delete')));
    }));
  }
  draw();

  view.replaceChildren(
    h('div.panel', {},
      h('h2', {}, 'Resumes'),
      h('p.sub', {}, 'PDF and text files are read automatically. For Word files, paste the text after uploading. The default resume is the one the extension uploads to forms.'),
      h('div.row', { style: 'margin-top:12px' }, aliasInput, addBtn, fileInput)),
    h('div.panel', {}, listBox));
  return { dirty: () => dirty };
}
