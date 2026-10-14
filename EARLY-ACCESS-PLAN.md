# Early Access: waitlist, live leaderboard and access codes

Before SaphraONE opens to everyone, new people join a **waitlist** instead of
the app. Each person on the list gets a referral link, climbs a **live
leaderboard** by inviting others, and is let in by **waves** from the top of
the queue. Anyone on the list can skip the queue right away with an **access
code**, either one we hand out or the invite code of someone already on the
live platform.

Same model as defi.com's early access (email → "Your interest has been
received" → referral code + share buttons), plus a leaderboard and a code box.

## Decisions (owner, 2026-10-14)

- Admin access codes are **one capitalised word**, limited by **time** or by
  **number of people** (or both); each person can use **one code, ever**.
- Each live user can let in **10 people**.
- **10 counted invites admits you automatically.**
- **No prizes**: the only reward on the leaderboard is earlier access (keeps
  it out of promotion/sweepstakes rules).
- Waves start at **200 people a day**, raised as support and Circle wallet
  capacity allow.
- Join asks for **email** and **country** (required), **nickname** (optional)
  and the consent box. No phone number.
- **Following our socials earns points**: every official SaphraONE account
  (X, LinkedIn, Telegram, Instagram, TikTok, YouTube; the list is set in
  admin) is a one-time task.

