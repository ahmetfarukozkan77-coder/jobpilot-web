// Profile section: everything the extension fills in from your profile.
import { h, toast, busy } from './db.js';
import { loadProfile, saveProfile } from './profile-data.js';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR'];
const DEGREES = ['', 'Bachelor of Arts (B.A)', 'Bachelor of Science (B.S)', 'Bachelor of Business Administration (B.B.A.)',
  'Master of Science (M.S)', 'Master of Arts (M.A)', 'Master of Business Administration (MBA)', 'Doctor of Philosophy (Ph.D)',
  'Associates of Arts (A.A)', 'Associates of Science (A.S)'];
const GENDER = ['Male', 'Female', ['Non-binary', 'Non-binary / third gender'], 'Prefer not to say', 'Decline to self-identify'];
const RACE = ['White', 'Black or African American', 'Hispanic or Latino', 'Asian', 'American Indian or Alaska Native',
  'Native Hawaiian or Other Pacific Islander', 'Two or more races', 'Decline to self-identify'];
const VETERAN = ['I am not a protected veteran', 'I am a protected veteran', 'Decline to self-identify'];
const DISABILITY = ['I do not have a disability', 'I have a disability', 'Prefer not to answer', 'Decline to self-identify'];

// [path, label, kind, extra]
const SECTIONS = [
  ['Personal information', [
    ['personal.firstName', 'First name'], ['personal.middleName', 'Middle name'], ['personal.lastName', 'Last name'],
    ['personal.email', 'Email', 'email'], ['personal.phone', 'Phone', 'tel'],
    ['personal.address', 'City, state', 'text', 'e.g. Austin, TX'], ['personal.country', 'Country'],
    ['personal.linkedin', 'LinkedIn URL', 'url'], ['personal.github', 'GitHub URL', 'url'],
    ['personal.portfolio', 'Website / portfolio', 'url'],
  ]],
  ['Work preferences', [
    ['workPreferences.desiredRoles', 'Desired roles', 'list', 'Comma-separated, e.g. Data Analyst, BI Analyst'],
    ['workPreferences.desiredSalaryMin', 'Salary minimum', 'number'],
    ['workPreferences.desiredSalaryMax', 'Salary maximum', 'number'],
    ['workPreferences.salaryCurrency', 'Currency', 'select', CURRENCIES],
    ['workPreferences.preferredLocations', 'Preferred locations', 'list', 'Comma-separated'],
    ['workPreferences.noticePeriod', 'Notice period / earliest start', 'text', 'e.g. 2 weeks'],
    ['workPreferences.workModes', 'Work mode', 'checks', [['remote', 'Remote'], ['hybrid', 'Hybrid'], ['onsite', 'Onsite']]],
    ['workPreferences.jobTypes', 'Job type', 'checks',
      [['full-time', 'Full-time'], ['part-time', 'Part-time'], ['contract', 'Contract'], ['internship', 'Internship']]],
    ['workPreferences.openToRelocation', 'Open to relocation', 'bool'],
  ]],
  ['Education', [['education.degreeType', 'Highest degree', 'select', DEGREES]]],
  ['Short answers', [
    ['shortAnswers.aboutYourself', 'Tell us about yourself', 'textarea'],
    ['shortAnswers.whyWorkHere', 'Why do you want to work here?', 'textarea'],
    ['shortAnswers.greatestStrength', 'Greatest strength', 'textarea'],
    ['shortAnswers.greatestWeakness', 'Greatest weakness', 'textarea'],
  ]],
  ['Voluntary disclosures', [
    ['voluntaryDisclosures.gender', 'Gender', 'select', GENDER],
    ['voluntaryDisclosures.race', 'Race / ethnicity', 'select', RACE],
    ['voluntaryDisclosures.veteran', 'Veteran status', 'select', VETERAN],
    ['voluntaryDisclosures.disability', 'Disability status', 'select', DISABILITY],
  ]],
];

const get = (o, path) => path.split('.').reduce((x, k) => x?.[k], o);
const set = (o, path, v) => { const ks = path.split('.'); ks.slice(0, -1).reduce((x, k) => (x[k] ??= {}), o)[ks.at(-1)] = v; };

