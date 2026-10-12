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
 *
 * **M6 AC 16 — the version that matters most.** A parent's cloned voice is the
 * one case where a child could take the narrator for the real person, so it
 * names the person and says plainly that it is a recreation. Not a pronoun:
 * the label is whatever the parent typed, and guessing a gender for it is the
 * kind of detail that is wrong exactly once, in front of a child.
 */

export function AiVoiceDisclosure({
  personaLabel,
  isCustomVoice = false,
}: {
  personaLabel: string;
  isCustomVoice?: boolean;
}) {
  return (
    <p className="text-xs text-muted-foreground">
      {isCustomVoice
        ? `An AI recreation of ${personaLabel}’s voice, not a recording of them.`
        : `Spoken by a computer voice (${personaLabel}).`}
    </p>
  );
}
