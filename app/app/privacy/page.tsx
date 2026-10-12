import type { Metadata } from "next";
import Link from "next/link";

/**
 * Public privacy policy (plan §4, F5). PUBLIC — reachable without sign-in,
 * same as `/retention`, and linked from the §312.4 direct notice (M0 AC 12).
 *
 * This copy is a first draft, not reviewed by counsel — see the open
 * questions in `docs/specs/m0-accounts-and-profiles.md`. It states what the
 * product actually does today; it must be kept in sync with `RETENTION_POLICY`
 * and the direct notice rather than drifting into its own description.
 */

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "How this app collects, uses, and protects your information.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Privacy policy
        </h1>
        <p className="text-sm text-muted-foreground">
          This policy explains what information we collect, why, who else
          sees it, and how long we keep it. It applies to every account
          holder and every student profile in the app.
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-foreground">
          Children&apos;s privacy
        </h2>
        <p className="text-sm text-muted-foreground">
          This app is used by children under a parent or guardian&apos;s account.
          Before any information about a child is collected, we tell the
          parent exactly what will be collected and why, and we require
          verifiable parental consent under the Children&apos;s Online Privacy
          Protection Act (COPPA). A parent can review what we hold about
          their child, refuse further collection, or request deletion at any
          time from that child&apos;s profile.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-foreground">
          What we collect
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>The account holder&apos;s email address, used to sign in.</li>
          <li>
            A learner&apos;s age band, display name, grade level, subjects, and a
            chosen preset avatar — collected only after a parent has given
            verifiable consent, if the learner is under 18.
          </li>
          <li>
            Photos or PDFs of a student&apos;s schoolwork that a parent chooses to
            upload, and the problem text extracted from them.
          </li>
          <li>
            Only if the account holder chooses to add their own voice: a short
            recording of that adult&apos;s voice, and a separate recording of
            them saying aloud that they agree to it. Neither is ever collected
            from a child, and no one else can add a voice to an account.
          </li>
          <li>
            Records of the notices we&apos;ve shown and the consent a parent has
            given, kept as evidence that we followed this policy.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-foreground">
          Who else sees it
        </h2>
        <p className="text-sm text-muted-foreground">
          We share information only with the vendors that help us run the
          product, and never for advertising:
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Anthropic</span> —
            reads uploaded schoolwork and extracted text to power tutoring.
          </li>
          <li>
            <span className="font-medium text-foreground">Vercel</span> —
            stores uploaded files in a private store.
          </li>
          <li>
            <span className="font-medium text-foreground">Neon</span> —
            stores our database records.
          </li>
          <li>
            <span className="font-medium text-foreground">ElevenLabs</span> —
            turns lesson narration text into the spoken voice that reads a
            lesson aloud. It receives the narration sentences only, never the
            uploaded images or PDFs and no identifier for your child. If the
            account holder adds their own voice, it also receives that one
            voice recording to create the voice. It never receives the
            recording of the account holder&apos;s spoken permission.
          </li>
          <li>
            <span className="font-medium text-foreground">
              Our transactional email provider
            </span>{" "}
            — receives the account holder&apos;s email address to deliver
            sign-in links and consent-related messages.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-foreground">
          If you add your own voice
        </h2>
        <p className="text-sm text-muted-foreground">
          An account holder can record their own voice so a child hears lessons
          read by a recreation of it. Only an adult account holder can do this,
          and only after recording a spoken statement agreeing to it. The voice
          recording is deleted as soon as the voice exists. The spoken
          permission is kept as our evidence of that agreement for the period
          shown in the{" "}
          <Link
            href="/retention"
            className="underline underline-offset-4 hover:text-foreground"
          >
            data retention policy
          </Link>
          , and is never sent to ElevenLabs or played to a child.
        </p>
        <p className="text-sm text-muted-foreground">
          You can stop using the voice, or delete it, at any time from Settings.
          Either one removes it from ElevenLabs; deleting also removes the
          narration already made with it. Closing your account deletes it too.
          Children are told whenever the voice they hear is a recreation and not
          a recording of a person.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-foreground">
          How long we keep it
        </h2>
        <p className="text-sm text-muted-foreground">
          Every category of information we collect has a published retention
          window, enforced by the same configuration our deletion jobs run
          against. See the full{" "}
          <Link
            href="/retention"
            className="underline underline-offset-4 hover:text-foreground"
          >
            data retention policy
          </Link>{" "}
          for the complete list.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-foreground">Your rights</h2>
        <p className="text-sm text-muted-foreground">
          A parent can review, correct, or request deletion of their child&apos;s
          information at any time from that child&apos;s profile — this does not
          require closing the whole account. Deletion requested this way is
          immediate and cannot be undone.
        </p>
      </section>
    </div>
  );
}
