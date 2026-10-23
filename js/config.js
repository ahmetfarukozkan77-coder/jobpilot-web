// Public project settings. The anon key is meant to be public: every table
// is protected by row-level security, so a signed-in user reaches only their
// own rows.
export const SUPABASE_URL  = 'https://mbuwjwmmvojkemuwivbf.supabase.co';
export const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1idXdqd21tdm9qa2VtdXdpdmJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NDE1NTksImV4cCI6MjEwMTUxNzU1OX0.HYFT7Ps3fcWDOo22DNx3hjNtAxGnHUpXyQflssdg2fM';

// Stripe prices offered on the Credits page (same as the extension).
export const PRICES = {
  subscription: 'price_1U18KuCBVs5auDV6vtWuRNhn',
  credits:      'price_1U18OICBVs5auDV6OjOXK6qz',
};
