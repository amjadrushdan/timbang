# Timbang

Personal calorie and macro tracker. Vite + vanilla JS front end, Supabase for login and data, Vercel functions for Claude, Open Food Facts and USDA.

## What's already done

- Supabase project **timbang** (`jdhpmmacudqemephosek`, Singapore) is created.
- Tables `settings`, `foods`, `entries`, `saved_meals`, `weights` exist, each locked to its owner with Row Level Security. Supabase's security advisor reports no issues.
- The public Supabase URL and publishable key are in `config.js`. Both are safe to commit.

## Deploy (about 10 minutes)

### 1. Anthropic API key
1. Go to https://platform.claude.com, add a payment method and a small amount of credit.
2. **Set a monthly spend limit** in Console → Limits (e.g. USD 5). This caps the damage if anything goes wrong.
3. Create an API key.

### 2. GitHub
Create a **private** repo and push this folder:
```bash
cd timbang
git init && git add . && git commit -m "Timbang"
git branch -M main
git remote add origin git@github.com:<you>/timbang.git
git push -u origin main
```

### 3. Vercel
1. vercel.com → Add New → Project → import the repo. Framework is detected as Vite; keep the defaults.
2. Settings → Environment Variables:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your key from step 1 |
| `ALLOWED_EMAILS` | the email you'll sign in with |
| `USDA_API_KEY` | optional, free at https://fdc.nal.usda.gov/api-key-signup |

3. Deploy. Note the URL, e.g. `https://timbang-xyz.vercel.app`.

### 4. Supabase Auth settings
In the Supabase dashboard for **timbang** → Authentication:
1. **URL Configuration**: set Site URL to your Vercel URL, and add the same URL under Redirect URLs.
2. Open the app, sign in once with your email so your account exists.
3. **Sign In / Providers → Email**: turn off **Allow new users to sign up**. Your account keeps working; nobody else can create one.
4. Optional, recommended for the installed app: **Emails → Magic Link** template, add `Your code: {{ .Token }}` to the body. Then you can type the 6-digit code inside the installed app instead of the link opening in a browser.

Supabase's built-in email sender is limited to a few emails per hour. That's fine for one person, since sessions last until you sign out.

### 5. Install on your phone
Open the Vercel URL → browser menu → **Add to Home Screen** (Android: Install app).

## Security model
- Data: Row Level Security, owner only. The publishable key alone can't read anything.
- `/api/*` routes: require a valid Supabase session **and** an email in `ALLOWED_EMAILS`. With `ALLOWED_EMAILS` empty, they refuse everyone.
- `ANTHROPIC_API_KEY` exists only in Vercel, never in the browser.

## Costs
- Vercel Hobby, Supabase Free, Open Food Facts, USDA: free.
- Claude API: pay per use. Model defaults to `claude-sonnet-5-5`; set `CLAUDE_MODEL=claude-haiku-5-5` to cut cost further at some accuracy loss.
- Supabase pauses free projects after about a week without use. Logging daily keeps it awake.

## Known limits
- Camera barcode scanning uses the browser's BarcodeDetector: works on Android Chrome, **not on iPhone Safari**. Typing the number works everywhere.
- Open Food Facts data is crowd-sourced. Barcode foods are saved as *unchecked* until you compare them with the label.
- Reminders show in the bell only while the app is open. No push notifications yet.

## Local development
```bash
npm install
npx vercel dev   # runs the front end and /api routes together
```
`npm run dev` alone serves only the front end; the AI and lookup buttons need `vercel dev`.

## Layout
```
index.html, src/        front end (main.js, style.css)
public/                 manifest, service worker, icons
api/                    Vercel functions: analyse, review, barcode, usda
api/_lib/               shared auth check and Claude client (not routes)
config.js               public Supabase URL + publishable key
supabase/migrations/    schema, already applied
```
