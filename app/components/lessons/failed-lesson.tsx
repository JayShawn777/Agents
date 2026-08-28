import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RegenerateLessonButton } from "@/components/lessons/regenerate-lesson-button";

/**
 * AC 10: a plain message and a retry, and nothing else.
 *
 * `failureMessage` is already the allowlisted string chosen server-side
 * (`LESSON_FAILURE_MESSAGES`) — no stack trace, model identifier or provider
 * payload reaches this far, so this component neither sanitises nor needs to.
 *
 * The retry is genuinely load-bearing rather than decorative: the §9.2
 * measurement had a transient upstream error kill 1 of 6 authoring runs at
 * `maxRetries: 0`, and re-running it unchanged succeeded.
 *
 * Server component; the mutation is delegated to the client leaf.
 */
export function FailedLesson({
  lessonId,
  failureMessage,
  atVersionCap,
}: {
  lessonId: string;
  failureMessage: string | null;
  atVersionCap: boolean;
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>We couldn&apos;t draw this lesson</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <p>{failureMessage ?? "Something went wrong. Please try again."}</p>
        {atVersionCap ? (
          <p className="text-sm">
            We&apos;ve tried this a few times now. Ask the tutor about this problem instead — it can talk it
            through with you.
          </p>
        ) : (
          <RegenerateLessonButton lessonId={lessonId} label="Try again" />
        )}
      </AlertDescription>
    </Alert>
  );
}
