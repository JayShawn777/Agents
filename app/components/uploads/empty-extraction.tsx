import Link from "next/link";
import { ImageOff } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * "We could not find any problems on this page" + retake (plan §4/§5.2,
 * F16; M1 AC 25). Server component. Rendered when an extraction's status is
 * `COMPLETE_EMPTY` — a first-class terminal state (ADR-0005), not an error.
 */
export function EmptyExtraction({ studentId }: { studentId: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border py-16 text-center">
      <ImageOff className="size-10 text-muted-foreground" aria-hidden="true" />
      <div className="flex flex-col gap-1 px-4">
        <p className="text-sm font-medium text-foreground">
          We couldn&apos;t find any problems on this page.
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">
          This can happen if the photo doesn&apos;t show any schoolwork, or
          if it&apos;s too blurry to read clearly. Try retaking the photo.
        </p>
      </div>
      <Button className="h-11" render={<Link href={`/students/${studentId}/uploads/new`} />}>
        Retake photo
      </Button>
    </div>
  );
}
