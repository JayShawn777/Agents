import type { Metadata } from "next";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { VoiceFlow } from "@/components/voice/voice-flow";
import { requireUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { VOICE_CONSENT_LINES } from "@/lib/voice/consent-copy";

export const metadata: Metadata = {
  title: "Add your voice",
};

/**
 * M6 slice 8 — the voice flow's page. **The only route in the application that
 * reaches a microphone.**
 *
 * **Nothing under `(app)/students/**` links here, and a static test enforces
 * that** (AC 2): the control against a child cloning a classmate is that no
 * student-facing surface can reach this flow at all. This page lives under
 * `/account`, which is parent-only territory.
 *
 * **AC 1's adult gate is checked here as well as on every endpoint.** Not
 * defence in depth for its own sake: without it a parent who has not attested
 * would record a full consent statement and a voice sample, upload both, and
 * only then be refused — having already handed us the most sensitive audio we
 * will ever hold.
 *
 * The consent wording is passed from the server so the words on screen and the
 * version stamped on the stored recording cannot drift apart.
 */
export default async function AddVoicePage() {
  const user = await requireUser();

  const account = await db.user.findUnique({
    where: { id: user.userId },
    select: { adultAttestedAt: true },
  });

  if (!account?.adultAttestedAt) {
    return (
      <main className="mx-auto w-full max-w-2xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold">Add your voice</h1>
        <Alert>
          <AlertDescription>
            Creating a voice is only available to the adult account holder. Confirm your account details first,
            then come back to this page.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl space-y-8 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Add your voice</h1>
        <p className="text-muted-foreground text-sm">
          Record your own voice so your children can hear their lessons read by you. You record a short
          permission statement first, then a sample. You can delete the voice at any time.
        </p>
      </header>

      <VoiceFlow consentLines={VOICE_CONSENT_LINES} />
    </main>
  );
}
