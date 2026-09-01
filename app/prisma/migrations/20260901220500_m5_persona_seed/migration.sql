-- M5 AC 1. The six tutor personas, as DATA rather than as code.
--
-- Why a migration and not a seed script: this repo has no `prisma/seed.ts` and
-- no `prisma.seed` entry, so a seed would be a second command that has to be
-- remembered on every environment including Neon, where `pnpm db:migrate:prod`
-- is the only step anyone runs. A forgotten seed is an app with zero personas,
-- which is an app with no narration at all.
--
-- Why the voice ids live here: the vendor's stock voice set carries a published
-- expiry (2026-12-31 for the legacy set). An id compiled into application code
-- is an outage with a calendar entry on it. AC 3 repoints this column; it could
-- never repoint a constant. A later voice remap is a new migration, which is
-- also the audit trail we want -- "when did Coach Vale's voice change, and to
-- what" becomes a question `git log prisma/migrations/` answers.
--
-- Why the ids are literal: they are referenced by `StudentProfile.personaId`,
-- so they must be identical in every environment. They are cuid-SHAPED because
-- the profile PATCH contract validates `personaId` with `z.cuid()`.
--
-- AC 2: every name and description below is an original character. None names
-- or evokes a real, living individual -- three names in the owner's first list
-- did, and were changed for exactly that reason (see the M5 spec).
--
-- Idempotent on slug, so a re-run or a partially applied environment repairs
-- itself rather than failing.

INSERT INTO "Persona" ("id", "slug", "label", "description", "artworkId", "providerVoiceId", "sortOrder", "updatedAt")
VALUES
  ('cm5personasmoothj00000001', 'smooth-j', 'Smooth J', 'Takes it easy and keeps it cool. Explains things like you have all the time in the world.', 'persona-smooth-j', 'cjVigY5qzO86Huf0OWal', 1, CURRENT_TIMESTAMP),
  ('cm5personasunny0000000002', 'professor-sunny', 'Professor Sunny', 'Bright and funny, and always finds a way to make a hard thing feel lighter.', 'persona-professor-sunny', 'cgSgspJ2msm6clMCkdW9', 2, CURRENT_TIMESTAMP),
  ('cm5personavale00000000003', 'coach-vale', 'Coach Vale', 'Precise and serious. Does everything by the book, one careful step at a time.', 'persona-coach-vale', 'XrExE9yKIg1WjnnlVkGX', 3, CURRENT_TIMESTAMP),
  ('cm5personao00000000000004', 'professor-o', 'Professor O', 'Calm and clear, and never in a hurry. Good when you want things steady.', 'persona-professor-o', 'nPczCjzI2devNBz1zQrb', 4, CURRENT_TIMESTAMP),
  ('cm5personablaze0000000005', 'professor-blaze', 'Professor Blaze', 'Full of energy and always in your corner. Big on cheering you on.', 'persona-professor-blaze', 'TX3LPaxmHKxFdv7VOQHJ', 5, CURRENT_TIMESTAMP),
  ('cm5personalove00000000006', 'professor-love', 'Professor Love', 'Patient and encouraging. Happy to go over it again as many times as you need.', 'persona-professor-love', 'Xb7hH8MSUJpSbSDYk0k2', 6, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
