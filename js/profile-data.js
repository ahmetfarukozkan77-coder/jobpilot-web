// The user_profiles row as the extension's preferences object (same shape as
// getDefaultPreferences() in the extension's utils/storage.js).
import { sb, must } from './db.js';

export function defaults() {
  return {
    personal: { firstName: '', middleName: '', lastName: '', email: '', phone: '', address: '', country: '',
                linkedin: '', github: '', portfolio: '' },
    workPreferences: { desiredRoles: [], desiredSalaryMin: null, desiredSalaryMax: null, salaryCurrency: 'USD',
                       preferredLocations: [], workModes: [], jobTypes: [], openToRelocation: false, noticePeriod: '' },
    shortAnswers: { aboutYourself: '', whyWorkHere: '', greatestStrength: '', greatestWeakness: '', customTemplates: [] },
    references: [],
    voluntaryDisclosures: { gender: 'Prefer not to say', race: 'Decline to self-identify',
                            veteran: 'I am not a protected veteran', disability: 'I do not have a disability' },
    education: { degreeType: '' },
    settings: { atsThreshold: 60 },
  };
}

export async function loadProfile(userId) {
  const row = must(await sb.from('user_profiles').select('*').eq('user_id', userId).maybeSingle());
  const d = defaults();
  if (!row) return d;
  return {
    personal:             { ...d.personal, ...(row.personal || {}) },
    workPreferences:      { ...d.workPreferences, ...(row.work_preferences || {}) },
    shortAnswers:         { ...d.shortAnswers, ...(row.short_answers || {}) },
    references:           Array.isArray(row.reference) ? row.reference : [],
    voluntaryDisclosures: { ...d.voluntaryDisclosures, ...(row.voluntary_disclosures || {}) },
    education:            { ...d.education, ...(row.education || {}) },
    settings:             { ...d.settings, ...(row.settings || {}) },
  };
}

export async function saveProfile(userId, p) {
  must(await sb.from('user_profiles').upsert({
    user_id:               userId,
    personal:              p.personal,
    work_preferences:      p.workPreferences,
    short_answers:         p.shortAnswers,
    reference:             p.references,
    voluntary_disclosures: p.voluntaryDisclosures,
    education:             p.education,
    settings:              p.settings,
  }, { onConflict: 'user_id' }));
}
