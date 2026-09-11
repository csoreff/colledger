import type { UserRole } from "@prisma/client";
import type { DefaultSession } from "next-auth";

/**
 * The session carries the user's id and role, because every query in the app
 * is filtered by that id and the API gate checks that role.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
    } & DefaultSession["user"];
  }

  interface User {
    role: UserRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
  }
}
