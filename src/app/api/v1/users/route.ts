import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, apiOk, apiRoute, invalidBody, jsonBody } from "@/lib/api/http";
import { hashPassword, MIN_PASSWORD_LENGTH, normalizeEmail } from "@/lib/auth";
import { page, paging } from "@/lib/api/query";

export const dynamic = "force-dynamic";

/**
 * Account administration. ADMIN_ALL only — this is the endpoint that decides
 * which ledgers exist, so an ordinary key must not even be able to enumerate
 * them.
 */
export const GET = apiRoute("ADMIN_ALL", async ({ request }) => {
  const { limit, offset } = paging(request);

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      // Never `passwordHash`: this endpoint has no reason to emit it, and an
      // explicit select is what guarantees a later schema change can't start
      // leaking it by default.
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        _count: { select: { items: true, purchases: true, sales: true, apiKeys: true } },
      },
      orderBy: { createdAt: "asc" },
      take: limit,
      skip: offset,
    }),
    prisma.user.count(),
  ]);

  return apiOk(page(users, total, { limit, offset }));
});

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().nullish(),
  password: z.string().min(MIN_PASSWORD_LENGTH),
  role: z.enum(["USER", "ADMIN"]).default("USER"),
});

/** Creates an account, for provisioning ledgers from a script. */
export const POST = apiRoute("ADMIN_ALL", async ({ request }) => {
  const parsed = createUserSchema.safeParse(await jsonBody(request));
  if (!parsed.success) return invalidBody(parsed.error);

  const email = normalizeEmail(parsed.data.email);
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return apiError("conflict", "An account with that email already exists.");

  const user = await prisma.user.create({
    data: {
      email,
      name: parsed.data.name?.trim() || null,
      passwordHash: await hashPassword(parsed.data.password),
      role: parsed.data.role,
    },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });

  return apiOk(user, 201);
});
