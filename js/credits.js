// Credits section: balance, recent usage, and Stripe checkout / billing portal.
import { sb, h, must, busy, fmtDate, callFunction, appUrl, toast } from './db.js';
import { PRICES } from './config.js';

const OPERATION = {
  field_map: 'Fill: read the form', field_agent: 'Fill: fix a field', jd_extract: 'Read job posting', ats_score: 'ATS score',
  resume_tailor: 'Tailor resume', cover_letter: 'Cover letter', form_fill: 'Form suggestions', option_match: 'Dropdown match',
  field_scan: 'AI field scan',
};

export async function render(view, { user }) {
  const [bal, usage, sub] = await Promise.all([
    sb.from('credit_balances').select('balance').eq('user_id', user.id).maybeSingle(),
    sb.from('usage_logs').select('operation, model, credits_charged, created_at').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(50),
    sb.from('subscriptions').select('status, current_period_end').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(1),
  ]);
  const balance = must(bal)?.balance ?? 0;
  const logs = must(usage) || [];
  const subscription = (sub.data || [])[0];

  if (/[?&]checkout=success/.test(location.hash)) toast('Thanks! Your credits are added once Stripe confirms the payment.');

  const checkout = (mode, button) => busy(button, async () => {
    const { url } = await callFunction('create-checkout-session', {
      mode, priceId: PRICES[mode], successUrl: appUrl('#credits?checkout=success'), cancelUrl: appUrl('#credits'),
    });
    if (url) location.href = url;
  });
  const portal = button => busy(button, async () => {
    const { url } = await callFunction('billing-portal', { returnUrl: appUrl('#credits') });
    if (url) location.href = url;
  });

  const spent30 = logs.filter(l => Date.now() - new Date(l.created_at) < 30 * 864e5)
    .reduce((s, l) => s + Number(l.credits_charged || 0), 0);

  view.replaceChildren(
    h('div.panel', {},
      h('h2', {}, 'Credits'),
      h('div.big', {}, String(balance)),
      h('p.sub', {}, `credits left · ${spent30} used in the last 30 days`),
      subscription ? h('p.sub', {}, `Subscription: ${subscription.status}${subscription.current_period_end ? ` · renews ${fmtDate(subscription.current_period_end)}` : ''}`) : null,
      h('div.row', { style: 'margin-top:14px' },
        h('button.btn.primary', { type: 'button', onclick: e => checkout('subscription', e.target) }, 'Subscribe'),
        h('button.btn', { type: 'button', onclick: e => checkout('credits', e.target) }, 'Buy credits'),
        h('button.btn', { type: 'button', onclick: e => portal(e.target) }, 'Manage billing'))),
    h('div.panel', { style: 'overflow-x:auto' },
      h('h2', {}, 'Recent usage'),
      logs.length
        ? h('table', {},
            h('thead', {}, h('tr', {}, ['When', 'What', 'Credits'].map(t => h('th', {}, t)))),
            h('tbody', {}, logs.map(l => h('tr', {},
              h('td.sub', {}, new Date(l.created_at).toLocaleString()),
              h('td', {}, OPERATION[l.operation] || l.operation),
              h('td', {}, String(l.credits_charged))))))
        : h('p.empty', {}, 'No usage yet.')));
  return {};
}
