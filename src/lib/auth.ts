/**
 * Sign-in configuration.
 *
 * Sessions are JWTs rather than database rows. On Vercel each request is a
 * cold-ish serverless invocation, and a stateless token means sign-in state
 * costs no database round trip; it also keeps the Edge middleware able to check
 * authentication without a Prisma client, which it cannot load.
 *
 * The only provider is email + password. Passwords are bcrypt hashes; an empty
 * hash means "no password set" and can never be signed into, which is what
 * keeps the placeholder account created by the multi-user migration inert.
 */
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const BCRYPT_ROUNDS = 12;

export function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

/** Minimum we'll accept when a password is set. */
export const MIN_PASSWORD_LENGTH = 10;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Public registration can be switched off once the accounts you want exist.
 * Lives here rather than beside the register action because that file is
 * `"use server"`, where every export has to be an async server action.
 */
export function signupIsOpen(): boolean {
  return (process.env.ALLOW_SIGNUP ?? "true").toLowerCase() !== "false";
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = normalizeEmail(credentials?.email ?? "");
        const password = credentials?.password ?? "";
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });

        // Compare against a dummy hash when the account is missing or has no
        // password, so a wrong email costs the same time as a wrong password
        // and the response can't be used to enumerate who has an account.
        const hash = user?.passwordHash || DUMMY_HASH;
        const matches = await bcrypt.compare(password, hash);

        if (!user || !user.passwordHash || !user.isActive || !matches) return null;

        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // `user` is only present on the sign-in request; afterwards the claims
      // ride along in the token.
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: UserRole }).role ?? "USER";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = (token.role as UserRole) ?? "USER";
      }
      return session;
    },
  },
};

/**
 * A genuine bcrypt hash of a random string nobody will ever type. It has to be
 * a real hash, not a plausible-looking one: bcrypt rejects malformed input
 * immediately, which would reintroduce exactly the timing difference this is
 * here to remove.
 */
const DUMMY_HASH = "$2a$12$MeJzioUP7S0mgdlhObvdU.wXHEI61TA2nNbr724VKhhJ.ou5ur9AO";
