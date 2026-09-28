# 💰 My Money Tracker

A small, mobile-friendly personal **Income & Expense Tracker**.

- **Frontend:** plain HTML + CSS + JavaScript (no build step)
- **Database + login:** Supabase (PostgreSQL, free plan)
- **Hosting:** GitHub Pages (free)

## Features

| Area | What you get |
|---|---|
| Dashboard | Month's income, expenses, EMI, other expenses, available balance, savings %, savings-goal progress, comparison with last month, last-6-months table |
| Income | Salary / other income entries with categories, notes and dates |
| Expenses | Loan/EMI, Rent, Food, Electricity, Travel, Shopping, Other + your own categories |
| Loans | Loan name, original amount, monthly EMI, EMIs paid / remaining, remaining amount, one-tap "Record EMI" that adds the expense for you |
| Savings goal | Target as % of income or a fixed amount per month |
| Reports | Income vs expenses (12 months), savings trend, category-wise expenses, table views |
| Security | Email + password login; Row Level Security so only you can read your rows |

## Project layout

```
income-tracker/
├─ index.html            ← the app (login + all screens)
├─ css/style.css         ← styles (light + dark mode)
├─ js/config.js          ← ⚠️ put your Supabase URL + anon key here
├─ js/app.js             ← all app logic
├─ supabase/schema.sql   ← database tables + security policies
├─ serve.js              ← optional: local test server (node serve.js)
└─ README.md
```

---

## Setup (about 15 minutes)

### 1. Create the database on Supabase

1. Go to <https://supabase.com>, sign in, click **New project**.
   Give it a name (e.g. `money-tracker`), choose a strong database password, pick the region nearest to you, click **Create**.
2. In the left sidebar open **SQL Editor → New query**.
3. Open `supabase/schema.sql` from this folder, copy everything, paste it into the editor and click **Run**.
   You should see "Success. No rows returned".
4. In the sidebar open **Table Editor** and confirm four tables exist:
   `categories`, `loans`, `transactions`, `settings`.

### 2. Configure login

1. Sidebar → **Authentication → Providers → Email**. Keep **Email** enabled.
2. Optional but convenient for a personal app: turn **Confirm email** *off* so you can sign in immediately after creating your account.
   (If you leave it on, Supabase emails you a confirmation link when you sign up.)
3. Click **Save**.

### 3. Connect the app to your project

1. Sidebar → **Project Settings → API**.
2. Copy **Project URL** and the **anon public** key.
3. Open `js/config.js` and replace the placeholders:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....",
};
```

> The anon key is designed to be public. Row Level Security (set up by `schema.sql`) makes sure every user only ever sees their own data.

### 4. Try it on your computer first

Because the app calls Supabase from the browser, serve it over `http://` rather than opening the file directly. Any of these work from inside the `income-tracker` folder:

```powershell
node serve.js
```

(`serve.js` is a tiny dependency-free server included in this folder. It is not needed on GitHub Pages.)

Open <http://localhost:8080>, click **New here? Create an account**, enter your email and a password, then sign in.

### 5. Put it online with GitHub Pages

1. Create a new **public** repository on GitHub named `income-tracker` (any name works).
2. Upload the contents of this folder to the repository. From PowerShell:

```powershell
cd C:\Users\MUTHUPANDI.R\income-tracker
git init
git add .
git commit -m "My Money Tracker"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/income-tracker.git
git push -u origin main
```

3. In the repository open **Settings → Pages**.
   Under **Build and deployment** choose **Deploy from a branch**, branch **main**, folder **/ (root)**, click **Save**.
4. After a minute your app is live at:

```
https://YOUR_USERNAME.github.io/income-tracker/
```

5. Back in Supabase: **Authentication → URL Configuration** → set **Site URL** to that address and click **Save** (this makes any confirmation / password-reset emails link back to your app).

### 6. Lock it down to just you (recommended)

After you have created your own account:

- Supabase → **Authentication → Providers → Email** → turn **Allow new users to sign up** *off* → **Save**.

Nobody else can register, and Row Level Security already prevents anyone from reading your rows.

---

## Using the app

- **Month switcher** in the header moves between months. Tap the month name to jump back to the current month.
- **+ Add Income / + Add Expense** open a form; the app moves to the month of the date you choose.
- **Expenses → Categories** lets you add or remove your own categories (a category in use cannot be deleted).
- **Loans → + → Add loan** with the original amount, monthly EMI and number of EMIs.
  Each month tap **Record EMI**: the app adds an expense under *Loan/EMI*, links it to the loan and counts one EMI as paid. Deleting that expense un-counts it.
- **Savings goal** (dashboard) can be a % of income or a fixed amount.
- **Reports** show the last 12 months ending at the selected month. Every chart has a table view underneath.
- Dark mode follows your device setting.

## Add it to your phone's home screen

Open the GitHub Pages URL in Chrome (Android) or Safari (iPhone) → menu → **Add to Home screen**. It then opens like an app.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Setup needed" screen | `js/config.js` still has the placeholder values. |
| "Invalid login credentials" | Wrong email/password, or the account was not confirmed (check your inbox, or turn off *Confirm email*). |
| "relation … does not exist" / "permission denied" | `schema.sql` was not run in this project, or ran with errors. Run it again. |
| Data appears blank after signing in from another device | Both devices must use the same Supabase project and the same login. |
| Changes on GitHub not visible | GitHub Pages takes ~1 minute to redeploy; hard-refresh the page (Ctrl+F5). |

## Backing up your data

Supabase → **Table Editor → transactions → Export → CSV** (repeat for `loans` if you like). The free plan also keeps the database online as long as the project is used at least once a week; sign in occasionally or it may be paused (you can un-pause it from the dashboard any time).
