import "server-only";

import { db } from "@/lib/db";
import type { Persona } from "@/lib/generated/prisma/client";

/**
 * M5 AC 1/2 — the tutor persona picker's data source.
 *
 * Deliberately not a route (plan §3): `GET /api/personas` would be a route
 * with no consumer besides this one server component — the picker page reads
 * through this DAL and passes rows as props, and M4's own rule holds ("a
 * route with no consumer is a retention obligation nobody scoped").
 *
 * Personas are app reference data — no student data, ever — so unlike every
 * other DAL helper in this app there is no `userId` scope to check here.
 * That is the whole reason AC 1 puts the provider voice id on THIS table and
 * nowhere else.
 */
export async function listPersonas(): Promise<Persona[]> {
  return db.persona.findMany({
    where: { retiredAt: null },
    orderBy: { sortOrder: "asc" },
  });
}

/**
 * One persona by id, retired or not. Used to resolve the label for a profile
 * that has already chosen one (AC 19's disclosure) — a profile pointed at a
 * persona that has since been retired must still show a name, not silently
 * fall through, while AC 3's actual voice fallback is a generation-time
 * concern, not a display one.
 */
export async function findPersonaById(id: string): Promise<Persona | null> {
  return db.persona.findFirst({ where: { id } });
}

/** One persona by slug — used to resolve `DEFAULT_PERSONA_SLUG` for a profile that never chose. */
export async function findPersonaBySlug(slug: string): Promise<Persona | null> {
  return db.persona.findFirst({ where: { slug } });
}
