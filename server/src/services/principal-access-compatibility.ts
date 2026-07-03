import { and, eq, notInArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, companyMemberships, principalPermissionGrants } from "@paperclipai/db";
import type { PermissionKey, PrincipalType } from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { grantsForHumanRole, normalizeHumanRole } from "./company-member-roles.js";

type GrantInput = {
  permissionKey: PermissionKey;
  scope?: Record<string, unknown> | null;
};

export type PrincipalAccessCompatibilityBackfillStats = {
  agentMembershipsInserted: number;
  humanGrantsInserted: number;
};

function isStatementTimeout(error: unknown): boolean {
  const err = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (err?.code === "57014") return true;
  if (typeof err?.message === "string" && /statement timeout|canceling statement/i.test(err.message)) return true;
  return Boolean(err?.cause && isStatementTimeout(err.cause));
}

export async function insertMissingPrincipalGrants(
  db: Db,
  input: {
    companyId: string;
    principalType: PrincipalType;
    principalId: string;
    grants: GrantInput[];
    grantedByUserId: string | null;
  },
): Promise<number> {
  if (input.grants.length === 0) return 0;

  const now = new Date();
  const inserted = await db
    .insert(principalPermissionGrants)
    .values(
      input.grants.map((grant) => ({
        companyId: input.companyId,
        principalType: input.principalType,
        principalId: input.principalId,
        permissionKey: grant.permissionKey,
        scope: grant.scope ?? null,
        grantedByUserId: input.grantedByUserId,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing({
      target: [
        principalPermissionGrants.companyId,
        principalPermissionGrants.principalType,
        principalPermissionGrants.principalId,
        principalPermissionGrants.permissionKey,
      ],
    })
    .returning({ id: principalPermissionGrants.id });

  return inserted.length;
}

export async function ensureHumanRoleDefaultGrants(
  db: Db,
  input: {
    companyId: string;
    principalId: string;
    membershipRole: string | null | undefined;
    grantedByUserId: string | null;
  },
): Promise<number> {
  const role = normalizeHumanRole(input.membershipRole, "operator");
  return insertMissingPrincipalGrants(db, {
    companyId: input.companyId,
    principalType: "user",
    principalId: input.principalId,
    grants: grantsForHumanRole(role),
    grantedByUserId: input.grantedByUserId,
  });
}

async function runPrincipalAccessCompatibilityBackfill(
  db: Db,
): Promise<PrincipalAccessCompatibilityBackfillStats> {
  const now = new Date();
  const nonTerminalAgents = await db
    .select({
      companyId: agents.companyId,
      principalId: agents.id,
    })
    .from(agents)
    .where(notInArray(agents.status, ["pending_approval", "terminated"]));

  const agentMembershipsInserted = nonTerminalAgents.length > 0
    ? await db
      .insert(companyMemberships)
      .values(
        nonTerminalAgents.map((agent) => ({
          companyId: agent.companyId,
          principalType: "agent",
          principalId: agent.principalId,
          status: "active",
          membershipRole: "member",
          createdAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoNothing({
        target: [
          companyMemberships.companyId,
          companyMemberships.principalType,
          companyMemberships.principalId,
        ],
      })
      .returning({ id: companyMemberships.id })
      .then((rows) => rows.length)
    : 0;

  const activeHumanMemberships = await db
    .select({
      companyId: companyMemberships.companyId,
      principalId: companyMemberships.principalId,
      membershipRole: companyMemberships.membershipRole,
    })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.principalType, "user"),
        eq(companyMemberships.status, "active"),
      ),
    );

  let humanGrantsInserted = 0;
  for (const membership of activeHumanMemberships) {
    try {
      humanGrantsInserted += await ensureHumanRoleDefaultGrants(db, {
        companyId: membership.companyId,
        principalId: membership.principalId,
        membershipRole: membership.membershipRole,
        grantedByUserId: null,
      });
    } catch (error) {
      if (isStatementTimeout(error)) {
        logger.warn({ err: error }, "Skipping remaining human principal grant backfill because PostgreSQL statement timed out");
        break;
      }
      throw error;
    }
  }

  return {
    agentMembershipsInserted,
    humanGrantsInserted,
  };
}

export async function backfillPrincipalAccessCompatibility(
  db: Db,
): Promise<PrincipalAccessCompatibilityBackfillStats> {
  if (process.env.PAPERCLIP_RUN_STARTUP_ACCESS_BACKFILL !== "true") {
    logger.info("Skipped startup access compatibility backfill for faster cloud startup");
    return { agentMembershipsInserted: 0, humanGrantsInserted: 0 };
  }

  try {
    return await runPrincipalAccessCompatibilityBackfill(db);
  } catch (error) {
    if (isStatementTimeout(error)) {
      logger.warn(
        { err: error },
        "Skipping principal access compatibility startup backfill because PostgreSQL statement timed out",
      );
      return { agentMembershipsInserted: 0, humanGrantsInserted: 0 };
    }
    throw error;
  }
}
