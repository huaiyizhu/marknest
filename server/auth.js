const crypto = require("node:crypto");

function adminIdentities() {
  return new Set(
    String(process.env.ADMIN_IDENTITIES || "microsoft:demo-admin")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function adminEmails() {
  return new Set(
    String(process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function decodeEasyAuthPrincipal(header) {
  if (!header) return null;
  try {
    const principal = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    const claims = Object.fromEntries((principal.claims || []).map((claim) => [claim.typ, claim.val]));
    return {
      provider: principal.auth_typ || "unknown",
      providerUserId: principal.user_id || claims.sub || claims.oid || claims[
        "http://schemas.microsoft.com/identity/claims/objectidentifier"
      ],
      name: principal.user_details || claims.name || claims.preferred_username || "Marknest User",
      email: claims.email || claims.preferred_username || null
    };
  } catch {
    return null;
  }
}

function headerValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function easyAuthHeaderPrincipal(headers) {
  const providerUserId = headerValue(headers["x-ms-client-principal-id"]);
  if (!providerUserId) return null;
  const provider = headerValue(headers["x-ms-client-principal-idp"]) || "aad";
  const name = headerValue(headers["x-ms-client-principal-name"]) || "Marknest User";
  return {
    provider,
    providerUserId,
    name,
    email: name.includes("@") ? name : null
  };
}

function devPrincipal(req) {
  if (process.env.NODE_ENV === "production") return null;
  const id = req.headers["x-dev-user-id"];
  if (!id) return null;
  const provider = req.headers["x-dev-provider"] || "microsoft";
  return {
    provider,
    providerUserId: id,
    name: req.headers["x-dev-user-name"] || `Dev ${id}`,
    email: req.headers["x-dev-user-email"] || `${id}@example.com`
  };
}

function resolvePrincipal(req) {
  const encoded = decodeEasyAuthPrincipal(req.headers["x-ms-client-principal"]);
  const headers = easyAuthHeaderPrincipal(req.headers);
  if (encoded || headers) {
    return {
      provider: encoded?.provider || headers?.provider || "unknown",
      providerUserId: encoded?.providerUserId || headers?.providerUserId,
      name: encoded?.name || headers?.name || "Marknest User",
      email: encoded?.email || headers?.email || null
    };
  }
  return devPrincipal(req);
}

function upsertUser(db, principal) {
  if (!principal?.providerUserId) return null;
  const now = new Date().toISOString();
  const identity = `${principal.provider}:${principal.providerUserId}`;
  const email = String(principal.email || "").toLowerCase();
  const role = adminIdentities().has(identity) || adminEmails().has(email) ? "admin" : "user";
  const existing = db
    .prepare("SELECT * FROM users WHERE auth_provider = ? AND provider_user_id = ?")
    .get(principal.provider, principal.providerUserId);

  if (existing) {
    db.prepare(
      `UPDATE users SET username = ?, email = ?, role = CASE WHEN role = 'admin' THEN role ELSE ? END,
       last_login_at = ?, updated_at = ? WHERE id = ?`
    ).run(principal.name, principal.email, role, now, now, existing.id);
    return db.prepare("SELECT * FROM users WHERE id = ?").get(existing.id);
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO users
      (id, username, email, auth_provider, provider_user_id, role, preferred_locale, status, last_login_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'zh-CN', 'active', ?, ?, ?)`
  ).run(id, principal.name, principal.email, principal.provider, principal.providerUserId, role, now, now, now);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function currentUser(req, db) {
  return upsertUser(db, resolvePrincipal(req));
}

function requireUser(req, db) {
  const user = currentUser(req, db);
  if (!user) {
    const error = new Error("Authentication required");
    error.status = 401;
    throw error;
  }
  if (user.status !== "active") {
    const error = new Error("Account disabled");
    error.status = 403;
    throw error;
  }
  return user;
}

function requireAdmin(req, db) {
  const user = requireUser(req, db);
  if (user.role !== "admin") {
    const error = new Error("Administrator permission required");
    error.status = 403;
    throw error;
  }
  return user;
}

module.exports = {
  currentUser,
  decodeEasyAuthPrincipal,
  easyAuthHeaderPrincipal,
  requireAdmin,
  requireUser,
  resolvePrincipal
};
