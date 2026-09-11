/**
 * Who the current request is acting as.
 *
 * Every page and server action funnels through `requireUser()`, and every query
 * filters on the id it returns. The rule the rest of the codebase relies on:
 * a read is `where: { userId }`, and a write that targets one row by id is
 * `where: { id, userId }` via `updateMany`/`deleteMany` rather than
 * `update`/`delete`. The latter matters — `update({ where: { id } })` would
 * happily modify a row belonging to someone else if an id were guessed, and
 * Prisma will not let a compound filter into a plain `update`.
 */
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { authOptions } from "@/lib/auth";

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
};

/** The signed-in user, or null when the request is anonymous. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? null,
    role: session.user.role ?? "USER",
  };
}

/**
 * The signed-in user, redirecting to the login page when there isn't one.
 *
 * Middleware already turns anonymous traffic away, so reaching the redirect
 * here means a session expired mid-visit. Doing the check again rather than
 * trusting middleware keeps every data-touching entry point safe on its own.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** True when this user may act on other people's ledgers. */
export function isAdmin(user: { role: UserRole }): boolean {
  return user.role === "ADMIN";
}
