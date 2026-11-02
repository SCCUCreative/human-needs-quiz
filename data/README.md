# Data stream: setup guide

How the Six Human Needs Quiz saves results, emails people their report, and feeds the Looker Studio dashboard.
Everything runs on the shared Google Workspace account **creative@sccu.uk.com**.

```
Quiz (scottfree.live/human-needs-quiz)
   │  visit · start · age_gate · complete · share · feedback
   ▼
Apps Script web app (data/apps-script)  ── sends ──▶  Results email from "Scott Free"
   │                                                   (private link back to the report + PDF workbook)
   ├─▶ "HNQ Contacts (private)"  Contacts · Report names · Quarantine · Erasure log   ← never on the dashboard
   └─▶ "HNQ Results"             Assessments · Events                     ← Looker Studio reads this only
```

Nothing is sent until the web app address is pasted into the quiz (step 5). Until then the quiz works exactly as before.

## What is stored

| Where | What | Personal? |
|---|---|---|
| Contacts (private) | participant ID, first name, email, age, first/last seen, number of attempts, opt-in/account fields (empty until those features are switched on). The name and age are from their first attempt and are never overwritten by a later one, because anyone can type anyone's email. | Yes |
| Report names (private) | the first name given on each attempt, shown on that attempt's report | Yes (first name only) |
| Quarantine (private) | rejected submissions for spotting abuse, with no names or emails (a short hash instead); nothing at all about under-18s; cleared after 30 days | No |
| Assessments | assessment ID, participant ID, date, quiz/scoring versions, archetype, primary/secondary need, confidence, fulfilment state, % and raw score for all six needs, fulfilment score for all six, age range (18–24 … 65+), source/medium/campaign, device, time taken, returning or not, attempt number, email status, accuracy feedback, report views | No (pseudonymous ID only) |
| Events | one row per visit, start, under-18 stop, completion, share and feedback, with source and device | No |

The 36 individual answers are **not** stored. Exact age stays in Contacts; the dashboard only sees the age range.

**Participant and assessment IDs.** Each email address gets one participant ID (`P-…`) that stays the same every time they return; each attempt gets its own assessment ID. Both are ready to be linked to NUBU accounts later.

**Revisit link.** The email carries `scottfree.live/human-needs-quiz/?r=<token>`. The token is random (about 190 bits) and only its hash is stored, so even someone with access to the spreadsheets can't rebuild a link. The link doesn't expire. `…&print=1` opens the report and the save-as-PDF dialog (the "workbook"). Once the report opens, the token is taken out of the address bar, so copying the page address doesn't share it.

## One-time setup

