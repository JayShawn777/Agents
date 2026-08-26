import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * OPTIMISTIC cookie-presence redirect only (ADR-0002). This is a UX
 * shortcut, never the authorization boundary — Next's own guidance says
 * proxy "should not be your only line of defense," and it can be deployed
 * to the CDN separately from render code. The real boundary is
 * `lib/auth/dal.ts` (B4): every page and route handler resolves its own
 * session/ownership independently of anything decided here.
 *
 * Cookie names match Auth.js v5's defaults for the database session
 * strategy: `authjs.session-token` over HTTP (dev), `__Secure-authjs.session-token`
 * over HTTPS (production).
 */
const SESSION_COOKIE_NAMES = ["authjs.session-token", "__Secure-authjs.session-token"];

/**
 * Routes that must stay reachable with no session cookie present. The
 * matcher below already excludes `/api/*`, `/retention`, `/privacy` and
 * `/consent/*` at the routing layer; `/sign-in` and its sub-pages need the
 * same treatment here (inside the function, not the matcher) because they
 * are the ONLY auth-required-app pages a signed-out visitor must reach —
 * excluding them from the matcher entirely would also skip proxy for
 * anything nested under them in the future.
 */
const PUBLIC_PATHS = new Set(["/", "/sign-in", "/sign-in/sent", "/sign-in/error"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const hasSessionCookie = SESSION_COOKIE_NAMES.some((name) => request.cookies.has(name));
  if (!hasSessionCookie) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match everything except:
     * - _next/static, _next/image (Next internals and static assets)
     * - favicon.ico and other root metadata files
     * - api/* (route handlers do their own auth; see lib/api/handler.ts)
     * - retention, privacy (public pages, AC 44)
     * - consent/* (the public, session-free consent-verification pages, ADR-0008 §5)
     */
    "/((?!_next/static|_next/image|favicon.ico|api|retention|privacy|consent).*)",
  ],
};
