import { createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';

/**
 * Better Auth plugin with one server-only endpoint: start a session for a user on the current
 * host, with a cookie signed by Better Auth itself (we never hand-roll session cookies).
 * Called only by IdentityService.redeemHandoff after it has verified a single-use, unexpired,
 * company-bound hand-off ticket. Better Auth's HTTP handler is not mounted, and SERVER_ONLY
 * keeps the endpoint off any HTTP router even if it ever were.
 */
export const handoffPlugin = () => ({
  id: 'erp-handoff',
  endpoints: {
    startHandoffSession: createAuthEndpoint(
      '/erp/handoff/session',
      {
        method: 'POST',
        body: z.object({ userId: z.string() }),
        metadata: { SERVER_ONLY: true },
      },
      async (ctx) => {
        const user = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
        if (!user) throw new Error('Hand-off for an unknown user');
        const session = await ctx.context.internalAdapter.createSession(user.id);
        await setSessionCookie(ctx, { session, user });
        return ctx.json({ token: session.token });
      },
    ),
  },
});
