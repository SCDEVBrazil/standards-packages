import { CannotMeasure } from '../exit-codes';

/**
 * Clerk's documented E2E sign-in, ported from the WMS nav-probe: mint a short-lived single-use sign-in ticket for a
 * user from the instance's secret key. No password is ever handled. The ticket is then handed to the app's sign-in
 * page as `__clerk_ticket` (see measure.ts).
 * @param secretKey the Clerk secret key of the instance being measured (never printed)
 * @param email the user to sign in as
 * @param fetchFn injectable for tests
 * @returns the ticket
 * @throws CannotMeasure when the user does not exist or Clerk refuses — a signed-out measurement measures the
 *   sign-in page, which is worse than no measurement
 */
export async function clerkSignInTicket(
  secretKey: string,
  email: string,
  fetchFn: typeof fetch = fetch
): Promise<string> {
  const headers = { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' };
  const list = await fetchFn(
    `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}&limit=1`,
    { headers }
  );
  if (!list.ok) throw new CannotMeasure(`Clerk user lookup failed: HTTP ${list.status}`);
  const users = (await list.json()) as { id: string }[];
  const user = users[0];
  if (!user) throw new CannotMeasure(`no Clerk user ${email} on this instance`);
  const res = await fetchFn('https://api.clerk.com/v1/sign_in_tokens', {
    method: 'POST',
    headers,
    body: JSON.stringify({ user_id: user.id, expires_in_seconds: 600 }),
  });
  const body = (await res.json().catch(() => ({}))) as { token?: string };
  if (!res.ok || !body.token)
    throw new CannotMeasure(`Clerk sign-in token failed: HTTP ${res.status}`);
  return body.token;
}
