import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CONSENT_TEXT_VERSION } from "@/lib/config";
import { getConsentMethodCopy } from "@/components/consent/method-copy";

/**
 * THE consent disclosure itself (plan §4, F9; M0 AC 17, 18). Server
 * component — pure copy; the interactive submission lives in `ConsentForm`.
 *
 * `CONSENT_TEXT_VERSION` is imported from `lib/config.ts`, never
 * hard-coded, and rendered directly beside the disclosure it versions — the
 * same value `ConsentForm` submits as `consentTextVersion` and the same
 * value `lib/consent/service.ts` checks submissions against, so the
 * rendered text and the recorded version can never disagree (this
 * milestone's brief).
 *
 * `stepCopyId`-keyed copy (`components/consent/method-copy.ts`) supplies
 * only the "what happens after you submit" mechanics — never the legal
 * disclosure above it, and never anything that branches on `ConsentMethod`
 * (ADR-0008 §3).
 */
export function ConsentText({ stepCopyId }: { stepCopyId: string }) {
  const copy = getConsentMethodCopy(stepCopyId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Give your consent
        </h1>
        <p className="text-sm text-muted-foreground">
          Federal law (COPPA) requires us to get your verifiable consent
          before we collect or use any personal information about your
          child. Please read this before continuing.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What you&apos;re agreeing to</CardTitle>
          <CardDescription>
            Consent text version {CONSENT_TEXT_VERSION}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
          <p>
            By submitting this form, you confirm that you are this
            student&apos;s parent or legal guardian — or are otherwise
            authorized to consent on their behalf — and that you agree to
            let us collect and use the information described in the notice
            you already read, for as long as this profile stays active.
          </p>
          <p>{copy.beforeSubmit}</p>
          <p>
            You can withdraw this consent at any time from the student&apos;s
            privacy page, which stops any further collection about them, and
            you can request full deletion of their data separately and
            immediately, whether or not you withdraw consent first.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
