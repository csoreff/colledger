/**
 * The shared shape of every `/api/v1` response, and the gate every route goes
 * through to get there.
 *
 * Errors are always `{ error: { code, message, details? } }` with a machine
 * -readable `code`, because the main consumer of this API is a script pushing
 * data in, and a script needs to branch on failure without parsing prose.
 */
import { NextResponse } from "next/server";
import type { ApiScope, UserRole } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyApiKey, type KeyFailure } from "@/lib/api/keys";

export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "conflict"
  | "server_error";

const STATUS_FOR: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 422,
  conflict: 409,
  server_error: 500,
};

export function apiError(
  code: ErrorCode,
  message: string,
  details?: unknown,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status: STATUS_FOR[code] },
  );
}

export function apiOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data as object, { status });
}

/** Flattens a Zod failure into something a caller can act on field by field. */
export function invalidBody(error: ZodError): NextResponse {
  return apiError(
    "invalid_request",
    error.issues[0]?.message ?? "Invalid request body.",
    error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  );
}

/**
 * Who a request is acting as.
 *
 * `actor` is the key's owner. `targetUserId` is the ledger being read or
 * written, which is the actor's own unless an admin key named someone else.
 * Routes only ever use `targetUserId` — that single field is what keeps an
 * ordinary key inside its own data.
 */
export type Principal = {
  keyId: string;
  actorId: string;
  actorEmail: string;
  actorRole: UserRole;
  scopes: ApiScope[];
  targetUserId: string;
  /** True when an admin key is acting on someone else's ledger. */
  isImpersonating: boolean;
};

const FAILURE_MESSAGE: Record<KeyFailure, string> = {
  malformed: "Provide an API key as `Authorization: Bearer cl_…` or `X-API-Key`.",
  unknown: "That API key is not valid.",
  revoked: "That API key has been revoked.",
  expired: "That API key has expired.",
  user_disabled: "The account that owns this key is disabled.",
};

function presentedKey(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (bearer) return bearer[1].trim();
  return (request.headers.get("x-api-key") ?? "").trim();
}

/**
 * Resolves which ledger the request should act on.
 *
 * A key acts on its owner's data by default. An admin key may name another
 * account with `X-Ledger-User` (an id or an email) or the `userId` /
 * `userEmail` query parameters — that is what makes one admin key able to seed
 * or query every user's ledger from a remote script.
 */
async function resolveTarget(
  request: Request,
  actorId: string,
  scopes: ApiScope[],
): Promise<
  | { ok: true; targetUserId: string; isImpersonating: boolean }
  | { ok: false; response: NextResponse }
> {
  const url = new URL(request.url);
  const named =
    request.headers.get("x-ledger-user")?.trim() ||
    url.searchParams.get("userId")?.trim() ||
    url.searchParams.get("userEmail")?.trim() ||
    "";

  if (!named) return { ok: true, targetUserId: actorId, isImpersonating: false };

  const target = await prisma.user.findFirst({
    where: named.includes("@")
      ? { email: named.toLowerCase() }
      : { id: named },
    select: { id: true, isActive: true },
  });

  // Naming yourself is harmless and needs no special scope.
  if (target?.id === actorId) {
    return { ok: true, targetUserId: actorId, isImpersonating: false };
  }

  if (!scopes.includes("ADMIN_ALL")) {
    return {
      ok: false,
      response: apiError(
        "forbidden",
        "This key may only act on its own account. Acting on another user requires a key with the ADMIN_ALL scope.",
      ),
    };
  }

  // Checked only after the scope test, so a key without ADMIN_ALL can't use
  // the difference between 404 and 403 to find out which accounts exist.
  if (!target) return { ok: false, response: apiError("not_found", `No user matching "${named}".`) };
  if (!target.isActive) {
    return { ok: false, response: apiError("forbidden", "That account is disabled.") };
  }

  return { ok: true, targetUserId: target.id, isImpersonating: true };
}

export type RouteContext<P = Record<string, string>> = {
  request: Request;
  principal: Principal;
  params: P;
};

/**
 * Wraps a route handler with key authentication and scope checking.
 *
 * Handlers receive a `principal` whose `targetUserId` is already resolved, so
 * a route body is just the query — it never repeats the auth reasoning and
 * cannot forget to.
 */
export function apiRoute<P = Record<string, string>>(
  required: ApiScope,
  handler: (context: RouteContext<P>) => Promise<NextResponse>,
) {
  return async (request: Request, context: { params: P }): Promise<NextResponse> => {
    try {
      const presented = presentedKey(request);
      const verified = await verifyApiKey(presented);
      if (!verified.ok) {
        return apiError("unauthorized", FAILURE_MESSAGE[verified.reason]);
      }

      const { key } = verified;
      const scopes = key.scopes;

      // WRITE implies READ: a key that can change the ledger can obviously see
      // it, and making callers request both would be noise.
      const satisfied =
        scopes.includes(required) ||
        (required === "READ" && (scopes.includes("WRITE") || scopes.includes("ADMIN_ALL"))) ||
        (required === "WRITE" && scopes.includes("ADMIN_ALL"));

      if (!satisfied) {
        return apiError(
          "forbidden",
          `This key is missing the ${required} scope (it has: ${scopes.join(", ") || "none"}).`,
        );
      }

      const target = await resolveTarget(request, key.userId, scopes);
      if (!target.ok) return target.response;

      return await handler({
        request,
        params: context?.params ?? ({} as P),
        principal: {
          keyId: key.id,
          actorId: key.userId,
          actorEmail: key.user.email,
          actorRole: key.user.role,
          scopes,
          targetUserId: target.targetUserId,
          isImpersonating: target.isImpersonating,
        },
      });
    } catch (error) {
      if (error instanceof ZodError) return invalidBody(error);
      if (error instanceof SyntaxError) {
        return apiError("invalid_request", "Request body is not valid JSON.");
      }
      console.error("[api/v1]", error);
      return apiError("server_error", "Something went wrong handling that request.");
    }
  };
}

/** Parses a JSON body, giving a clean 422 rather than a stack trace. */
export async function jsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  return JSON.parse(text);
}
