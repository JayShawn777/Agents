import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PersonaPicker } from "@/components/personas/persona-picker";
import { requireStudentProfile } from "@/lib/auth/dal";
import { DEFAULT_PERSONA_SLUG } from "@/lib/config";
import { listPersonas } from "@/lib/personas/dal";
import { toPersonaDTO } from "@/lib/personas/dto";

/**
 * The persona picker screen (plan §4/§5, slice 7; M5 AC 3/4).
 *
 * Server component: reads personas through the DAL rather than a route
 * (there is no `GET /api/personas` — plan §3), and reads the profile's
 * current choice straight off the `StudentProfile` row `requireStudentProfile`
 * already returns, rather than round-tripping through a DTO that does not
 * carry `personaId` at all (only the PATCH *response* does, per the fixed
 * contract, and this page isn't reading a PATCH response).
 *
 * Requires `ACTIVE`, matching every other profile-scoped mutation surface in
 * this app (`edit/page.tsx`'s own gate) — a profile that cannot upload
 * cannot choose a voice for lessons it cannot generate either.
 */

export const metadata: Metadata = {
  title: "Choose a tutor voice",
};

export default async function VoicePickerPage({
  params,
}: PageProps<"/students/[studentId]/voice">) {
  const { studentId } = await params;
  const student = await requireStudentProfile(studentId);
  if (!student) notFound();
  if (student.status !== "ACTIVE") redirect(`/students/${studentId}`);

  // Scoped to the owning account (M6 AC 12): the shared six, plus any voice this
  // family cloned, and nobody else's.
  const personaRows = await listPersonas(student.userId);
  const personas = personaRows.map(toPersonaDTO);
  const defaultPersonaId = personas.find((persona) => persona.slug === DEFAULT_PERSONA_SLUG)?.id ?? null;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Choose {student.displayName ?? "your"} tutor&apos;s voice
        </h1>
        <p className="text-sm text-muted-foreground">
          Every lesson can be read aloud. Pick who reads it — this can be changed any time.
        </p>
      </div>
      <PersonaPicker
        studentId={studentId}
        personas={personas}
        initialPersonaId={student.personaId}
        defaultPersonaId={defaultPersonaId}
      />
    </div>
  );
}