function control([path, label, kind = 'text', extra], p, markDirty) {
  const value = get(p, path);
  const on = el => { el.addEventListener('input', markDirty); el.addEventListener('change', markDirty); return el; };
  let input;
  switch (kind) {
    case 'textarea':
      return h('label.f.full', {}, label, on(h('textarea', { dataset: { path, kind }, rows: 4, value: value || '' })));
    case 'select': {
      input = h('select', { dataset: { path, kind } },
        extra.map(o => Array.isArray(o) ? h('option', { value: o[0] }, o[1]) : h('option', { value: o }, o || '— Not specified —')));
      input.value = value ?? '';
      return h('label.f', {}, label, on(input));
    }
    case 'checks':
      return h('div.f.full', {}, h('label.f', {}, label),
        h('div.checks', { dataset: { path, kind } }, extra.map(([v, text]) =>
          h('label', {}, on(h('input', { type: 'checkbox', value: v, checked: (value || []).includes(v) })), text))));
    case 'bool':
      return h('div.checks.full', {}, h('label', {},
        on(h('input', { type: 'checkbox', dataset: { path, kind }, checked: !!value })), label));
    case 'list':
      return h('label.f.full', {}, label,
        on(h('input', { type: 'text', dataset: { path, kind }, value: (value || []).join(', '), placeholder: extra || '' })));
    default:
      return h('label.f', {}, label,
        on(h('input', { type: kind, dataset: { path, kind }, value: value ?? '', placeholder: extra || '' })));
  }
}

function readForm(root, p) {
  for (const el of root.querySelectorAll('[data-path]')) {
    const { path, kind } = el.dataset;
    if (kind === 'checks') set(p, path, [...el.querySelectorAll('input:checked')].map(i => i.value));
    else if (kind === 'bool') set(p, path, el.checked);
    else if (kind === 'list') set(p, path, el.value.split(',').map(s => s.trim()).filter(Boolean));
    else if (kind === 'number') set(p, path, el.value === '' ? null : Number(el.value));
    else set(p, path, el.value.trim());
  }
  return p;
}

// Editable list of plain objects (references, custom templates).
function listEditor(title, items, fields, blank, markDirty) {
  const box = h('div.full');
  const draw = () => {
    box.replaceChildren(h('h3', {}, title));
    if (!items.length) box.append(h('p.sub', {}, 'None yet.'));
    items.forEach((it, i) => {
      const grid = h('div.grid', {}, fields.map(([key, label, kind]) => {
        const input = kind === 'textarea'
          ? h('textarea', { rows: 3, value: it[key] || '' })
          : h('input', { type: 'text', value: it[key] || '' });
        input.addEventListener('input', () => { it[key] = input.value; markDirty(); });
        return h(kind === 'textarea' ? 'label.f.full' : 'label.f', {}, label, input);
      }));
      box.append(h('div.item', {}, grid, h('div.row.end', {},
        h('button.btn.small.danger', { type: 'button', onclick: () => { items.splice(i, 1); markDirty(); draw(); } }, 'Remove'))));
    });
    box.append(h('div.row', { style: 'margin-top:10px' },
      h('button.btn.small', { type: 'button', onclick: () => { items.push(blank()); markDirty(); draw(); } }, `Add ${title.toLowerCase().replace(/s$/, '')}`)));
  };
  draw();
  return box;
}

export async function render(view, { user }) {
  const p = await loadProfile(user.id);
  let dirty = false;
  const markDirty = () => { dirty = true; save.disabled = false; };

  const form = h('form', { onsubmit: e => e.preventDefault() });
  for (const [title, fields] of SECTIONS) {
    form.append(h('div.panel', {}, h('h2', {}, title), h('div.grid', {}, fields.map(f => control(f, p, markDirty)))));
  }
  p.shortAnswers.customTemplates ||= [];
  form.append(h('div.panel', {},
    listEditor('Custom answers', p.shortAnswers.customTemplates,
      [['question', 'Question'], ['answer', 'Answer', 'textarea']], () => ({ question: '', answer: '' }), markDirty)));
  form.append(h('div.panel', {},
    listEditor('References', p.references,
      [['name', 'Name'], ['position', 'Position'], ['company', 'Company'], ['email', 'Email'], ['phone', 'Phone'], ['relationship', 'Relationship']],
      () => ({ id: crypto.randomUUID(), name: '', position: '', company: '', email: '', phone: '', relationship: '' }), markDirty)));

  const save = h('button.btn.primary', { type: 'button', disabled: true }, 'Save profile');
  save.addEventListener('click', () => busy(save, async () => {
    await saveProfile(user.id, readForm(form, p));
    dirty = false;
    toast('Profile saved. The extension picks it up the next time you open its panel.');
  }).then(() => { save.disabled = dirty === false; }));

  view.replaceChildren(form, h('div.savebar', {}, save));
  return { dirty: () => dirty };
}
