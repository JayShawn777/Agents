/**
 * AC 19's disclosure — a persistent label, not a dialog: "Spoken by a
 * computer voice (Coach Vale)." A child (and a parent reading over their
 * shoulder) should never have to go looking for the fact that a lesson's
 * narrator is not a person.
 *
 * Not "use client" — static text, no state, no event handler. `personaLabel`
 * is resolved server-side from the profile's chosen (or default) persona, the
 * same value the picker (`/students/[studentId]/voice`) shows — this label
 * describes WHO WILL narrate the lesson going forward, independent of
 * whether a narration run for this exact version exists yet.
 */

export function AiVoiceDisclosure({ personaLabel }: { personaLabel: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      Spoken by a computer voice ({personaLabel}).
    </p>
  );
}