### 1. Create the script (signed in as creative@sccu.uk.com)
1. Go to [script.google.com](https://script.google.com) → **New project**. Name it `HNQ Collector`.
2. Delete the sample code. Create three script files and paste in the contents of:
   `data/apps-script/Code.gs`, `data/apps-script/Email.gs`, `data/apps-script/ArchetypeData.gs`
   (use **+ → Script** and name them `Code`, `Email`, `ArchetypeData`).
3. **Project Settings** (cog) → tick **Show "appsscript.json" manifest file**. Open it and replace its contents with `data/apps-script/appsscript.json`.

### 2. Run setup
1. Select `setup` in the function menu and click **Run**. Approve the permissions (spreadsheets, send email as you, run on a schedule).
2. Open **Executions** (or the log): it prints the links to the two new spreadsheets in creative@'s Drive.
   It also adds a daily 3am clean-up of old contacts.

### 3. Lock down the spreadsheets
- **HNQ Contacts (private):** share with nobody beyond the people who must handle data requests.
- **HNQ Results:** share **view-only** with the people who build the dashboard.

### 4. Deploy the web app
1. **Deploy → New deployment → Web app.**
   Execute as: **Me (creative@sccu.uk.com)** · Who has access: **Anyone**.
2. Copy the **Web app URL** (ends in `/exec`).
3. Test it: open the URL in a browser. You should see `{"ok":true,"service":"hnq-collector"}`.

> **Workspace admin check.** Some Google Workspace setups don't allow "Anyone" (people outside the organisation) to use web apps. If "Anyone" is missing from the menu, ask the Workspace admin to allow it for this account (Admin console → Apps → Google Workspace → Drive and Docs / Apps Script sharing settings).

### 5. Switch the quiz on
In `index.html`'s settings block (`HNQ_CONFIG` in quiz-data.js, edited via `tools/bundle.py`), set
`dataEndpoint: '<the /exec URL>'`, repack, and merge. Ask Claude to do this as a small pull request.

### 6. Check it end to end
Take the quiz on your phone with your own email address. You should get the "Your results are on their way" note, the email from **Scott Free** within a minute, a row in Assessments and Events, and your details in Contacts. Open the link in the email on another device; your results should load.

## Settings (top of Code.gs)

| Setting | Now | Notes |
|---|---|---|
| `SENDER_NAME` | `Scott Free` | Display name on the email. It is sent from creative@sccu.uk.com. |
| `REPLY_TO` | blank | Set a Scott Free inbox if replies shouldn't go to creative@. |
| `RETENTION_MONTHS` | `12` | **Placeholder, not yet agreed.** Contacts not seen for this long are deleted daily. `0` = never. Results stay (anonymous). |
| `MIN_COMPLETE_SECONDS` | `30` | Timed by the collector from the "start" it saw. Faster than this: results saved, no email. |
| `MAX_EMAILS_PER_ADDRESS_PER_HOUR` | `3` | Per inbox, ignoring `+tags` and Gmail dots, so the form can't flood someone's inbox. |
| `MAX_EMAILS_PER_DAY` | `800` | Whole-site cap, safely under Google's ~1,500 a day. |
| `MAX_QUIZ_WRITES_PER_MINUTE` / `_PER_HOUR` | `600` / `20000` | Caps on quiz starts and completions, kept separate so junk traffic can't block real people. |
| `MAX_WRITES_PER_MINUTE` / `_PER_HOUR` | `300` / `6000` | Caps on everything else (visits, shares, feedback), so the spreadsheets can't be flooded. |
| `MAX_REPORT_READS_PER_MINUTE` | `300` | Revisit-link opens across the whole site. |
| `QUARANTINE_DAYS` | `30` | Rejected submissions are cleared after this. |
| `QUIZ_VERSIONS` / `SCORING_VERSIONS` | `1.0.0` | Add the new number here when `quizVersion`/`scoringVersion` change in the quiz. |
| `FEATURES` | both `false` | Stay connected and accounts (see below). |

After changing a setting: **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy.** The `/exec` URL stays the same.

Google Workspace accounts can send about 1,500 emails a day through Apps Script.

**Why someone might not get an email** (shown in Assessments → `email_status`): `sent`, `failed` (Google refused), `no_start` (the collector never saw the quiz start, e.g. a dropped connection), `too_fast`, `address_limit`, `daily_limit`. Their results are saved and shown on screen in every case.

**Further hardening (optional, later):** a Cloudflare Turnstile check on the details page would stop automated sign-ups almost entirely. It needs a free Cloudflare account; the collector would check the token with `UrlFetchApp`.

## Later: stay connected and accounts

Both are built and tested but switched off until the new site is ready.
To switch on: set `FEATURES.stayConnected` / `FEATURES.accounts` to `true` in **Code.gs** (redeploy) **and** in the quiz's `HNQ_CONFIG.features`.

- **Stay connected:** an unticked checkbox at the end of the report. The choice, time and wording version (`OPT_IN_TEXT_VERSION`) are saved in Contacts; contacts who opt in are kept past the retention period. The email then mentions it, and its footer changes to match.
- **Create your account:** a "Coming soon" card ("Let me know when it's ready"), recorded in Contacts as `account_interest`.

Both only work for someone holding their own private report link, so nobody can sign up someone else.

## Data requests

- **Delete someone's data:** in the script editor, run `eraseByEmail('their@email.com')` (edit the call in a scratch function, or use the run dialog). Their contact row and report names are deleted, their results are unlinked (`participant_id` becomes `erased`) and their report links stop working. It's logged in **Erasure log**.
- **Show someone their data:** search Contacts for their email; their results are the Assessments rows with the same participant ID.

## Looker Studio dashboard

Data source: **HNQ Results** only (Assessments and Events as two sources). Never add HNQ Contacts.

| Page | Question | Charts (source → fields) |
|---|---|---|
| **Completion** | Are people completing the quiz? | Scorecards: visits, starts, completions (Events → count where `event` = visit / start / complete); completion rate = completions ÷ starts (calculated field). Time series by `date`. Median `duration_sec` (Assessments). Under-18 stops (Events, `age_gate`). |
| **Audience** | Who is taking it? | `age_range` bar; `device` donut; `source`/`medium`/`campaign` table (QR traffic shows as `qr`); returning vs new (`returning`). |
| **Results** | What drives people? | Archetype bar (`archetype`); primary and secondary need bars; average % per need (`pct_*`); confidence and fulfilment state; archetype × age range table. |
| **Resonance** | Do people recognise themselves? | `accuracy` distribution (Not at all → Extremely); average `accuracy_score` (1–5); % answering Very/Extremely; feedback rate = feedback ÷ completions; by archetype. |
| **Sharing** | Are people recommending it? | Events where `event` = share, by `detail` (platform) and `value` (card or story); shares ÷ completions; report revisits (`report_views`). |
| **Connection** | Do people want to stay connected? | Ready for later: opt-ins and account interest, from Events `opt_in` / `account_interest` (empty until switched on). |

Filters for every page: date range, `quiz_version`, `source`.
Sharing: share the report with stakeholders (viewer access), then **Schedule delivery** (Share menu) to email it weekly or monthly as a PDF.

## Tests

```
node data/tests/collector.test.js        # runs the real Code.gs against in-memory Google services
HNQ_MIN_SECONDS=0 node data/tests/dev-server.js 8771   # local stand-in for the web app (point dataEndpoint at http://localhost:8771/exec)
```
After editing the archetype copy, run `python3 tools/build_email_data.py` to refresh `ArchetypeData.gs`, then paste it into the script again.
