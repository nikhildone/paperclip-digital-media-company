import { createHash, randomBytes } from "node:crypto";
import postgres from "../packages/db/node_modules/postgres/src/index.js";

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function createInviteToken() {
  return `pcp_bootstrap_${randomBytes(24).toString("hex")}`;
}

const dbUrl = process.env.DATABASE_URL;
const baseUrl = (
  process.env.PAPERCLIP_PUBLIC_URL ||
  process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL ||
  process.env.BETTER_AUTH_URL ||
  process.env.BETTER_AUTH_BASE_URL ||
  "https://paperclip-ai-company.onrender.com"
).replace(/\/+$/, "");

if (!dbUrl) {
  console.error("[render-bootstrap-ceo] DATABASE_URL is not set; cannot create invite.");
  process.exit(0);
}

const sql = postgres(dbUrl, {
  max: 1,
  connect_timeout: 20,
  idle_timeout: 1,
  onnotice: () => {},
});

try {
  console.log("[render-bootstrap-ceo] Checking for existing instance admin...");
  const adminRows = await sql`SELECT COUNT(*)::int AS count FROM instance_user_roles WHERE role = 'instance_admin'`;
  const adminCount = Number(adminRows?.[0]?.count ?? 0);

  if (adminCount > 0) {
    console.log("[render-bootstrap-ceo] Instance already has an admin user. No invite needed.");
    process.exit(0);
  }

  console.log("[render-bootstrap-ceo] Revoking old unused bootstrap invites...");
  await sql`
    UPDATE invites
    SET revoked_at = NOW(), updated_at = NOW()
    WHERE invite_type = 'bootstrap_ceo'
      AND revoked_at IS NULL
      AND accepted_at IS NULL
      AND expires_at > NOW()
  `;

  const token = createInviteToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

  console.log("[render-bootstrap-ceo] Creating fresh bootstrap CEO invite...");
  await sql`
    INSERT INTO invites (
      invite_type,
      token_hash,
      allowed_join_types,
      expires_at,
      invited_by_user_id,
      created_at,
      updated_at
    ) VALUES (
      'bootstrap_ceo',
      ${tokenHash},
      'human',
      ${expiresAt},
      'system',
      NOW(),
      NOW()
    )
  `;

  console.log("[render-bootstrap-ceo] Created bootstrap CEO invite.");
  console.log(`[render-bootstrap-ceo] Invite URL: ${baseUrl}/invite/${token}`);
  console.log(`[render-bootstrap-ceo] Expires: ${expiresAt.toISOString()}`);
} catch (error) {
  console.error(`[render-bootstrap-ceo] Could not create bootstrap invite: ${error?.message || String(error)}`);
} finally {
  await sql.end({ timeout: 5 }).catch(() => undefined);
}
