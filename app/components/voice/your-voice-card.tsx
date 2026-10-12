import Link from "next/link";
import { Mic } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomVoiceActions } from "@/components/voice/custom-voice-actions";
import { MAX_CUSTOM_VOICES_PER_USER } from "@/lib/config";
import { listOwnedPersonas } from "@/lib/personas/dal";

/**
 * M6 slice 9 — THE ENTRY POINT. A "Your voice" card on the account's Settings
 * page, the only place a parent can reach the voice flow from.
 *
 * Built and linked in its own slice because that is the M2.5 lesson: seven
 * green slices with no way in is this project's most repeated failure.
 * `tests/unit/components/voice/entry-points.test.ts` renders the Settings page
 * and fails if this link disappears.
 *
 * Lives under Settings (account level), never under `/students/**` — AC 2. A
 * voice belongs to the adult account holder, not to any child's profile.
 *
 * Reads only through the persona DAL (`listOwnedPersonas`), scoped to the
 * signed-in account. The adult-attestation gate is NOT re-checked here to decide
 * visibility: `/account/voice` shows its own explanation to a parent who has
 * not attested, which is more useful than a missing card.
 */
export async function YourVoiceCard({ userId }: { userId: string }) {
  const owned = await listOwnedPersonas(userId);
  const voices = owned.map((p) => ({ id: p.id, label: p.label, status: p.status }));
  const held = voices.filter((v) => v.status !== "REVOKED").length;
  const canAdd = held < MAX_CUSTOM_VOICES_PER_USER;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your voice</CardTitle>
        <CardDescription>
          Record your own voice so your children can hear their lessons read by you. It is an AI recreation of your
          voice, not a recording of you, and your children are told so. You can stop using it or delete it at any
          time.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {voices.length > 0 ? (
          <ul className="flex flex-col gap-4">
            {voices.map((voice) => (
              <li key={voice.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{voice.label}</span>
                  {voice.status === "REVOKED" ? <Badge variant="outline">Not in use</Badge> : null}
                  {voice.status === "PENDING_VERIFICATION" ? <Badge variant="outline">Being set up</Badge> : null}
                </div>
                <CustomVoiceActions personaId={voice.id} label={voice.label} canRevoke={voice.status !== "REVOKED"} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">You haven&apos;t added a voice yet.</p>
        )}

        {canAdd ? (
          <div>
            <Button className="h-11 gap-2" render={<Link href="/account/voice" />}>
              <Mic className="size-4" aria-hidden="true" />
              Add your voice
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            You&apos;ve reached the limit of {MAX_CUSTOM_VOICES_PER_USER} voice. Delete it to add a different one.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
