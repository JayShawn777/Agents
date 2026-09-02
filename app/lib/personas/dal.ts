import "server-only";

import { db } from "@/lib/db";
import type { Persona, Prisma } from "@/lib/generated/prisma/client";

/**
 * M5 AC 1/2 — the tutor persona picker's data source, and since M6 **the only
 * module in this application permitted to read the `Persona` table.**
 *
 * Deliberately not a route (plan §3): `GET /api/personas` would be a route with
 * no consumer besides one server component — the picker page reads through this
 * DAL and passes rows as props, and M4's own rule holds ("a route with no
 * consumer is a retention obligation nobody scoped").
 *
 * ## Why every function here demands a viewer, and none of them may not
 *
 * This file used to open by saying personas are app reference data with "no
 * `userId` scope to check here". That was true for the six shared M5 personas
 * and it stopped being true the moment M6 added `Persona.ownerUserId`.
 *
 * A cloned voice is a model of a real adult's voice, owned by one account. An
 * unscoped `findFirst({ where: { id } })` — which is what
 * `PATCH /api/students/[studentId]` and the narration route's persona
 * resolution both did — lets account A point their child's narration at account
 * B's cloned parent voice. A stranger's real voice reading a child's homework,
 * reachable by pasting one cuid. That is M6 AC 12 stated as its failure.
 *
 * So: **`viewerUserId` is a required parameter on every reader here, and there
 * is deliberately no variant that omits it.** An optional parameter is how this
 * comes back — the next caller passes nothing, the clause quietly disappears,
 * and nothing fails. There is no legitimate call site that wants "any persona
 * regardless of owner"; a background job acting for a profile has that profile's
 * `userId` and should pass it.
 *
 * `tests/unit/lib/personas/single-reader.test.ts` reads the source tree and
 * fails if `db.persona.<read>` appears in any file but this one. Same mechanism
 * as `no-voice-id-literals.test.ts`, and the same reasoning as retro lesson 22:
 * a rule a grep can check is a rule that cannot be quietly dropped.
 */

/**
 * The visibility clause. Shared personas (`ownerUserId: null`) are visible to
 * everyone; an owned persona is visible only to the account that owns it.
 *
 * Exported so the one legitimate composer outside a reader — a query that also
 * needs its own filters — builds on this rather than restating it. Restating it
 * is how two copies drift.
 */
export function personaVisibilityWhere(viewerUserId: string): Prisma.PersonaWhereInput {
  return { OR: [{ ownerUserId: null }, { ownerUserId: viewerUserId }] };
}

/**
 * The picker's list (AC 2): shared personas plus this account's own, excluding
 * retired ones. A retired persona is not offered for a NEW selection; a profile
 * that already chose one keeps it (see `findPersonaById`).
 */
export async function listPersonas(viewerUserId: string): Promise<Persona[]> {
  return db.persona.findMany({
    where: { AND: [personaVisibilityWhere(viewerUserId), { retiredAt: null }] },
    orderBy: { sortOrder: "asc" },
  });
}

/**
 * One persona by id, retired or not, **scoped to what this viewer may see.**
 *
 * Used to resolve the label for a profile that has already chosen one (AC 19's
 * disclosure): a profile pointed at a since-retired persona must still show a
 * name rather than silently falling through, while AC 3's actual voice fallback
 * is a generation-time concern rather than a display one.
 *
 * Returns `null` for a persona owned by another account — indistinguishable
 * from "does not exist", which is the rule M1 AC 33 sets for every
 * cross-account read in this app.
 */
export async function findPersonaById(id: string, viewerUserId: string): Promise<Persona | null> {
  return db.persona.findFirst({
    where: { AND: [{ id }, personaVisibilityWhere(viewerUserId)] },
  });
}

/**
 * One persona by id that is also a VALID NEW SELECTION: visible to this viewer
 * and not retired. Separate from `findPersonaById` because the two rules
 * genuinely differ — displaying an already-chosen persona is permissive,
 * choosing one afresh is not — and collapsing them would silently allow a
 * retired voice to be re-selected.
 */
export async function findSelectablePersona(id: string, viewerUserId: string): Promise<Persona | null> {
  return db.persona.findFirst({
    where: { AND: [{ id }, { retiredAt: null }, personaVisibilityWhere(viewerUserId)] },
  });
}

/**
 * One persona by slug — used to resolve `DEFAULT_PERSONA_SLUG` for a profile
 * that never chose.
 *
 * **No viewer parameter, and that is safe by construction rather than by
 * convention:** slugs are only ever read for the app's own seeded constants,
 * and this query additionally requires `ownerUserId: null`. A cloned voice gets
 * a generated `custom-<cuid>` slug, so it can never be reached here even if a
 * caller passed one.
 */
export async function findSharedPersonaBySlug(slug: string): Promise<Persona | null> {
  return db.persona.findFirst({ where: { slug, ownerUserId: null } });
}
