import { handlers } from "@/lib/auth/config";

/**
 * Endpoint 1 (plan §3.2) — the Auth.js catch-all. All behavior (magic-link
 * dispatch, redemption, session, sign-out) is Auth.js internal, configured
 * in `lib/auth/config.ts`. `pages.error = "/sign-in/error"` there covers
 * AC 4's expired/already-used error state.
 */
export const { GET, POST } = handlers;
