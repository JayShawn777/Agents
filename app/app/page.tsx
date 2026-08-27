import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/**
 * The public landing page (plan §4: "app/page.tsx server landing; link to
 * /sign-in"). `proxy.ts` lists `/` as a public path, so this is the first
 * thing a signed-out visitor sees — including a parent deciding whether to
 * trust this product with information about their child, before an account
 * exists. Replaces the create-next-app starter.
 *
 * Server component: no interactivity here, just links.
 */

export const metadata: Metadata = {
  // No `title` override: the root layout's default IS this page's title
  // (`app/layout.tsx`'s `metadata.title.default`), so this segment doesn't
  // duplicate it through the "%s | Homework Helper" template.
  description:
    "Upload a photo of your child's homework and get step-by-step tutoring, with parental consent required before anything about a child is collected.",
};

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-8 px-4 py-24 text-center sm:px-6">
        <div className="flex flex-col items-center gap-4">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Homework help that starts with your permission
          </h1>
          <p className="max-w-xl text-base text-muted-foreground">
            Snap a photo of a worksheet and get patient, step-by-step
            tutoring. Because this app is built for students, we tell you
            exactly what we&apos;ll collect and ask a parent to verifiably
            consent before we ever collect anything about a child.
          </p>
        </div>

        <Button
          size="lg"
          render={<Link href="/sign-in" className="h-11 px-6 text-base" />}
        >
          Get started
        </Button>

        <p className="text-sm text-muted-foreground">
          Already trusted with your family&apos;s information? Read how we
          handle it in our{" "}
          <Link
            href="/privacy"
            className="underline underline-offset-4 hover:text-foreground"
          >
            privacy policy
          </Link>{" "}
          and our{" "}
          <Link
            href="/retention"
            className="underline underline-offset-4 hover:text-foreground"
          >
            data retention policy
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
