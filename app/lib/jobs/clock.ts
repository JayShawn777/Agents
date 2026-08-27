import "server-only";

/**
 * Every job in `lib/jobs/*.ts` takes a `Clock` instead of calling
 * `new Date()` itself (plan B22: "so they are unit-testable with a fake
 * and a frozen time"). A test passes `() => FIXED_DATE`; every cron route
 * (B23) passes `systemClock`.
 *
 * Kept this narrow (a zero-arg function returning the current instant)
 * rather than an injected class/service, because every window computation
 * in these jobs needs exactly one thing: "what time is it right now".
 */
export type Clock = () => Date;

/** The real clock. The only place `new Date()` may appear for "now" in a cron route. */
export const systemClock: Clock = () => new Date();
