// Settings section: options stored in the profile's settings object, which
// the extension syncs (answer mode, ATS threshold, fill statistics opt-in).
import { h, toast, busy } from './db.js';
import { loadProfile, saveProfile } from './profile-data.js';

export async function render(view, { user }) {
  const p = await loadProfile(user.id);
  const s = p.settings;

  const mode = h('select', {},
    h('option', { value: 'auto' }, 'Auto — writes everything it can, asks only what it cannot know'),
    h('option', { value: 'smart' }, 'Smart — asks when unsure and for preferences such as salary'),
    h('option', { value: 'ask_all' }, 'Ask all — fills only clear facts, drafts the rest for you'));
  mode.value = s.answerMode || 'smart';
  const ats = h('input', { type: 'number', min: 0, max: 100, value: s.atsThreshold ?? 60 });
  const stats = h('input', { type: 'checkbox', checked: s.shareFillStats === true });

  const save = h('button.btn.primary', { type: 'button' }, 'Save settings');
  save.addEventListener('click', () => busy(save, async () => {
    const fresh = await loadProfile(user.id); // don't overwrite profile edits made elsewhere
    fresh.settings = {
      ...fresh.settings,
      answerMode: mode.value,
      atsThreshold: Math.max(0, Math.min(100, Number(ats.value) || 0)),
      shareFillStats: stats.checked,
    };
    await saveProfile(user.id, fresh);
    toast('Settings saved.');
  }));

  view.replaceChildren(
    h('div.panel', {},
      h('h2', {}, 'Settings'),
      h('div.grid', { style: 'margin-top:10px' },
        h('label.f.full', {}, 'Default answer mode (you can still change it per page in the extension)', mode),
        h('label.f', {}, 'ATS score to aim for', ats)),
      h('h3', {}, 'Fill statistics'),
      h('div.checks', {}, h('label', {}, stats, 'Share fill statistics to help improve JobPilot')),
      h('p.sub', {}, 'Off unless you turn it on. When on, each fill records the site, field types, which step filled each field and whether it worked — never the values you enter or your answers. See the privacy policy.'),
      h('div.row', { style: 'margin-top:14px' }, save)),
    h('div.panel', {},
      h('h2', {}, 'Account'),
      h('p', {}, `Signed in as ${user.email}`),
      h('p.sub', {}, 'To delete your account and all data, open an issue on the project page or contact the developer; Stripe billing data is managed under Credits → Manage billing.')));
  return {};
}
