import type { Auth } from "@ashbot/auth";
import type { Role } from "@ashbot/contracts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type SessionUser = { id: string; name: string; email: string; role: Role };

export async function sessionUser(auth: Auth, headers: Headers): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const { id, name, email, role } = session.user;
  return { id, name, email, role: role === "admin" ? "admin" : "user" };
}

export function requireUser(user: SessionUser | null): SessionUser {
  if (!user) throw new ApiError(401, "Sign in to continue.");
  return user;
}

export function requireAdmin(user: SessionUser | null): SessionUser {
  const signedIn = requireUser(user);
  if (signedIn.role !== "admin") throw new ApiError(403, "Only admins can do that.");
  return signedIn;
}
