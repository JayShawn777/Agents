# Handoff — continuing in your Codespace

Written 2026-10-12. Contains **no secrets**: it says where they live and what to do with them.

## Where your keys actually are

Not in `README.md` or `CLAUDE.md`, and not in git. `CLAUDE.md` says the real values live in
**`app/.env`** (gitignored by `.env*` in `app/.gitignore`) and the Neon string in **`app/.env.neon`**
(also gitignored, deliberately separate so day-to-day work never touches production). Those files exist
in the Codespace (or computer) where you set the app up. They do **not** exist in the cloud session
Claude has been working in; a scan of every tracked file found only the placeholders in `.env.example`.

Per `CLAUDE.md`, an agent also cannot write `.env` there (a guard hook blocks it), so a human fills it.
Never paste a key into a README, `CLAUDE.md`, a commit, or a chat: a committed key stays in git history.

## What is on the branch

Branch **`claude/m6-slices-9-10`** (not merged; `main` untouched), three feature commits:
M6 slices 9-10, then the Vercel Blob storage adapter, invite-only sign-in and the deploy checklist.
Gates were green on it: 1405 passed / 13 skipped.

## Getting it into the Codespace

```
cd app            # or /workspaces/Agents/app
git fetch origin claude/m6-slices-9-10
git checkout claude/m6-slices-9-10
pnpm install
pnpm exec prisma dev start app     # local DB; first time: pnpm exec prisma dev --name app --detach
pnpm exec prisma migrate deploy    # new migrations only if any; local DB
```

Your existing `app/.env` still applies. The branch adds **one new variable**, optional locally:
`ALLOWED_SIGNUP_EMAILS` (comma-separated emails; unset = open to anyone).

## Local vs deployed: what changes

| | Local (Codespace) | Deployed (Vercel) |
|---|---|---|
| Storage | `STORAGE_DRIVER=local` (default); files on disk | `STORAGE_DRIVER=vercel-blob` + `BLOB_READ_WRITE_TOKEN` from a **private** Blob store |
| Keys | your existing `app/.env` | the **same values re-entered** in Vercel → Settings → Environment Variables. Vercel does not read your `.env` |
| Database | local `prisma dev` | Neon; migrate with `pnpm db:migrate:prod` (uses `.env.neon`) |
| Sign-in email | `EMAIL_TRANSPORT=console` prints links | Resend (`AUTH_RESEND_KEY`, verified `EMAIL_FROM`) |

So: **testing with your kids locally needs nothing new** — run `pnpm dev` in the Codespace, forward
the port, open it on a phone. Putting it on a real URL needs the Vercel environment variables entered
once by you (see `docs/deploy-checklist.md`). Keys already in `.env` just need copying across.

## Fastest path to the kids

1. Check out the branch in the Codespace as above and run `pnpm dev` (confirm `ELEVENLABS_*` and
   `ANTHROPIC_API_KEY` are in your `.env`).
2. Run the full session on the forwarded URL: sign in → child → consent → upload → practice → chat →
   lesson → narration → record a voice. Local storage is fine for this.
3. Only when you want it reachable without the Codespace running, do the Vercel deployment.

## Still true from the earlier handoff

Nothing merged, no PR. Deferred until other families: counsel review of notice/consent copy, vendor
erasure terms, the M6 review, consent re-prompt on notice bump, persona artwork for the custom voice.
`lib/storage/vercel-blob.ts` has never run against a real store (three checks in the deploy checklist).
