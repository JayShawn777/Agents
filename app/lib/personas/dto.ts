import "server-only";

import type { Persona } from "@/lib/generated/prisma/client";
import type { PersonaDTO } from "@/lib/schemas/dto";

/**
 * Maps a `Persona` row to the wire/prop shape (plan §3). The only place this
 * shape is built — mirrors `lib/students/dto.ts`, `lib/uploads/dto.ts`, etc.
 *
 * `providerVoiceId` and `ttsProvider` are never read here: AC 1 says the
 * voice id lives on exactly one table and reaches nowhere else, and a picker
 * a child sees has no business rendering it even by omission-that-could-slip.
 */
export function toPersonaDTO(persona: Pick<Persona, "id" | "slug" | "label" | "description" | "artworkId">): PersonaDTO {
  return {
    id: persona.id,
    slug: persona.slug,
    label: persona.label,
    description: persona.description,
    artworkId: persona.artworkId,
  };
}
