# Instinct Dashboard

A private, read-only dashboard for the **Tasks** tab of your Google Sheets task tracker. It is built for your
phone first (it works from 360 px wide), and on a wide screen it shows a table.

- You sign in with Google in your browser. Google gives the page a short-lived, **read-only** pass
  ("access token") for your spreadsheets. The page then reads `Tasks!A1:Z1000` and nothing else.
- The sheet stays private. Its sharing never needs to change.
- There is no server, no database, no client secret, no API key and no service account. The site is just
  files (HTML, CSS, JavaScript) that Netlify or GitHub Pages serves.
- Tasks and the access token live only in the open tab's memory. Signing out, reloading or closing the tab
  clears them. Nothing is saved on the device.

**Contents:** [What it shows](#what-it-shows) · [Setup](#setup) · [1. Google Cloud](#1-google-cloud-setup-one-time) ·
[2. Your computer](#2-run-it-on-your-computer) · [3. Netlify](#3-deploy-to-netlify-recommended) ·
[4. GitHub Pages](#4-deploy-to-github-pages-alternative) · [Everyday use](#everyday-use) ·
[Updating tasks](#updating-tasks) · [Financial priority](#how-financial-priority-works) ·
[Privacy](#privacy-and-its-limits) ·
[Reconnect, sign out, revoke](#reconnect-sign-out-and-revoke-access) · [Stopping a deployment](#stopping-a-deployment) ·
[If a secret is exposed](#if-a-key-or-secret-is-exposed) · [Troubleshooting](#troubleshooting) ·
[Other options](#other-ways-to-connect-not-used) · [For developers](#for-developers)

## What it shows

- **Counts by status**, as chips you can tick or untick: Open, Waiting on you, Waiting on someone else and Done.
  Active tasks show by default; tick **Done** to include finished ones.
- **Search** across Task ID, task name, notes, links and the progress lines.
- **Four views.** **All tasks** lists every task. **By date** groups tasks by their recorded date: Recorded date
  passed, Next 7 days, Later, Ongoing (no fixed date) and No recorded date. **You requested** and **Inbound** show
  the tasks with that value in the sheet's Origin column. A task with a blank or unrecognised Origin stays in All
  tasks and By date, and an **Origin missing** count says how many there are, so no row is dropped silently.
  The status chips and the search work the same in every view.
- **Sort by.** **Financial priority** (the default) orders the list by the sheet's Delay-cost basis and then by
  date, and every task carries a short "Why this order" line. **Recorded date** switches back to the earlier
  order: earliest date first, tasks without a date last. See
  [How Financial priority works](#how-financial-priority-works).
- **Recorded date.** The date in the sheet's Deadline column is shown as a *recorded date*, with a **Verified**,
  **Planning date** or **Not verified** badge from the Date verified column. It may be a planning or check date, so
  the dashboard words it as a date ("in 3 days", "3 days ago") and never calls it due, overdue or enforced.
- **Progress on each task:** Progress, Money at stake (with its Delay-cost basis), Hands-on effort and Expected
  finish, each on its own labelled line and shown exactly as written in the sheet. A line appears once the sheet
  has its column; a blank cell reads "Not recorded". Long text is folded behind **Show full text**.
- **Links** from the sheet's Links column (documents and other work delivered for a task) show on each
  task as buttons that open in a new tab. Search covers them too.
- **Notes** are folded away so the phone view stays short; tap **Show notes**. Notes are shown as plain text.
  Web addresses starting with `https://` become links.
- **Freshness**, always visible at the top of the screen:
  - Green **Synced with your sheet**: the dashboard read the sheet recently. It also shows when ("Last fetched 09:41").
  - Amber **Tasks may be out of date**: the last fetch is over 10 minutes old, or the Google sign-in expired.
  - Red **Refresh failed**: the last refresh didn't work, so the tasks shown are from the last successful fetch.
- Each task also shows its own **Last update** time from the sheet, in your timezone with a timezone label
  (for example `21 Oct 2026, 02:50 GMT+5:30`). Recorded dates are calendar dates and show the same day everywhere.
- **Problems in the sheet**, such as an unknown status, a deadline not written as `YYYY-MM-DD`, a repeated
  Task ID, or an Origin, Delay-cost basis or Date verified value that isn't one of the allowed ones, are listed
  at the bottom. Those rows are still shown, never hidden.
- An **Open sheet** button opens the tracker in Google Sheets.

The dashboard refreshes when you connect, when you press **Refresh**, and on its own at most every 5 minutes
while the page is open and visible. It pauses while the tab is in the background and catches up when you come
back. If Google says to slow down, it waits longer between tries (exponential backoff). It never changes the sheet.

## Setup

You only do this once. In short:

1. In Google Cloud, create a free project and an **OAuth client ID** (about 15 minutes).
2. Optionally, try the dashboard on your computer.
3. Put it online with Netlify (recommended) or GitHub Pages.

You need two values. Neither is a password:

| Setting | What it is | Where it comes from |
| --- | --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | The OAuth client ID. It ends in `.apps.googleusercontent.com`. | Google Cloud, step 1.8 below |
| `VITE_SPREADSHEET_ID` | The long code in your sheet's address, between `/d/` and `/edit` | The address bar when the sheet is open |
| `VITE_GOOGLE_ACCOUNT_HINT` (optional) | Your Gmail address, so Google pre-selects that account | You |

These values are built into the site's code, which anyone who opens the site can read. That is fine: none of
them gives access to anything. Your sheet can still only be read by someone signed in to an account that the
sheet is shared with. If you prefer, leave the optional account hint out.

> **Never** put a *client secret* (it starts with `GOCSPX-`), a service-account key or an API key into these
> settings, a `.env` file or this repository. The dashboard needs none of them. If it ever sees one, it shows a
> warning instead of the dashboard.

### 1. Google Cloud setup (one time)

Use the Google account that owns the tracker sheet throughout. Creating a project and turning on the Google
Sheets API is free. No billing account is needed.

1. Open <https://console.cloud.google.com/> and sign in.
2. **Create a project.** Click the project picker at the top of the page, then **New project**. For
   **Project name**, enter `Instinct Dashboard`, then click **Create**. Make sure the new project is selected in
   the picker.
3. **Turn on the Google Sheets API.** Open the menu (☰), choose **APIs & Services → Library**, search for
   **Google Sheets API**, open it and click **Enable**.
4. **Set up the sign-in screen.** Open the menu (☰) and choose **Google Auth Platform** (or type "Google Auth
   Platform" in the search bar), then click **Get started**:
   - **App information:** for **App name**, enter `Instinct Dashboard`. For **User support email**, choose your
     Gmail address.
   - **Audience:** choose **External**. *Why:* "Internal" is only for Google Workspace organisations, and a
     personal Gmail account is not one. External with **Testing** status (next step) still means only the
     people you list can sign in.
   - **Contact information:** enter your Gmail address.
   - Agree to the policy and click **Create**.
5. **Branding (optional).** Under **Google Auth Platform → Branding**, you can check the app name. Leave the
   logo empty: adding a logo can trigger Google's brand review.
6. **Audience: add yourself as a test user.** Under **Google Auth Platform → Audience**, leave **Publishing
   status** on **Testing**. Under **Test users**, click **+ Add users**, enter your Gmail address and click **Save**.
   *Why Testing:* only listed test users (up to 100) can sign in, which is exactly what a personal dashboard
   needs. Google currently says that sign-ins by test users **expire 7 days after you approve them**, so about
   once a week Google will ask you to approve access again when you connect. Switching to **In production**
   would avoid that, but Google may then require a verification review for spreadsheet access. That isn't
   needed for personal use, and nobody can promise you an exemption.
7. **Data Access: declare the one permission.** Under **Google Auth Platform → Data Access**, click **Add or
   remove scopes**. Find `.../auth/spreadsheets.readonly` (it is listed as "See all your Google Sheets
   spreadsheets"; you can paste `https://www.googleapis.com/auth/spreadsheets.readonly` into the filter), tick
   it, click **Update**, then **Save**. The dashboard asks for this read-only permission and nothing more. It
   covers reading all your spreadsheets, but the dashboard only ever requests the Tasks tab of this one sheet.
   (Google's per-file `drive.file` permission is narrower, but it is not read-only and needs a file picker, so
   it isn't used.)
8. **Create the OAuth client.** Under **Google Auth Platform → Clients**, click **+ Create client**:
   - For **Application type**, choose **Web application**.
   - For **Name**, enter `Instinct Dashboard web`.
   - Under **Authorized JavaScript origins**, click **+ Add URI** and enter `http://localhost:5173`, for trying
     it on your computer. You will add your Netlify (or GitHub Pages) address here later. Enter **origins
     only**: `https://` plus the host name, with no path and no trailing slash. For example
     `https://my-tasks.netlify.app` is right, and `https://my-tasks.netlify.app/` is wrong.
   - Leave **Authorized redirect URIs** empty.
   - Click **Create**, then copy the **Client ID**. That is your `VITE_GOOGLE_CLIENT_ID`.
   - Google also shows a **client secret**. Ignore it. Don't copy it anywhere: this app never uses it.

Changes to origins can take a few minutes to start working.

**What you will see when connecting:** Google may show *"Google hasn't verified this app"*. That is normal for a
personal app in Testing. Check that the app name is the one you created, then choose **Continue**. On the
permission screen, keep the box for viewing your Google Sheets spreadsheets **ticked**. How long a sign-in lasts
is decided by Google: when it runs out, the dashboard keeps your tasks on screen, marks them as possibly out of
date and shows a **Reconnect** button.

### 2. Run it on your computer

This step is optional, but it is the safest way to check everything before putting the site online.

You need [Node.js](https://nodejs.org/) 22 or newer (the "LTS" download) and [Git](https://git-scm.com/).
Then, in a terminal:

```sh
git clone https://github.com/sharan50/Instinct-dashboard.git
cd Instinct-dashboard
npm ci
cp .env.example .env
```

Open the new `.env` file in a text editor, fill in `VITE_GOOGLE_CLIENT_ID` and `VITE_SPREADSHEET_ID` (and
optionally `VITE_GOOGLE_ACCOUNT_HINT`), save it, then run:

```sh
npm run dev
```

Open **<http://localhost:5173>** (exactly this address: `127.0.0.1` will not work with Google sign-in) and
click **Connect Google account**. `.env` is ignored by Git, so your values stay on your computer.

Other commands:

| Command | What it does |
| --- | --- |
| `npm run check` | Lint, type check, all unit and UI tests, and a production build |
| `npm test` | Unit and UI tests |
| `npm run test:tz` | The same tests in three more timezones |
| `npm run test:e2e` | Browser tests on a phone-sized and a desktop-sized screen. Run `npx playwright install chromium` once first. |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serves the production build at <http://localhost:4173>. Add that origin to the OAuth client if you want to sign in there. |

All tests use made-up tasks and a fake Google. They never touch your real sheet.

### 3. Deploy to Netlify (recommended)

Netlify's free plan is enough. Netlify's labels changed in 2025: older screens say "site" where newer ones say "project".

1. Sign in at <https://app.netlify.com/> (signing in with GitHub is easiest).
2. Click **Add new project → Import an existing project → GitHub**, allow access if asked, and pick
   **sharan50/Instinct-dashboard**.
3. Settings come from `netlify.toml` in this repository: build command `npm run build`, publish directory
   `dist`. Keep them. For **Branch to deploy**, choose `main`.
4. Before the first deploy, click **Add environment variables** (or after creating the project, go to
   **Project configuration → Environment variables → Add a variable**). Add `VITE_GOOGLE_CLIENT_ID` and
   `VITE_SPREADSHEET_ID`, plus `VITE_GOOGLE_ACCOUNT_HINT` if you want it. They are not secrets, so you can leave
   "Contains secret values" unticked.
5. Click **Deploy**. When it finishes, note the address, for example `https://random-name-123.netlify.app`. To
   pick a nicer name, go to **Project configuration → General → Project details → Change project name**.
6. In Google Cloud, open **Google Auth Platform → Clients**, open your client, and under **Authorized JavaScript
   origins** add the exact Netlify address with no trailing slash. Click **Save**.
7. Open the Netlify address on your phone and click **Connect Google account**.

Notes:

- The settings are built into the site, so after changing an environment variable, go to **Deploys → Trigger
  deploy → Deploy project** (older label: "Deploy site").
- `netlify.toml` also sends security headers: a strict Content-Security-Policy that only allows Google's
  sign-in library and the two Google APIs used, a ban on embedding the site in other pages, and an instruction
  to keep the site out of search engines.
- Netlify's preview builds for pull requests get different addresses that aren't in the OAuth client, so Google
  sign-in deliberately won't work there.

### 4. Deploy to GitHub Pages (alternative)

Use this only if you'd rather not use Netlify. This repository is public, and a GitHub Pages site from it is
public too. That is fine, because the site shows no tasks without your Google sign-in. GitHub Pages can't send
custom headers, so the security policy comes from a tag inside the page instead, and it can't block framing.

1. On GitHub, open the repository's **Settings → Pages**, and under **Build and deployment → Source** choose
   **GitHub Actions**.
2. Open **Settings → Secrets and variables → Actions**, choose the **Variables** tab, and use **New repository
   variable** to add `VITE_GOOGLE_CLIENT_ID` and `VITE_SPREADSHEET_ID` (and optionally `VITE_GOOGLE_ACCOUNT_HINT`).
   Use *variables*, not *secrets*: these values end up in the public site anyway.
3. Open **Actions → Deploy to GitHub Pages → Run workflow** and choose `main`. The workflow
   (`.github/workflows/deploy-pages.yml`) never runs by itself. It builds with Vite's base path set to
   `/Instinct-dashboard/`, because a project site lives under the repository name.
4. The site is at `https://sharan50.github.io/Instinct-dashboard/`. Add the origin `https://sharan50.github.io`
   (origin only, without `/Instinct-dashboard/`) under **Authorized JavaScript origins** in Google Cloud.

For a manual build, run `BASE_PATH=/Instinct-dashboard/ npm run build` and publish `dist/`.

## Everyday use

- **Connect:** click **Connect Google account**, choose your account in Google's window and allow access. If
  nothing appears, allow pop-ups for the site.
- **Filter:** tick or untick the status chips; **Reset filters** brings back the default (active tasks).
- **Views:** choose **All tasks**, **By date**, **You requested** or **Inbound** at the top of the list.
- **Order:** **Sort by** switches between **Financial priority** and **Recorded date**. The choice lasts until you
  reload the page, because nothing is saved on the device. **How Financial priority works**, under the control,
  spells out the rules and says which of its columns the sheet doesn't have yet.
- **Long text:** **Show full text** opens a task's long Progress or Money at stake text; **Show notes** opens its
  notes.
- **Ongoing work:** start a task's Notes with `Ongoing:` (for example "Ongoing: daily reminder at 09:00") and it
  gets an "Ongoing" label and its own group. The dashboard never makes up a date for it.
- **Refresh:** press **Refresh** after changing the sheet, or wait up to 5 minutes.

## Updating tasks

The sheet is the source of truth. The dashboard only reads it. To change a task, edit the **Tasks** tab in
Google Sheets (or let Instinct update it). The change shows in the dashboard after the next refresh. Keep to
these rules so every row reads correctly:

- Row 1 holds these headers, in any order: `Task ID`, `Task`, `Status`, `Deadline`, `Last update`, `Notes`.
  These six are required.
- **Task ID** is unique per row, for example `T034`. Never reuse an ID.
- **Status** is one of: `open`, `waiting on you`, `waiting on someone else`, `done`.
- **Deadline** is `YYYY-MM-DD` (for example `2026-10-29`) or blank. The dashboard treats it as a *recorded date*:
  it may be a planning or check date, so on its own it is never shown as due or overdue. It only counts as a
  checked date when `Date verified` says `verified` (see below). Blank means "no date recorded".
- **Last update** is an ISO 8601 timestamp with a timezone offset, for example `2026-10-21T09:00:00+05:30`.
- Don't rename the **Tasks** tab. The dashboard reads columns A to Z and rows 1 to 1000 of it; rows below row 1000
  are not read (the dashboard warns if row 1000 is used).
- Don't put passwords, ID documents, card details or bank account numbers in the sheet.

**Optional columns.** Each one is found by its header name, so it can sit in any column from A to Z, and any of
them can be left out or left blank. The header must be spelled as shown; letter case and extra spaces don't matter.

| Header | What to write | What the dashboard does with it |
| --- | --- | --- |
| `Links` | One or more `Label: https://…` entries separated by `;`, for example `Comparison: https://… ; Earlier draft (superseded): https://…` | Each one shows as a button on the task. |
| `Origin` | `you requested` or `inbound` | Puts the task in the **You requested** or **Inbound** view. A blank cell or any other value keeps the task in All tasks and By date and counts it under **Origin missing**; any other value is also listed as a problem. |
| `Money at stake` | Free text | Shown as written. Never read for amounts or dates, and never changes the order. |
| `Progress` | Free text | Shown as written. |
| `Hands-on effort` | Free text: the work you have to do yourself, without waiting time | Shown as written. |
| `Delay-cost basis` | `avoidable charge`, `deadline`, `opportunity`, `sunk or reference` or `unknown`. Blank means `unknown`. | Shown as a badge next to Money at stake, and decides the tier in Financial priority. Anything else is ranked as unknown and listed as a problem. |
| `Expected finish incl. waits` | Free text: when the task should be finished, waiting included | Shown as written, with a note that it includes waiting on others. When the status is `waiting on someone else`, the note says so. A blank cell reads "Not recorded"; no date is guessed. |
| `Date verified` | `verified`, `planning` or `unknown`. Blank means `unknown`. | Shown as a badge next to the recorded date. Only `verified` lets the date move a task up in Financial priority. Anything else is treated as not verified and listed as a problem. |

For the fixed values, letter case and extra spaces don't matter (`Inbound`, `AVOIDABLE CHARGE`), but the words do:
`inbound email` or `yes` are not accepted. In the free-text columns, web addresses starting with `https://` become
links, as in Notes. The bottom of the dashboard lists which optional columns it found in the sheet, which is the
quickest way to spot a mistyped header.

## How Financial priority works

Financial priority is the default order of the list. It uses only structured cells: `Delay-cost basis`, the date in
`Deadline`, `Date verified`, `Status` (done or not) and the row's position in the sheet.

1. **Basis first.** `avoidable charge` and `deadline` come first, then `opportunity`, then `unknown` or blank, then
   `sunk or reference`.
2. **Then the date, inside each of those groups.** Verified dates first, earliest first (so dates that have passed
   lead). Then planning or unknown dates, earliest first. Then tasks with no date, in sheet order. A planning or
   unknown date never outranks a verified one, however early it is.
3. **One fixed rule.** An `opportunity` task whose **verified** date is today or within the next 7 days goes above
   `avoidable charge` and `deadline` tasks that have no verified date. So a basis without a checked date never
   buries a checked date that is close. Once that date has passed, the task drops back to its place among the
   opportunity tasks: a date in the past never moves a task across tiers, so nothing stays urgent forever.
4. **Done tasks**, when you tick Done, come last.

Each task says why it sits where it does, for example:

- "Avoidable charge, recorded date in 3 days (not verified)"
- "Avoidable charge, no date recorded"
- "Opportunity, recorded date in 2 days (verified). Moved up by the fixed 7-day rule: its verified date is within
  7 days."
- "Opportunity, recorded date 3 days ago (verified). The date has passed; the dashboard does not know whether a
  consequence applies now."

**This is a fixed rule, not a ranking by size.** The dashboard cannot compare amounts, currencies or the real cost
of an opportunity. The order reflects only three things: the basis label, the recorded date, and whether that date
is verified. The 7-day window is an arbitrary fixed threshold: day 7 moves a task up and day 8 does not, whatever is
at stake. A small opportunity with a verified date next week goes above a large avoidable charge that has no
verified date, because the dashboard has no way to weigh them. Read the order as a sorted list of the sheet's own
labels, and use your own judgement for what matters most.

What it never does:

- It never reads an amount or a date out of Money at stake, Progress or any other text, and a filled-in Money at
  stake cell does not move a task up.
- It never guesses a date. A task without one says "no date recorded".
- It never treats the basis or a date as proof. They are what the sheet says, and the dashboard can't check that a
  charge is real or that a date is enforced. Neither a date nor a Money at stake entry is shown as a verified loss.
- It never treats a date that has passed as a missed one. A passed date, verified or not, is shown as a date in
  the past, in the same amber as other notes and never as an alarm. For a verified one the task says the date has
  passed and that the dashboard does not know whether a consequence applies now.

**Urgency needs the `Date verified` column.** The Deadline column holds recorded dates that may be planning or
check dates, so a date alone never makes a task urgent here. Until the sheet has a `Date verified` column with
`verified` on the dates that were checked against their source, no date counts as verified: tasks are still
ordered by basis and then by recorded date, but nothing is moved up, and the count of past dates at the top of the
page says "none verified". Filling that column in is a job for the sheet (you or Instinct), not the dashboard.
Even then, the only urgency the dashboard shows is the fixed rule above, for a verified date from today to 7 days
ahead.

While the sheet has none of these columns, Financial priority gives the same order as Recorded date for the
tasks that aren't done.

## Privacy and its limits

What the dashboard does:

- It reads only the Tasks tab, with read-only permission, directly between your browser and Google.
- It keeps tasks and the token in memory only: no cookies, local storage, offline caches or service worker. On
  Netlify the page is also sent with a "don't store" instruction, and Google's responses are fetched with
  caching turned off.
- It uses no analytics or tracking, and loads nothing from anywhere except Google's sign-in library and Google's
  APIs.
- Signing out clears everything from the page immediately.

What it can't protect against:

- **Shared or borrowed devices.** While the tab is open and connected, anyone using the device can read your
  tasks. Sign out when you're done, and on a shared computer also sign out of Google itself: otherwise someone
  else could click Connect while your Google account is still signed in to the browser.
- **Browser extensions** with permission to read pages can read the dashboard like any other page.
- **Screenshots and screen sharing** capture whatever is on screen.
- **Google sign-in itself:** anyone who controls your Google account can read your sheet anyway. Use 2-Step
  Verification.
- **The site code is public** (this repository and the deployed files), including the client ID, the
  spreadsheet ID and the optional email hint. None of them grants access to the sheet, but don't add anything
  secret to the code.

## Reconnect, sign out and revoke access

- **Reconnect:** when the top bar says *Google sign-in expired*, press **Reconnect**. Your tasks stay on screen
  (marked as possibly out of date) until the new sign-in finishes.
- **Use a different account:** if you signed in with the wrong Google account, the dashboard says so and offers
  **Use a different Google account**.
- **Sign out:** the **Sign out** button clears the tasks and the token from the page.
- **Revoke (remove) access completely:** use **Remove this dashboard's access to your Google account** at the
  bottom of the dashboard. Or open <https://myaccount.google.com/connections> (**Google Account → Security → Your
  connections to third-party apps & services**), choose **Instinct Dashboard**, and delete the connection. The next
  time you connect, Google asks for permission again.

## Stopping a deployment

- **Netlify, take the site offline:** go to **Project configuration → General → Danger zone → Delete project**.
  The address stops working.
- **Netlify, keep the site but stop new deploys:** go to **Deploys** and choose **Stop auto publishing**.
- **GitHub Pages:** on **Settings → Pages**, next to "Your site is live at …", open the **…** menu and choose
  **Unpublish site**.
- **Stop Google sign-in everywhere at once:** in Google Cloud, delete the OAuth client (**Google Auth Platform →
  Clients**). No copy of the dashboard, wherever it is hosted, can sign in after that.

## If a key or secret is exposed

- **OAuth client ID:** not a secret. It is meant to be public, so there is nothing to do.
- **OAuth client secret** (starts with `GOCSPX-`; this app never needs it): in **Google Auth Platform → Clients →
  your client**, add a new secret, then disable and delete the old one. Or delete the client and create a new one,
  then update `VITE_GOOGLE_CLIENT_ID` locally and on Netlify and redeploy.
- **Anything committed to Git:** deleting it in a new commit doesn't remove it from the history of a public
  repository. Treat it as exposed and replace it as above.
- **An access token** (for example, visible in a screenshot of the browser's developer tools): remove the app's
  access as described in [Reconnect, sign out and revoke access](#reconnect-sign-out-and-revoke-access). Tokens
  also stop working on their own after a short time.
- **A service-account key or API key** (this app uses neither): in Google Cloud, disable and delete the key
  (**IAM & Admin → Service accounts → Keys**, or **APIs & Services → Credentials**), then create a new one only if
  something really needs it.

## Troubleshooting

| You see | What to do |
| --- | --- |
| "Finish setting up your dashboard" | The site was built without its settings. Add them, then restart `npm run dev` or redeploy. |
| Google says `origin_mismatch` or `redirect_uri_mismatch` | Add the site's exact origin under **Authorized JavaScript origins** (step 1.8), wait a few minutes, then try again. |
| Google says "Access blocked: … has not completed the Google verification process" | The account isn't a test user. Add it in **Google Auth Platform → Audience → Test users**. |
| "This Google account can't open the tracker" | You chose an account the sheet isn't shared with. Use **Use a different Google account**. |
| "The Google Sheets API is turned off" | Do step 1.3 in the same project as the OAuth client. |
| "The Google sign-in window was blocked" | Allow pop-ups for the site in your browser settings. |
| "The Tasks tab's header row doesn't match" | Fix row 1 of the Tasks tab (see [Updating tasks](#updating-tasks)), then press **Try again**. |
| Amber "Tasks may be out of date" | Press **Refresh** (or **Reconnect** if the sign-in expired). |
| A new column's information doesn't appear | Check its header in row 1 against the table in [Updating tasks](#updating-tasks). The bottom of the dashboard lists the optional columns it found. |
| **You requested** and **Inbound** are empty | The sheet has no `Origin` column, or its cells hold something other than `you requested` or `inbound`. |
| A date you know is real doesn't move its task up | Write `verified` in that row's `Date verified` cell: a verified date then leads its own tier. Only an `opportunity` task is ever moved above another tier, and only while its verified date is from today to 7 days ahead. See [How Financial priority works](#how-financial-priority-works). |

## Other ways to connect (not used)

The dashboard uses private browser sign-in on purpose. For completeness:

- **A Netlify Function with a Google service account** would mean a small server that reads the sheet for you.
  You would share only this sheet with the service account's email address as **Viewer**. Read-only access then
  comes from that Viewer share and the `spreadsheets.readonly` scope, not from a special kind of account. The
  private key would live only in Netlify's server-side environment variables, never in a `VITE_` variable or the
  site code. The function would also still need real sign-in and a server-side check that the caller is you,
  otherwise anyone who found its address could read your tasks. A hard-to-guess address or CORS is not security.
  GitHub Pages can't run such a function. It adds a key to protect and isn't needed here.
- **An API key or "Publish to web"** only works for public data. This tracker holds health, finance and personal
  details, so it **must not** be published. If you ever want a public view, it would need a separate sheet with
  only the information you approve for public view, published on its own. That isn't something to set up casually.

## For developers

- Stack: TypeScript, React 19, Vite, Vitest + Testing Library, Playwright + axe-core. No runtime dependencies
  besides React.
- `src/lib/sheetsApi.ts`: the single read-only request
  (`GET …/values/Tasks!A1%3AZ1000?valueRenderOption=FORMATTED_VALUE` with a Bearer token, no cookies, no HTTP
  cache), error mapping, and retries with exponential backoff and jitter.
- `src/lib/tasks.ts`: maps required and optional columns by header name, pads missing trailing cells, skips blank
  rows, and reports missing or duplicate headers, unknown statuses, bad dates, duplicate IDs and Origin,
  Delay-cost basis or Date verified values outside the allowed ones.
- `src/lib/priority.ts`: Financial priority (the tiers, the verified-date rules, the fixed 7-day window and the
  "why this order" text). It takes structured cells only and never parses free text.
- `src/lib/filters.ts`: status filters, search, the origin views and the date groups. `src/lib/preview.ts` folds
  long free text.
- `src/lib/dates.ts`: date-only deadlines stay calendar dates; timestamps are shown in the viewer's timezone
  with a label.
- `src/lib/googleAuth.ts`, `src/hooks/useDashboard.ts`: Google Identity Services token model (token requested
  only from a click, kept in memory, cleared on sign-out), expiry, auto refresh and pausing.
- `security-headers.ts`, `netlify.toml`: Content-Security-Policy and other headers. A test keeps them in sync.
- Lint rules forbid `console`, browser storage, service workers and `dangerouslySetInnerHTML` in app code.
- Test data is invented (`src/test/fixtures.ts`, `e2e/helpers.ts`). Never copy real tracker rows, amounts, names
  or links into tests, fixtures, screenshots, issues or pull requests: this repository is public.

References: [spreadsheets.values.get](https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values/get),
[Sheets API scopes](https://developers.google.com/workspace/sheets/api/scopes),
[token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model),
[Sheets API usage limits](https://developers.google.com/workspace/sheets/api/limits),
[Netlify environment variables](https://docs.netlify.com/build/environment-variables/overview/),
[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages).
