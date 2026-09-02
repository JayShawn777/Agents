import { afterAll, describe, expect, it } from "vitest";

import { configureDirectDatabaseUrl } from "./db-test-url";

configureDirectDatabaseUrl();

const { db } = await import("@/lib/db");
const { listPersonas, findPersonaById, findSelectablePersona, findSharedPersonaBySlug, personaVisibilityWhere } =
  await import("@/lib/personas/dal");
const { DEFAULT_PERSONA_SLUG } = await import("@/lib/config");

/**
 * **M6 AC 12, against real Postgres.** A cloned voice belongs to one account and
 * must be invisible to every other.
 *
 * This is tested against a real database rather than a mock because the whole
 * question is what a `WHERE` clause with an `OR` over a nullable column actually
 * returns. A stateful fake would return whatever its author believed that clause
 * meant — which is precisely the belief under test.
 *
 * The failure this prevents is not abstract. Before the visibility clause
 * existed, `PATCH /api/students/[studentId]` validated a chosen persona with
 * `findFirst({ id, retiredAt: null })`, and `resolvePersonaForNarration` — the
 * function that decides which voice SPEAKS — resolved one with
 * `findUnique({ id })`. Either would have accepted another account's cloned
 * voice, and a child's homework would have been read aloud in a stranger's real
 * voice.
 */

const createdUserIds: string[] = [];
const createdPersonaIds: string[] = [];

afterAll(async () => {
  if (createdPersonaIds.length > 0) {
    await db.persona.deleteMany({ where: { id: { in: createdPersonaIds } } });
  }
  for (const id of createdUserIds) {
    await db.user.delete({ where: { id } }).catch(() => {});
  }
});

async function makeAccount(tag: string) {
  const user = await db.user.create({
    data: { email: `persona-iso-${tag}-${Date.now()}-${Math.random()}@example.com`, adultAttestedAt: new Date() },
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeOwnedPersona(ownerUserId: string, tag: string) {
  const unique = `${Date.now()}-${Math.random()}`;
  const persona = await db.persona.create({
    data: {
      slug: `custom-${tag}-${unique}`,
      label: `${tag}'s voice`,
      description: "A cloned voice belonging to one account.",
      artworkId: "preset-custom",
      providerVoiceId: `voice_${tag}_${unique}`,
      sortOrder: 100,
      ownerUserId,
    },
  });
  createdPersonaIds.push(persona.id);
  return persona;
}

describe("a cloned persona is visible only to the account that owns it", () => {
  it("does not appear in another account's picker list", async () => {
    const alice = await makeAccount("alice");
    const bob = await makeAccount("bob");
    const alicesVoice = await makeOwnedPersona(alice.id, "alice");

    const alicesList = await listPersonas(alice.id);
    const bobsList = await listPersonas(bob.id);

    expect(alicesList.map((p) => p.id)).toContain(alicesVoice.id);
    expect(bobsList.map((p) => p.id)).not.toContain(alicesVoice.id);
  });

  it("both accounts still see the shared personas", async () => {
    const alice = await makeAccount("alice2");
    const bob = await makeAccount("bob2");
    await makeOwnedPersona(alice.id, "alice2");

    const shared = await db.persona.findMany({ where: { ownerUserId: null, retiredAt: null }, select: { id: true } });
    expect(shared.length).toBeGreaterThan(0); // the seeded six; guards a vacuous pass

    for (const list of [await listPersonas(alice.id), await listPersonas(bob.id)]) {
      for (const row of shared) {
        expect(list.map((p) => p.id)).toContain(row.id);
      }
    }
  });

  /**
   * The exact IDOR: Bob pastes the id of Alice's cloned voice. Both the display
   * reader and the selection reader must refuse — and refuse by returning null,
   * indistinguishable from "no such persona" (M1 AC 33's rule for every
   * cross-account read in this app).
   */
  it("is null for another account by id, both for display and for selection", async () => {
    const alice = await makeAccount("alice3");
    const bob = await makeAccount("bob3");
    const alicesVoice = await makeOwnedPersona(alice.id, "alice3");

    expect(await findPersonaById(alicesVoice.id, alice.id)).not.toBeNull();
    expect(await findSelectablePersona(alicesVoice.id, alice.id)).not.toBeNull();

    expect(await findPersonaById(alicesVoice.id, bob.id)).toBeNull();
    expect(await findSelectablePersona(alicesVoice.id, bob.id)).toBeNull();
  });

  it("a retired owned persona is still displayable to its owner but not selectable", async () => {
    const alice = await makeAccount("alice4");
    const alicesVoice = await makeOwnedPersona(alice.id, "alice4");
    await db.persona.update({ where: { id: alicesVoice.id }, data: { retiredAt: new Date() } });

    // AC 19's disclosure must still resolve a label for an already-chosen voice…
    expect(await findPersonaById(alicesVoice.id, alice.id)).not.toBeNull();
    // …while a NEW selection of it is refused.
    expect(await findSelectablePersona(alicesVoice.id, alice.id)).toBeNull();
  });

  it("the default persona resolves by slug and can never be an owned voice", async () => {
    const alice = await makeAccount("alice5");
    // A cloned voice deliberately squatting the default slug must not be reachable.
    const impostor = await db.persona.create({
      data: {
        slug: `${DEFAULT_PERSONA_SLUG}-lookalike-${Date.now()}`,
        label: "Not the default",
        description: "An owned persona that must never resolve as the shared default.",
        artworkId: "preset-custom",
        providerVoiceId: `voice_impostor_${Date.now()}`,
        sortOrder: 101,
        ownerUserId: alice.id,
      },
    });
    createdPersonaIds.push(impostor.id);

    const resolved = await findSharedPersonaBySlug(DEFAULT_PERSONA_SLUG);
    expect(resolved).not.toBeNull();
    expect(resolved!.ownerUserId).toBeNull();
    expect(resolved!.id).not.toBe(impostor.id);
  });

  it("the visibility clause matches shared and own, and nothing else", async () => {
    const alice = await makeAccount("alice6");
    const bob = await makeAccount("bob6");
    const alicesVoice = await makeOwnedPersona(alice.id, "alice6");
    const bobsVoice = await makeOwnedPersona(bob.id, "bob6");

    const visibleToAlice = await db.persona.findMany({
      where: personaVisibilityWhere(alice.id),
      select: { id: true, ownerUserId: true },
    });

    const ids = visibleToAlice.map((p) => p.id);
    expect(ids).toContain(alicesVoice.id);
    expect(ids).not.toContain(bobsVoice.id);
    // Every row returned is either shared or Alice's — no third category leaks.
    for (const row of visibleToAlice) {
      expect(row.ownerUserId === null || row.ownerUserId === alice.id).toBe(true);
    }
  });

  it("an owned persona dies with its account (AC 20's local half)", async () => {
    const alice = await makeAccount("alice7");
    const alicesVoice = await makeOwnedPersona(alice.id, "alice7");

    await db.user.delete({ where: { id: alice.id } });

    expect(await db.persona.findUnique({ where: { id: alicesVoice.id } })).toBeNull();
    // The shared set is untouched — a cascade that took those would be a disaster.
    const sharedRemaining = await db.persona.count({ where: { ownerUserId: null } });
    expect(sharedRemaining).toBeGreaterThan(0);
  });
});
