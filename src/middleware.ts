/**
 * Turns anonymous traffic away before it reaches a page.
 *
 * This runs on the Edge runtime, so it can only verify the session JWT — no
 * database, no Prisma. It is a coarse gate, not the authorization story: the
 * per-user filtering that actually keeps ledgers apart lives in the pages and
 * actions themselves (see `src/lib/tenant.ts`).
 */
import { withAuth } from "next-auth/middleware";

// The sign-in page has to be named here as well as in `authOptions`: middleware
// runs before the app does and never sees that config, so without this an
// unauthenticated visit lands on NextAuth's own built-in page instead of ours.
export default withAuth({ pages: { signIn: "/login" } });

export const config = {
  matcher: [
    /*
     * Everything except:
     *   api/auth  — sign-in itself
     *   api/v1    — the REST API, which authenticates with its own API keys
     *   login, register — reachable while signed out
     *   _next, favicon, fonts — static assets
     */
    "/((?!api/auth|api/v1|login|register|_next/static|_next/image|favicon.ico|fonts).*)",
  ],
};
