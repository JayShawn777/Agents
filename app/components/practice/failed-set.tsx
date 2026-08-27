import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RetryPracticeSetButton } from "@/components/practice/retry-practice-set-button";

/**
 * AC 6: a plain message + retry, and nothing else (plan §4, F21). No stack
 * trace, model identifier or raw provider payload ever reaches this far —
 * `failureMessage` is already the allowlisted string chosen server-side.
 * Server component; the mutation is delegated to the client leaf.
 */
export function FailedSet({
  practiceSetId,
  failureMessage,
}: {
  practiceSetId: string;
  failureMessage: string | null;
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>We couldn&apos;t put this practice set together</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>{failureMessage ?? "Something went wrong. Please try again."}</p>
        <RetryPracticeSetButton practiceSetId={practiceSetId} />
      </AlertDescription>
    </Alert>
  );
}
