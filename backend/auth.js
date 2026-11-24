import crypto from "crypto";
import { supabase } from "./supabase.js";

export function setupAuth(app, _dataDir, asText) {
  const cookieName = "profiledesk_auth";
  const maxAge = 60 * 60 * 12;
  const pinPattern = /^[0-9]{4,8}$/;
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const usernamePattern = /^[a-zA-Z0-9._-]{3,30}$/;

  function cookies(header = "") {
    return Object.fromEntries(header.split(";").map((part) => {
      const index = part.indexOf("=");
      return index < 0 ? ["", ""] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
    }).filter(([key]) => key));
  }
  function hashPin(pin) {
    const salt = crypto.randomBytes(16).toString("hex");
    return { salt, hash: crypto.scryptSync(String(pin), salt, 64).toString("hex") };
  }
  const hashSessionToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
  async function createSession(token, userId) {
    const expiresAt = new Date(Date.now() + maxAge * 1000).toISOString();
    const { error } = await supabase.from("sessions").insert({ token_hash: hashSessionToken(token), user_id: userId, expires_at: expiresAt });
    if (error) throw error;
  }
  async function deleteSession(token) {
    if (!token) return;
    const { error } = await supabase.from("sessions").delete().eq("token_hash", hashSessionToken(token));
    if (error) throw error;
  }
  async function deleteUserSessions(userId) {
    const { error } = await supabase.from("sessions").delete().eq("user_id", userId);
    if (error) throw error;
  }
  async function verifySession(token) {
    if (!token) return null;
    const { data, error } = await supabase.from("sessions").select("user_id,expires_at").eq("token_hash", hashSessionToken(token)).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    if (new Date(data.expires_at).getTime() <= Date.now()) {
      await deleteSession(token);
      return null;
    }
    return data;
  }
  function verifyPin(pin, user) {
    try {
      const salt = user.pin_salt || user.pinSalt;
      const hash = user.pin_hash || user.pinHash;
      if (!salt || !hash) return false;
      const candidate = crypto.scryptSync(String(pin), salt, 64);
      const stored = Buffer.from(hash, "hex");
      return stored.length === candidate.length && crypto.timingSafeEqual(candidate, stored);
    } catch { return false; }
  }
  const fromDb = (row) => ({
    id: row.id, username: row.username || "", name: row.name, email: row.email,
    role: row.role, pinSalt: row.pin_salt, pinHash: row.pin_hash,
    createdAt: row.created_at, createdBy: row.created_by, updatedAt: row.updated_at
  });
  const toSafeUser = (user) => ({ id: user.id, username: user.username || "", name: user.name, email: user.email, role: user.role });
  async function getUsers() {
    const { data, error } = await supabase.from("users").select("*");
    if (error) throw error;
    return (data || []).map(fromDb);
  }
  async function requireAuth(req, res, next) {
    try {
      const bearer = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
      const token = bearer || cookies(req.headers.cookie)[cookieName];
      const session = await verifySession(token);
      if (!session) return res.status(401).json({ message: "Please log in to continue." });
      const { data, error } = await supabase.from("users").select("*").eq("id", session.user_id).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(401).json({ message: "Session is no longer valid. Please log in again." });
      req.authUser = fromDb(data);
      next();
    } catch (error) { next(error); }
  }
  function requireAdmin(req, res, next) {
    if (req.authUser?.role !== "Admin") return res.status(403).json({ message: "Only Admin can manage user accounts." });
    next();
  }
  async function provisionInitialAdmin() {
    const { count, error } = await supabase.from("users").select("id", { count: "exact", head: true });
    if (error) throw error;
    if (count > 0) return;
    const name = asText(process.env.ADMIN_NAME);
    const email = asText(process.env.ADMIN_EMAIL).toLowerCase();
    const pin = asText(process.env.ADMIN_PIN);
    if (!name || !emailPattern.test(email) || !pinPattern.test(pin)) {
      console.warn("[Auth] No users found. Set ADMIN_NAME, ADMIN_EMAIL and a 4-8 digit ADMIN_PIN in backend/.env.");
      return;
    }
    const credentials = hashPin(pin);
    const { error: insertError } = await supabase.from("users").insert({
      name, email, role: "Admin", username: null,
      pin_salt: credentials.salt, pin_hash: credentials.hash
    });
    if (insertError) throw insertError;
    console.log("[Auth] Initial Admin account provisioned in Supabase.");
  }

  app.post("/api/extension/auth/login", async (req, res, next) => {
    try {
      const role = asText(req.body?.role);
      const username = asText(req.body?.username).toLowerCase();
      const pin = asText(req.body?.pin);
      if (!["Admin", "Sub Admin"].includes(role) || !pinPattern.test(pin) ||
          (role === "Sub Admin" && !usernamePattern.test(username))) {
        return res.status(400).json({ message: role === "Admin"
          ? "Select Admin and enter your 4-8 digit PIN."
          : "Enter a valid Sub Admin user name and 4-8 digit PIN." });
      }
      const users = await getUsers();
      const user = users.find((item) => item.role === role &&
        (role === "Admin" || item.username?.toLowerCase() === username) && verifyPin(pin, item));
      if (!user) return res.status(401).json({ message: role === "Admin" ? "Incorrect Admin PIN." : "Incorrect user name, role or PIN." });
      const token = crypto.randomBytes(32).toString("hex");
      await createSession(token, user.id);
      res.json({ authenticated: true, token, user: toSafeUser(user) });
    } catch (error) { next(error); }
  });

  app.post("/api/extension/auth/logout", async (req, res, next) => {
    const token = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    try { await deleteSession(token); res.json({ success: true }); }
    catch (error) { next(error); }
  });

  app.post("/api/auth/login", async (req, res, next) => {
    try {
      const role = asText(req.body?.role);
      const username = asText(req.body?.username).toLowerCase();
      const pin = asText(req.body?.pin);
      if (!["Admin", "Sub Admin", "Employee"].includes(role) || !pinPattern.test(pin) ||
          (role !== "Admin" && !usernamePattern.test(username))) {
        return res.status(400).json({ message: role === "Admin"
          ? "Select Admin and enter your 4-8 digit PIN."
          : "Enter a valid user name, select a role and enter your 4-8 digit PIN." });
      }
      const users = await getUsers();
      const user = users.find((item) => item.role === role &&
        (role === "Admin" || item.username?.toLowerCase() === username) && verifyPin(pin, item));
      if (!user) return res.status(401).json({ message: role === "Admin" ? "Incorrect Admin PIN." : "Incorrect user name, role or PIN." });
      const token = crypto.randomBytes(32).toString("hex");
      await createSession(token, user.id);
      const secure = process.env.NODE_ENV === "production";
      res.setHeader("Set-Cookie", cookieName + "=" + encodeURIComponent(token) + "; HttpOnly; Path=/; Max-Age=" + maxAge + "; SameSite=" + (secure ? "None; Secure" : "Lax"));
      res.json({ authenticated: true, user: toSafeUser(user) });
    } catch (error) { next(error); }
  });

  app.get("/api/auth/me", requireAuth, (req, res) => res.json({ authenticated: true, user: toSafeUser(req.authUser) }));
  app.post("/api/auth/logout", async (req, res, next) => {
    const bearer = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
    const token = bearer || cookies(req.headers.cookie)[cookieName];
    try {
      await deleteSession(token);
      const sameSite = process.env.COOKIE_CROSS_SITE === "true" ? "None; Secure" : "Lax" + (process.env.NODE_ENV === "production" ? "; Secure" : "");
      res.setHeader("Set-Cookie", cookieName + "=; HttpOnly; Path=/; Max-Age=0; SameSite=" + sameSite);
      res.json({ success: true });
    } catch (error) { next(error); }
  });

  app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res, next) => {
    try { res.json((await getUsers()).map(toSafeUser)); }
    catch (error) { next(error); }
  });

  app.post("/api/admin/users", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const username = asText(req.body?.username).toLowerCase();
      const name = asText(req.body?.name);
      const email = asText(req.body?.email).toLowerCase();
      const pin = asText(req.body?.pin);
      const role = asText(req.body?.role);
      if (!usernamePattern.test(username) || !name || !emailPattern.test(email) || !pinPattern.test(pin) || !["Sub Admin", "Employee"].includes(role)) {
        return res.status(400).json({ message: "Enter a valid user name, name, email, 4-8 digit PIN and select Sub Admin or Employee." });
      }
      const users = await getUsers();
      if (users.some((item) => item.username?.toLowerCase() === username)) return res.status(409).json({ message: "This user name is already taken. Choose another user name." });
      if (users.some((item) => item.email.toLowerCase() === email)) return res.status(409).json({ message: "An account with this email already exists." });
      if (users.some((item) => item.role === role && verifyPin(pin, item))) return res.status(409).json({ message: "This PIN is already assigned to another user with the same role. Choose a unique PIN." });
      const credentials = hashPin(pin);
      const { data, error } = await supabase.from("users").insert({
        username, name, email, role, pin_salt: credentials.salt, pin_hash: credentials.hash, created_by: req.authUser.id
      }).select("*").single();
      if (error) {
        if (error.code === "23505") return res.status(409).json({ message: "User name or email already exists." });
        throw error;
      }
      res.status(201).json({ success: true, user: toSafeUser(fromDb(data)) });
    } catch (error) { next(error); }
  });

  app.put("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const { data: existingRow, error: fetchError } = await supabase.from("users").select("*").eq("id", req.params.id).maybeSingle();
      if (fetchError) throw fetchError;
      if (!existingRow) return res.status(404).json({ message: "Account not found." });
      const existing = fromDb(existingRow);
      if (existing.role === "Admin") return res.status(403).json({ message: "Admin account cannot be edited here." });
      const username = asText(req.body?.username).toLowerCase();
      const name = asText(req.body?.name);
      const email = asText(req.body?.email).toLowerCase();
      const role = asText(req.body?.role);
      const pin = asText(req.body?.pin);
      if (!usernamePattern.test(username) || !name || !emailPattern.test(email) || !["Sub Admin", "Employee"].includes(role)) {
        return res.status(400).json({ message: "Enter a valid user name, name, email and select Sub Admin or Employee." });
      }
      const users = await getUsers();
      if (users.some((item) => item.id !== existing.id && item.username?.toLowerCase() === username)) return res.status(409).json({ message: "This user name is already taken. Choose another user name." });
      if (users.some((item) => item.id !== existing.id && item.email.toLowerCase() === email)) return res.status(409).json({ message: "An account with this email already exists." });
      if (role !== existing.role && !pin) return res.status(400).json({ message: "Enter a new PIN when changing the account role." });
      if (pin && !pinPattern.test(pin)) return res.status(400).json({ message: "PIN must contain 4-8 digits." });
      if (pin && users.some((item) => item.id !== existing.id && item.role === role && verifyPin(pin, item))) return res.status(409).json({ message: "This PIN is already assigned to another user with the same role. Choose a unique PIN." });
      const updates = { username, name, email, role, updated_at: new Date().toISOString() };
      if (pin) {
        const credentials = hashPin(pin);
        updates.pin_salt = credentials.salt;
        updates.pin_hash = credentials.hash;
      }
      const { data, error } = await supabase.from("users").update(updates).eq("id", existing.id).select("*").single();
      if (error) {
        if (error.code === "23505") return res.status(409).json({ message: "User name or email already exists." });
        throw error;
      }
      res.json({ success: true, user: toSafeUser(fromDb(data)) });
    } catch (error) { next(error); }
  });

  app.delete("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      if (req.params.id === req.authUser.id) return res.status(400).json({ message: "You cannot delete your own account." });
      const { data: target, error: fetchError } = await supabase.from("users").select("id,role").eq("id", req.params.id).maybeSingle();
      if (fetchError) throw fetchError;
      if (!target) return res.status(404).json({ message: "Account not found." });
      if (target.role === "Admin") return res.status(403).json({ message: "Admin account cannot be deleted here." });
      const { error } = await supabase.from("users").delete().eq("id", target.id);
      if (error) throw error;
      await deleteUserSessions(target.id);
      res.json({ success: true, message: "Account deleted successfully." });
    } catch (error) { next(error); }
  });

  return { requireAuth, requireAdmin, provisionInitialAdmin };
}
