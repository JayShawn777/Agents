import Link from "next/link";

import { auth } from "@/lib/auth/config";
import { UserMenu } from "@/components/nav/user-menu";

/**
 * The in-app nav shell (plan §4, F4). Wraps every route under
 * `app/(app)/**`.
 *
 * Deliberately does NOT gate access: this Next.js version's layouts do not
 * re-render on navigation and do not control whether their children render
 * (see the framework's layout caveats), so an auth check here would be
 * decorative, not a boundary. Every page under this segment calls the DAL
 * itself (`requireUser`, `requireStudentProfile`, etc., `lib/auth/dal.ts`)
 * and redirects on its own.
 *
 * `auth()` IS called here, but only to read `session.user.email` for
 * display in `UserMenu` — never to gate anything. `lib/auth/config.ts`'s
 * `callbacks.session` returns exactly `{ user: { id, email }, expires }`
 * (`lib/auth/session-shape.ts`), so this is a safe, legitimate source for a
 * server component. This file never reads `@/lib/db` directly.
 *
 * The sign-in flow (`app/(auth)/**`) and the public consent flow
 * (`app/(public)/consent/**`) live outside this route group on purpose and
 * carry no app chrome (per the design reference: onboarding screens are
 * chrome-free).
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 sm:px-6">
        {/* Placeholder brand text — no product name has been decided yet. */}
        <Link
          href="/dashboard"
          className="text-sm font-semibold tracking-tight text-foreground"
        >
          Homework Helper
        </Link>
        <UserMenu email={session?.user?.email ?? null} />
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
