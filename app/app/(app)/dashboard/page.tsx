import type { Metadata } from "next";
import Link from "next/link";
import { UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StudentCard } from "@/components/students/student-card";
import { requireUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { toStudentProfileDTO } from "@/lib/students/dto";

/**
 * The dashboard (plan §4/§5.2, F6; M0 AC 7, 33). `requireUser()` redirects a
 * signed-out visitor to `/sign-in` (AC 1); every profile is loaded scoped by
 * `userId`, so account B's rows can never appear here (AC 32/33).
 *
 * There is no list endpoint in the API contract (plan §3.2 has no
 * `GET /api/students`) — a dashboard listing is a page-level query, exactly
 * like `requireStudentProfile` in `lib/auth/dal.ts` scopes a single lookup.
 * `toStudentProfileDTO` (`lib/students/dto.ts`) is reused as-is: it is
 * documented as "the only mapping function for this shape," and a list view
 * needs the exact same `nextStep` derivation a single-profile fetch does.
 */

export const metadata: Metadata = {
  title: "Your students",
};

export default async function DashboardPage() {
  const { userId } = await requireUser();

  const profiles = await db.studentProfile.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    // Only existence is needed for `nextStep`'s NOTICE vs CONSENT branch —
    // never the notice content itself.
    include: { notices: { select: { id: true }, take: 1 } },
  });

  const students = profiles.map((profile) =>
    toStudentProfileDTO(profile, { hasNotice: profile.notices.length > 0 }),
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Your students
        </h1>
        {students.length > 0 ? (
          <Button
            className="h-11 gap-2 px-4"
            render={<Link href="/students/new" />}
          >
            <UserPlus className="size-4" />
            Add a student
          </Button>
        ) : null}
      </div>

      {students.length === 0 ? (
        // AC 7: zero profiles, and an "add a student" call to action.
        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border py-20 text-center">
          <p className="max-w-xs text-sm text-muted-foreground">
            You haven&apos;t added a student yet. Add one to get started.
          </p>
          <Button className="h-11 gap-2 px-4" render={<Link href="/students/new" />}>
            <UserPlus className="size-4" />
            Add your first student
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {students.map((student) => (
            <StudentCard key={student.id} student={student} />
          ))}
        </div>
      )}
    </div>
  );
}
