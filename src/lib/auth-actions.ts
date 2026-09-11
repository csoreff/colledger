"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  hashPassword,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  signupIsOpen,
} from "@/lib/auth";
import type { ActionState } from "@/lib/actions";

const registerSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  name: z.string().nullable(),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`),
});

/**
 * Creates an account. The caller signs in separately — `signIn` is a client
 * call, so this returns rather than establishing the session itself.
 *
 * The very first account to be created becomes an ADMIN, so a fresh deployment
 * has someone who can mint admin API keys without a console. Every account
 * after that is an ordinary user.
 */
export async function registerUser(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  if (!signupIsOpen()) {
    return { error: "Registration is closed on this instance." };
  }

  const rawPassword = String(form.get("password") ?? "");
  const parsed = registerSchema.safeParse({
    email: normalizeEmail(String(form.get("email") ?? "")),
    name: String(form.get("name") ?? "").trim() || null,
    password: rawPassword,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  if (rawPassword !== String(form.get("confirmPassword") ?? "")) {
    return { error: "The two passwords do not match." };
  }

  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true },
  });
  if (existing) return { error: "An account with that email already exists." };

  const isFirstAccount = (await prisma.user.count()) === 0;

  try {
    await prisma.user.create({
      data: {
        email: parsed.data.email,
        name: parsed.data.name,
        passwordHash: await hashPassword(rawPassword),
        role: isFirstAccount ? "ADMIN" : "USER",
      },
    });
  } catch {
    // Two simultaneous registrations for the same address: the unique index
    // catches what the check above raced past.
    return { error: "An account with that email already exists." };
  }

  return { ok: true };
}
