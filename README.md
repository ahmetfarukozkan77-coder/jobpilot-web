# JobPilot website

Account pages for the JobPilot Chrome extension: profile, resumes, saved
answers, application history, credits and settings, plus the privacy policy.

Static HTML and JavaScript (no build step), served by GitHub Pages. It talks
to the JobPilot Supabase project with the public anon key; row-level security
limits every signed-in user to their own rows.

- `index.html`: sign in with Google
- `app.html`: the account app (`js/app.js` and one module per section)
- `privacy.html`: privacy policy (linked from the Chrome Web Store listing)
- `js/vendor/`: pinned third-party builds (supabase-js 2.117.2, pdf.js 6.3.289)

Run locally: `npx http-server -p 8080` in this folder. Sign-in needs the page
address in the Supabase project's Auth redirect URLs.