Behind one switch: `early_access_settings.mode` = `open` (today's behaviour)
or `waitlist`. Flipping it back to `open` lets everyone in without a deploy.

---

## 1. How it works for a visitor

```
Landing (/?ref=CODE)            ──►  "Get early access" form (/early-access)
  email, nickname, country,          Turnstile check, consent box
  referral code (pre-filled)                 │
                                             ▼
                              "Your interest has been received."
                              • check your email to confirm
                              • your referral code + link, copy, share on X /
                                LinkedIn / WhatsApp / Telegram
                              • your place in the queue
                              • "Have an access code?" box
                                             │ clicks link in email
                                             ▼
                              Status page (/early-access/status)
                              • position #1,284 of 18,930 · 3 invites counted
                              • live leaderboard (top 100 + you)
                              • referral link + share
                              • access-code box
                                             │
          ┌──────────────────────────────────┼─────────────────────────────┐
          ▼                                  ▼                             ▼
  enters an access code             invited in a wave              reaches the auto-
  (ours, or a live user's)          (top N of the queue)           admit threshold
          └──────────────────────────────────┴─────────────────────────────┘
                                             ▼
                              "You're in" email → Sign in (/sign-in)
                              → onboarding → dashboard (live platform)
```

### Who counts as "live"
- Everyone with a SaphraONE profile today: **grandfathered** (backfilled
  grants, nothing changes for them).
- Anyone admitted from the waitlist after sign-in.

### What a person who is not yet admitted sees
- The landing page and public pages (`/p`, `/c`, `/u`, Checkout pay pages,
  invoices) keep working: paying someone or a merchant never needs an account.
- Signing in without access lands on `/early-access/status` ("You're on the
  list, position #…") instead of the dashboard.
- Every protected API answers `403 { reason: "early-access" }`.

---

## 2. The two kinds of code

Two different things are called "code"; keep them apart in UI copy:

| | **Referral code** | **Access code** |
|---|---|---|
| Looks like | `bB12SqQLvF` (10 chars, base62) | `SAPHRALAGOS` (ours, one capitalised word) or a live user's invite code |
| Who has it | every waitlist entry | us (admin), and every live user |
| Used where | in the share link `/?ref=…` | the "Have an access code?" box |
| Effect | the inviter climbs the leaderboard | the person who enters it **skips the queue now** |

### Access codes from us (admin codes)
- **One capitalised word** the admin chooses: `SAPHRALAGOS`, `ARCSUMMIT`,
  `EARLYBIRD`. 4–20 letters/digits, stored and shown in uppercase, unique.
  Typing ignores case (`saphralagos` works).
- **Limited by time or by number of people**, set when the code is created:

  | Limit | Example | Ends when |
  |---|---|---|
  | Time | live 48 h from Friday 18:00 | `expires_at` passes |
  | People | first 200 people | the 200th person uses it |
  | Both | 200 people within 7 days | whichever comes first |

- Created in `/admin/early-access` with a label ("Lagos meetup",
  "Partner X"); can be paused or ended early at any time. The list shows
  status, uses so far, time left and who used it.
- Stored as plain uppercase text (a public word is not a secret, and the admin
  needs to see and share it).

### Few codes per person
- **Each person can use one access code, ever**: one of ours *or* one live
  user's invite. A second try answers "You've already used an access code."
- The same person can't use the same code twice.

### Guessing protection
Words are easier to guess than random strings, so code tries are tight:
5 tries / hour per entry, 10 / day per IP, one generic "That code isn't
valid" answer, the code box locks for 24 h after 10 failures, and failed tries
are logged so the admin can spot someone running through a dictionary.

### Invite codes of live users
- A live user's existing invite code (their `referral_profiles.referral_token`,
  or their username, which the sign-in screen's referral field already accepts)
  works in the access-code box.
- **Each live user can let in at most `live_invite_cap` people** (**10**,
  set in admin, per-user overrides for creators/partners). Without a cap, one
  code posted publicly opens the whole platform.
- The user sees "7 of 10 invites left" on `/referral`.
- The person let in is also attached as that user's referral, so **Invite &
  Earn commissions** (REWARDS-PLAN.md §3) start from day one.
- A referral link `/?ref=<live user's code>` pre-fills the access-code box and
  redeems automatically on sign-up while invites remain; when none remain the
  visitor simply joins the queue (still credited to that referrer).

### Redemption rules
- Atomic in Postgres (`redeem_access_code()`): the use counter only goes up if
  the code is live, inside its dates and `uses < max_uses`, so two people
  can't take the last seat at once.
- One generic error for wrong / expired / used-up codes (no code probing).
- Requires a **confirmed** email (unconfirmed entries are asked to confirm first).

---

## 3. Leaderboard and queue

### Score
| Event | Points |
|---|---|
| A person you invited confirms their email | **+100** |
| That person later goes live and makes their first payment | **+50** bonus |
| Follow each official SaphraONE social account (one time each) | **+10** per account |

### Social tasks
- A "Follow us" card on the status page lists every account from
  `early_access_social_tasks` (X, LinkedIn, Telegram, Instagram, TikTok,
  YouTube to start; admin adds, removes or reorders without a deploy).
- Tapping **Follow** opens the account in a new tab and records the task;
  the points land when the person comes back to the page (at least 10 s
  later), once per account.
- Follows can't be checked without each platform's paid API, so they are
  taken on trust and kept small: following everything (6 × 10 = 60) is worth
  less than one invite (100). Invites still carry the board.
- Telegram can be checked properly later with a bot (`/start <code>` in the
  SaphraONE bot confirms the person joined the group); X and the others stay
  on trust.
- Points from tasks never count toward the 10-invite auto-admit.

### Order
`score desc, joined_at asc`: among equal scores, earlier sign-ups are ahead.
Your **queue position** is your rank among entries still `waiting`.

### "Live"
- `GET /api/early-access/leaderboard` returns the top 100 + the caller's own
  row, cached for 15 s (one query serves everyone).
- The status page polls every 15 s and animates moves ("▲ 12 places").
  Polling keeps it simple and cheap; Supabase Realtime can replace it later.
- Rank of one entry is one indexed count:
  `count(*) where status = 'waiting' and (score > s or (score = s and joined_at < t))`
  on an index `(status, score desc, joined_at)`. Fine to millions of rows.

### What the board shows
Nickname (or "Anon #4821" if none / hidden), country flag, invites counted,
score. **Never** an email. Entries can hide themselves from the board and
still keep their place.

### Auto-admit at 10 invites
Reaching **10 counted invites** admits you immediately (held referrals
don't count until released). Gives the top of the
board a concrete goal ("7 / 10 invites to skip the line") and rewards the
people driving growth. The number can be changed in admin.

### No prizes
The board ranks people for earlier access only: no cash, points, tokens or
goods. That keeps it out of promotion / sweepstakes rules in most countries.
Copy on the page says so ("Climb the board to get in sooner").

---

## 4. Admission

| Route in | How | `admitted_via` |
|---|---|---|
| Wave | Admin admits the top N waiting (or a selection) | `wave` |
| Our access code | Entered in the code box | `access_code` |
| Live user's invite | Entered in the code box / came via their link | `live_invite` |
| Threshold | Reached N counted invites | `threshold` |
| Manual | Admin admits one entry (support, partners) | `admin` |

On admission:
1. Entry → `admitted`, an `early_access_grants` row is written for the
   (normalized) email.
2. "You're in" email with a sign-in link (`/sign-in?ea=<signed token>`).
3. On first sign-in the grant is **linked to the wallet** (see §6) and the
   session carries `earlyAccess: true`.
4. If the entry had a referrer who is live, `attachReferral()` connects them
   (Invite & Earn). Waitlist-only referrers keep their leaderboard credit.

Waves: **200 people a day** to start (one daily wave), grow as support and Circle
wallet capacity allow. Unused invites expire after 14 days and the seat goes
back to the queue (entry keeps its position, gets a reminder email first).

---

## 5. Data model (`packages/database/supabase/early-access.sql`)

```sql
early_access_settings (single row)
  mode text check (mode in ('open','waitlist'))      -- the switch
  live_invite_cap int default 10
  points_per_referral int default 100
  first_payment_bonus int default 50
  auto_admit_referrals int default 10
  social_task_points int default 10
  wave_size int default 200
  invite_expiry_days int default 14
  leaderboard_size int default 100
  updated_at, updated_by

waitlist_entries
  id uuid pk
  email text, email_normalized text unique             -- lowercased; gmail dots/+tags stripped
  email_verified_at timestamptz
  nickname text, show_on_leaderboard bool default true, country text
  referral_code text unique                           -- 10-char base62
  referred_by_entry_id uuid null → waitlist_entries
  referred_by_wallet text null → profiles             -- inviter was already live
  score int default 0, counted_referrals int default 0
  status text check ('unverified','waiting','invited','admitted','blocked')
  admitted_via text null, admitted_at, invited_at, invite_expires_at
  wallet_address text null unique → profiles          -- set when the grant is claimed
  source jsonb (utm_*, landing path), ip_hash, device_hash, user_agent
  joined_at, updated_at
  index (status, score desc, joined_at)

early_access_social_tasks
  id, platform ('x','linkedin','telegram','instagram','tiktok','youtube',...)
  label, url, sort_order, active bool

waitlist_social_completions
  entry_id, task_id, opened_at, completed_at, points
  unique (entry_id, task_id)

waitlist_referrals
  referrer_entry_id, referred_entry_id unique
  status ('pending','counted','held','void'), points, counted_at, reason

access_codes
  id, code text                                       -- uppercase word, unique index on upper(code)
  label, max_uses int null, uses int default 0        -- null max_uses = time-limited only
  starts_at, expires_at null                          -- null expires_at = people-limited only
  status ('live','paused','ended'), created_by, created_at
  check (max_uses is not null or expires_at is not null)

access_code_redemptions
  entry_id unique                                     -- one code per person, ever
  code_id null, live_inviter_wallet null, redeemed_at
  check (exactly one of code_id / live_inviter_wallet)

access_code_attempts                                  -- failed tries, for lockout + admin view
  entry_id, ip_hash, typed text, created_at

live_invite_allowances
  wallet_address pk, cap_override int null, used int default 0

early_access_grants
  email_normalized unique, wallet_address null unique, granted_via, granted_at

early_access_audit_logs
  actor ('system','admin','user'), action, entry_id, details jsonb, created_at
```

- RLS on, no anon access; every read/write goes through the API with the
  service role (same as the referral tables).
- Postgres functions: `redeem_access_code(entry, code)`,
  `redeem_live_invite(entry, wallet)`, `count_waitlist_referral(referred)`,
  `waitlist_rank(entry)`, `admit_waitlist_wave(n, actor)`; each one transaction.
- **Backfill:** one `early_access_grants` row per existing `profiles` row, so
  every current user stays live.

---

## 6. Access enforcement (server-side, not the cookie)

Today `proxy.ts` lets a protected page through when the
`saphra_platform_access=1` cookie is present. That cookie is written by the
browser, so anyone can set it; it's fine for routing but **can't gate access**.

1. **Session claim.** Add `earlyAccess?: boolean` to `WalletTokenPayload`
   (`lib/wallet-session.ts`). The sign-in routes (`/api/auth/email`,
   `/api/auth/circle`, `/api/auth/wallet`) set it when the wallet has a grant
   (or the mode is `open`). The signature makes it tamper-proof.
2. **API gate.** In `proxy.ts`, next to the 2FA and app-lock checks: with mode
   `waitlist`, a session without `earlyAccess` gets
   `403 { reason: "early-access" }` from every API except an allowlist
   (`/api/auth/`, `/api/early-access/`, `/api/profile` GET, public Checkout,
   `/api/support/*`, webhooks, cron).
3. **Page gate.** Protected pages redirect a signed-in, not-admitted session to
   `/early-access/status`.
4. **Mode cache.** The proxy reads the mode from an env kill switch
   (`EARLY_ACCESS_MODE`) first, else the settings row cached 30 s.
5. **Admitted later.** When an entry is admitted while its owner is signed in,
   `/api/early-access/me` re-issues the session cookie with the claim, so no
   sign-out is needed.

### Linking the waitlist email to a wallet
The email a client sends at sign-in isn't proof of ownership, so grants are
linked only through a **proven email**:
- The waitlist cookie (`saphra_waitlist`, HMAC-signed with
  `SAPHRA_SESSION_SECRET`, set by the email magic link) proves the address.
  Signing in from the same browser links the grant automatically.
- Otherwise the status page shows **"Already on the list? Claim your place"**:
  enter the email → magic link → grant linked to the signed-in wallet.
- External-wallet users (no email) use the same claim step.
- A grant links to one wallet only (`unique`), and an entry to one wallet.

---

## 7. API

Public / waitlist (all rate-limited, Turnstile on `join` and `resume`):

| Endpoint | Purpose |
|---|---|
| `POST /api/early-access/join` | Create entry, send confirm email, return referral code + link |
| `POST /api/early-access/verify` | Confirm email from the link token; counts the inviter's referral; sets `saphra_waitlist` |
| `POST /api/early-access/resume` | "I'm already on the list": email → magic link (same answer whether or not it exists) |
| `GET /api/early-access/me` | Own status: position, score, invites, code, admission state |
| `PATCH /api/early-access/me` | Nickname, show on board, country |
| `GET /api/early-access/leaderboard` | Top N + own row, 15 s cache |
| `GET /api/early-access/stats` | Public counter for the landing ("Join 18,930 on the waitlist") |
| `POST /api/early-access/redeem` | Access-code box (admin code or live invite code) |
| `POST /api/early-access/claim` | Link a proven waitlist email to the signed-in wallet |
| `POST /api/early-access/tasks/:id` | Record a social follow (open, then complete on return) |
| `GET /api/early-access/invites` | Live user: invites left, who used them |

Admin (`ADMIN_SECRET`, `lib/admin-auth.ts`):

| Endpoint | Purpose |
|---|---|
| `GET /api/admin/early-access/overview` | Totals, daily joins/confirmations, sources, k-factor |
| `GET /api/admin/early-access/entries` | Search, filter by status/flag, CSV export |
| `POST /api/admin/early-access/admit` | Admit top N / selected / one |
| `POST /api/admin/early-access/entries/:id` | Block, unblock, void referral, adjust score (reason required) |
| `GET/POST/PATCH /api/admin/early-access/codes` | Create a word code (time / people / both limit), pause / end, see uses and failed tries |
| `PATCH /api/admin/early-access/settings` | Mode, invite cap, points, threshold, wave size, expiry |
| `GET/POST/PATCH /api/admin/early-access/social-tasks` | Social accounts to follow: add, remove, reorder, turn off |

Cron (`CRON_SECRET`): `GET /api/cron/early-access`, hourly: expire unused
invites, send invite reminders, send the "you moved up" digest, flag velocity
spikes.

---

## 8. Emails (Resend, `lib/email/brand-layout.ts`)

| Email | When |
|---|---|
| Confirm your email | On join (link valid 24 h; resend allowed every 2 min) |
| You're on the list | After confirming: position, code, share links |
| Your invite counted | Batched: at most one a day ("3 friends joined, you're #412 now") |
| You're in | On admission: sign-in link, invite expiry date |
| Your invite expires soon | 3 days before expiry |
| Magic link | Resume / claim |

Each non-transactional email has an unsubscribe link; transactional ones
(confirm, magic link, you're in) always send.

---

## 9. Screens

**Landing (`components/landing/landing-page.tsx`)** in waitlist mode:
- Primary CTA "Get early access" (header + hero), live counter
  "Join 18,930 on the waitlist", trust row ("No bank required · 24/7 global
  use") as in the screenshots.
- `?ref=` is read once, stored in cookie + localStorage (like
  `saphra_referral_token` today), and the referrer's nickname shown:
  "@ada invited you".
- "Sign in" stays for admitted and existing users.

**Join (`/early-access`)**: email (required), country (required, pre-selected
from the visitor's IP country), nickname (optional, shown on the board),
referral code (pre-filled, editable), Turnstile, consent ("I agree to the Terms and Privacy
notice and to receive SaphraONE updates").

**Received (after join)**: the screenshot layout: check mark, "Your interest
has been received.", "Check your email to confirm", card "Every successful
invite gets you closer!" with code, link + copy, share on X / LinkedIn /
WhatsApp / Telegram, Telegram community link, access-code box, back to home.

**Status (`/early-access/status`)**:
- Header card: position, total waiting, score, invites counted / pending,
  progress to auto-admit ("7 / 10").
- Referral card (as above) + native share sheet on mobile.
- "Follow us" card: one row per social account, +10 each, ticks once done.
- Live leaderboard: top 100, own row pinned at the bottom if outside it,
  movement arrows, your row highlighted.
- "Have an access code?" box → success state "You're in" with "Sign in now".
- Admitted: big "You're in" + Sign in button + invite expiry.

**Live app**:
- `/referral`: "Early-access invites: 7 of 10 left", share invite, list of
  people let in.
- `/admin/early-access`: overview, entries, leaderboard with fraud flags,
  waves, codes, settings, audit log (style of `/admin/rewards`).

---

## 10. Abuse prevention

Referral leaderboards attract fake sign-ups. Layers:

1. **Only confirmed emails count**, and only once per normalized email
   (`a.b+x@gmail.com` = `ab@gmail.com`).
2. **Disposable-email blocklist** at join.
3. **Cloudflare Turnstile** on join and resume.
4. **Rate limits**: joins per IP/day (e.g. 5) and per /24, confirmation
   resends, code tries.
5. **Self-referral / farm signals** → referral `held`, not counted until
   reviewed: same IP hash or device hash as the inviter, burst of confirmations
   (> 20 in an hour), many referrals from one /24, confirmation within seconds
   of join.
6. **Waves are reviewed**: the admin wave screen shows flags; held and
   flagged entries are skipped by default.
7. **Voiding** a referral or blocking an entry recalculates scores (audit
   logged).
8. **Live invite cap** keeps any one leaked code from opening the platform;
   admin codes end by time or by number of people, and each person can use
   only one code.
9. The +50 first-payment bonus only counts payments that pay a real fee
   (same rule as cashback), so it can't be farmed with self-transfers.

---

## 11. Code layout

```
apps/web/lib/early-access/
  rules.ts         pure: email normalization, code generation/format, scoring,
                   rank tie-break, redemption eligibility, flag rules
  settings.ts      settings row + 30 s cache + env kill switch
  service.ts       join, verify, resume, redeem, claim, admit (DB calls)
  leaderboard.ts   top N + own rank, cached
  waitlist-cookie.ts  signed saphra_waitlist cookie
  emails.ts        templates on brand-layout
  admin.ts         admin actions + audit
  __tests__/rules.test.mjs
apps/web/app/early-access/            join, status, received
apps/web/app/api/early-access/*       routes in §7
apps/web/app/api/admin/early-access/* admin routes
apps/web/app/admin/early-access/      admin screen
apps/web/components/early-access/*   cards, leaderboard, code box, share row
packages/database/supabase/early-access.sql
```

Touch points in existing code: `proxy.ts` (gate), `lib/wallet-session.ts`
(claim), the three sign-in routes (set the claim, link the grant),
`app/api/profile/route.ts` (attach the live referrer on profile creation),
`components/landing/*` (CTA and `?ref=`), `/referral` (invites left),
traction events (`waitlist_joined`, `waitlist_verified`,
`waitlist_referral_counted`, `access_code_redeemed`, `waitlist_admitted`).

Tests (`pnpm --filter @saphra/web test:early-access`): email normalization,
word-code format and case-insensitive match, time limit (one second past
expiry) and people limit (last seat), second code refused for the same
person, score and tie-break order, live invite cap, flag rules, safe
magic-link tokens.

---

## 12. Phases

| Phase | Scope | Exit check |
|---|---|---|
| 0. Schema + switch | `early-access.sql`, backfill grants, settings row (`open`) | Existing users unaffected; mode `open` = today's app |
| 1. Join + confirm | Join page, received screen, confirm email, waitlist cookie, resume | Join → email → confirmed on testnet |
| 2. Referrals + leaderboard | `?ref=` capture, counting on confirm, score, rank, status page, live board | Board updates within 15 s of a confirmation |
| 3. Codes | Admin codes, live-user invites + cap, redeem box, `/referral` invites card | Last-seat race test passes; cap enforced |
| 4. Gate + admission | Session claim, proxy gate, claim flow, waves, threshold, "you're in" email, Invite & Earn hand-off | Not-admitted session gets 403 on every protected API; admitted one doesn't |
| 5. Admin + abuse | `/admin/early-access`, flags, holds, voiding, CSV, cron digests/expiry | Held referral doesn't move the board until released |
| 6. Launch | Flip mode to `waitlist` on production | Monitor joins, confirm rate, k-factor, flagged % |

Rollout: SQL first, everything on testnet with mode `waitlist`, then
production in `open`, then flip to `waitlist` when the landing campaign starts.
Opening to everyone later = one admin toggle back to `open`.

### Numbers to watch
Joins/day, confirmation rate (target > 60 %), invites per confirmed entry
(k-factor), % held for fraud, code redemptions by code, wave acceptance rate
(invited → signed in), admitted → first payment within 7 days.

---

## 13. Still open

- **Existing users as inviters**: the plan lets every current user invite 10
  people from day one (decided as the default; say if it should wait).
- **Which social accounts** are in the first list, with their URLs.
