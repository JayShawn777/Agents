# Deploy checklist — first family deployment

Written 2026-10-12. Goal: the owner's own children using the app on a real URL.
Parent-facing compliance work is deliberately deferred (see "Before other families").

## 1. Accounts and secrets (owner)

Put every value in the Vercel project's **Environment Variables** — never in chat or in git.

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL` | Neon project connection string |
| `STORAGE_DRIVER` | `vercel-blob` |
| `BLOB_READ_WRITE_TOKEN` | Vercel → Storage → create a **private** Blob store |
| `ANTHROPIC_API_KEY` (+ `ANTHROPIC_WORKSPACE_ID` if the key is identity-linked) | Anthropic console |
| `ELEVENLABS_API_KEY` | Paid ElevenLabs plan; key scoped to **text-to-speech only** |
| `ELEVENLABS_VOICE_ADMIN_KEY` | Second key with voices read+write (voice cloning). The 32-64 hex **key ID** is not the key — use the `sk_…` secret |
| `AUTH_RESEND_KEY`, `EMAIL_FROM` | Resend; the sending address must be a verified domain/address |
| `EMAIL_TRANSPORT` | leave unset in production (`console` is dev-only) |
| `AUTH_SECRET`, `CRON_SECRET`, `AUDIT_PSEUDONYM_KEY` | each a long random string: `openssl rand -base64 32` |
| `AUTH_URL`, `NEXT_PUBLIC_APP_URL` | the deployed origin, e.g. `https://<project>.vercel.app` |
| `CONSENT_METHOD` | `EMAIL_PLUS` |
| **`ALLOWED_SIGNUP_EMAILS`** | **your family's email addresses, comma-separated. Unset means anyone can sign up.** |

Vercel project settings: import the repo with **root directory `app`**; do not override the install or build commands (`postinstall` runs `prisma generate`).

## 2. Database

`pnpm db:migrate:prod` from a machine that has `.env.neon` (the Neon string). Migrations do not run on deploy.

## 3. First-deployment checks the code could not do for us

`lib/storage/vercel-blob.ts` was written against the SDK's types and has never run against a real store. On the first deployment confirm:

1. The Blob store really is private and the plan allows it.
2. Fetching a stored object's raw URL **without** a signature is refused.
3. A worksheet upload completes, a preview URL loads, and it stops working after about five minutes.

Then one full pass in a real browser (phone and laptop): sign in → add a child → consent → upload homework → practice → tutor chat → lesson → narration → record a voice. Autoplay between narration steps is still an owner-run measurement (`docs/measurements/autoplay-check.html`, real Chrome and Safari).

## 4. Cost controls while it's only the family

ElevenLabs is the one recurring cost that scales with use. The daily narration character budget is a single setting in `lib/config.ts` (`NARRATION_DAILY_BUDGET_CHARS`, currently 20,000 characters per day); keep it low until usage is known.

## Before other families (deferred, not forgotten)

- Remove `ALLOWED_SIGNUP_EMAILS` only after the items below.
- Counsel review of the COPPA direct notice, the retention policy and `VOICE_CONSENT_LINES`.
- The vendors' contractual erasure terms (an API reporting a voice "deleted" is not a DPA).
- The M6 review (routes and gates, `lib/voice/*`, deletion paths and jobs, the UI), and the M5/M6 retros.
- A mechanism to re-obtain consent on a notice-version bump (none exists today).
- Persona artwork for `preset-custom-voice`.
