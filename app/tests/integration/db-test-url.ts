/**
 * `lib/db.ts` requires a real `postgres://` connection string — Prisma 7's
 * driver adapter (`@prisma/adapter-pg`) speaks the Postgres wire protocol
 * directly via `pg`. `pnpm exec prisma dev start` instead writes
 * `DATABASE_URL` as `prisma+postgres://...&api_key=...` — the HTTP proxy
 * protocol Prisma's OWN query engine (used by `prisma migrate`/`prisma
 * studio`, configured via `prisma.config.ts`) understands, which `pg`
 * cannot speak (it fails immediately with "Connection terminated
 * unexpectedly"). The proxy URL's `api_key` is a base64 JSON blob that
 * carries the real `postgres://` URL the local dev server proxies to
 * (the same one `prisma dev start` prints as its second, "connect with
 * Prisma ORM" connection string). This helper decodes it so integration
 * tests can reach the SAME local database `pnpm dev` and `prisma migrate`
 * already use, through `@/lib/db` itself, without a second hand-maintained
 * env var.
 *
 * A no-op for a real `postgres://`/`postgresql://` URL (Neon, Supabase,
 * CI) — those already work with `pg` directly.
 *
 * MUST be called and must reassign `process.env.DATABASE_URL` BEFORE
 * `@/lib/db` is imported anywhere in the process, since `lib/db.ts` reads
 * it at module load. Every integration test therefore calls this first,
 * then `await import("@/lib/db")` — never a static import of `@/lib/db` at
 * the top of the file, which ESM would hoist ahead of this call.
 */
export function configureDirectDatabaseUrl(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw || !raw.startsWith("prisma+postgres://")) return;

  const apiKey = new URL(raw).searchParams.get("api_key");
  if (!apiKey) return;

  const decoded = JSON.parse(Buffer.from(apiKey, "base64").toString("utf8")) as {
    databaseUrl?: string;
  };
  if (decoded.databaseUrl) {
    process.env.DATABASE_URL = decoded.databaseUrl;
  }
}
