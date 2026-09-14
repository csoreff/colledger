"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ApiScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/tenant";
import { createApiKeyFor } from "@/lib/api/keys";
import { generateSlug, normalizeSlug, validateSlug } from "@/lib/showcase";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/auth";
import bcrypt from "bcryptjs";
import type { ActionState } from "@/lib/actions";

/**
 * Creating a key returns the plaintext once, in the action result, and it is
 * never readable again — only its hash is stored. The page shows it until the
 * next navigation.
 */
export type KeyCreatedState = ActionState & { plaintext?: string; name?: string };

const SCOPES: ApiScope[] = ["READ", "WRITE", "ADMIN_ALL"];

const createSchema = z.object({
  name: z.string().min(1, "Give the key a name so you can recognize it later.").max(80),
  scopes: z.array(z.enum(SCOPES as [ApiScope, ...ApiScope[]])).min(1, "Choose at least one scope."),
  expiresInDays: z.number().int().positive().nullable(),
});

export async function createApiKey(
  _prev: KeyCreatedState,
  form: FormData,
): Promise<KeyCreatedState> {
  const user = await requireUser();

  const rawDays = String(form.get("expiresInDays") ?? "").trim();
  const parsed = createSchema.safeParse({
    name: String(form.get("name") ?? "").trim(),
    scopes: form.getAll("scopes").map(String),
    expiresInDays: rawDays === "" ? null : Number(rawDays),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const expiresAt = parsed.data.expiresInDays
    ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000)
    : null;

  const result = await createApiKeyFor({
    userId: user.id,
    name: parsed.data.name,
    scopes: parsed.data.scopes,
    expiresAt,
  });
  if (!result.ok) return { error: result.error };

  revalidatePath("/settings");
  return { ok: true, plaintext: result.plaintext, name: parsed.data.name };
}

/**
 * Revokes rather than deletes, so the key stays listed as revoked. A key that
 * simply vanished would leave you unable to tell a key you retired from one
 * you never created.
 */
export async function revokeApiKey(keyId: string): Promise<void> {
  const user = await requireUser();
  await prisma.apiKey.updateMany({
    where: { id: keyId, userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  revalidatePath("/settings");
}

export async function deleteApiKey(keyId: string): Promise<void> {
  const user = await requireUser();
  await prisma.apiKey.deleteMany({ where: { id: keyId, userId: user.id } });
  revalidatePath("/settings");
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/** How long a display name may be. Long enough for a real name, short enough
 *  not to break the nav bar or a showcase heading. */
const MAX_NAME_LENGTH = 60;

/**
 * Changes the display name.
 *
 * This is the name shown in the nav and used as the heading of a public
 * showcase, so it is allowed to be empty: clearing it falls back to the email
 * in the nav (private) and to the slug on the showcase (public), which is the
 * right behaviour for someone who wants a public page without a real name on
 * it.
 */
export async function updateProfile(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const raw = String(form.get("name") ?? "").trim();
  if (raw.length > MAX_NAME_LENGTH) {
    return { error: `Keep it to ${MAX_NAME_LENGTH} characters or fewer.` };
  }
  // Collapse internal whitespace so a name can't be padded out to look like
  // several, and strip control characters that would corrupt the heading.
  // eslint-disable-next-line no-control-regex
  const name = raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  await prisma.user.update({
    where: { id: user.id },
    data: { name: name || null },
  });

  revalidatePath("/settings");
  // The nav reads this name, and so does any showcase page the user publishes.
  revalidatePath("/", "layout");

  const slug = (
    await prisma.user.findUnique({ where: { id: user.id }, select: { publicSlug: true } })
  )?.publicSlug;
  if (slug) revalidatePath(`/showcase/${slug}`);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Public showcase
// ---------------------------------------------------------------------------

export type ShowcaseState = ActionState & { slug?: string; enabled?: boolean };

/**
 * Turns the public collection page on or off, and sets its address.
 *
 * Enabling without a slug mints one. Disabling keeps the slug on the account
 * rather than clearing it, so turning the page back on later restores the same
 * URL instead of silently publishing a new one — and so nobody else can claim
 * the address you have already shared while yours is switched off.
 */
export async function updateShowcase(
  _prev: ShowcaseState,
  form: FormData,
): Promise<ShowcaseState> {
  const user = await requireUser();

  // An unchecked checkbox submits nothing at all, which is what makes "off"
  // the safe default here: a malformed post turns the page off, never on.
  const enabled = form.get("publicShowcase") === "on";

  const current = await prisma.user.findUnique({
    where: { id: user.id },
    select: { publicSlug: true, name: true },
  });

  const typed = normalizeSlug(String(form.get("publicSlug") ?? ""));
  let slug = current?.publicSlug ?? null;

  if (typed) {
    const problem = validateSlug(typed);
    if (problem) return { error: problem, enabled };

    if (typed !== current?.publicSlug) {
      const taken = await prisma.user.findUnique({
        where: { publicSlug: typed },
        select: { id: true },
      });
      if (taken && taken.id !== user.id) {
        return { error: "That address is already taken. Try another.", enabled };
      }
    }
    slug = typed;
  }

  // Turning it on for the first time with nothing typed: invent an address.
  if (enabled && !slug) slug = await generateSlug(current?.name ?? null);

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { publicShowcase: enabled, publicSlug: slug },
    });
  } catch {
    // Two accounts racing for the same slug; the unique index caught what the
    // check above raced past.
    return { error: "That address was just taken. Try another.", enabled };
  }

  revalidatePath("/settings");
  if (slug) revalidatePath(`/showcase/${slug}`);
  return { ok: true, slug: slug ?? undefined, enabled };
}

const passwordSchema = z.object({
  current: z.string().min(1, "Enter your current password."),
  next: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`),
});

export async function changePassword(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const parsed = passwordSchema.safeParse({
    current: String(form.get("currentPassword") ?? ""),
    next: String(form.get("newPassword") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  if (parsed.data.next !== String(form.get("confirmPassword") ?? "")) {
    return { error: "The two new passwords do not match." };
  }

  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (!record?.passwordHash) return { error: "This account has no password set." };

  if (!(await bcrypt.compare(parsed.data.current, record.passwordHash))) {
    return { error: "That is not your current password." };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.next) },
  });

  return { ok: true };
}
