import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export function setupAuth(app, dataDir, asText) {
  const usersFile = path.join(dataDir, "users.json");
  const cookieName = "profiledesk_auth";
  const maxAge = 60 * 60 * 12;
  const sessions = new Map();
  const pinPattern = new RegExp("^[0-9]{4,8}$");
  const emailPattern = new RegExp("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");

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
  function verifyPin(pin, user) {
    const candidate = crypto.scryptSync(String(pin), user.pinSalt, 64);
    const stored = Buffer.from(user.pinHash, "hex");
    return stored.length === candidate.length && crypto.timingSafeEqual(candidate, stored);
  }
  async function readUsers() {
    try {
      const data = JSON.parse(await fs.readFile(usersFile, "utf8"));
      return Array.isArray(data) ? data : [];
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }
  async function writeUsers(users) {
    await fs.mkdir(dataDir, { recursive: true });
    const temp = usersFile + ".tmp";
    await fs.writeFile(temp, JSON.stringify(users, null, 2), { mode: 0o600 });
    await fs.rename(temp, usersFile);
  }
  const safeUser = (user) => ({ id: user.id, name: user.name, email: user.email, role: user.role });

  async function requireAuth(req, res, next) {
    try {
      const token = cookies(req.headers.cookie)[cookieName];
      const session = token ? sessions.get(token) : null;
      if (!session || session.expiresAt < Date.now()) {
        if (token) sessions.delete(token);
        return res.status(401).json({ message: "Please log in to continue." });
      }
      const user = (await readUsers()).find((item) => item.id === session.userId);
      if (!user) return res.status(401).json({ message: "Session is no longer valid. Please log in again." });
      req.authUser = user;
      next();
    } catch (error) { next(error); }
  }
  function requireAdmin(req, res, next) {
    if (req.authUser?.role !== "Admin") return res.status(403).json({ message: "Only Admin can manage user accounts." });
    next();
  }
  async function provisionInitialAdmin() {
    const users = await readUsers();
    if (users.length) return;
    const name = asText(process.env.ADMIN_NAME);
    const email = asText(process.env.ADMIN_EMAIL).toLowerCase();
    const pin = asText(process.env.ADMIN_PIN);
    if (!name || !email || !pinPattern.test(pin)) {
      console.warn("[Auth] No users found. Set ADMIN_NAME, ADMIN_EMAIL and a 4-8 digit ADMIN_PIN in backend/.env.");
      return;
    }
    const credentials = hashPin(pin);
    users.push({ id: crypto.randomUUID(), name, email, role: "Admin", pinSalt: credentials.salt, pinHash: credentials.hash, createdAt: new Date().toISOString() });
    await writeUsers(users);
    console.log("[Auth] Initial Admin account provisioned.");
  }

  app.post("/api/auth/login", async (req, res, next) => {
    try {
      const role = asText(req.body?.role);
      const pin = asText(req.body?.pin);
      if (!["Admin", "Sub Admin", "Employee"].includes(role) || !pinPattern.test(pin)) {
        return res.status(400).json({ message: "Select a valid role and enter your 4-8 digit PIN." });
      }
      const user = (await readUsers()).find((item) => item.role === role && verifyPin(pin, item));
      if (!user) return res.status(401).json({ message: "Incorrect role or PIN." });
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, { userId: user.id, expiresAt: Date.now() + maxAge * 1000 });
      const secure = process.env.NODE_ENV === "production";
      res.setHeader("Set-Cookie", cookieName + "=" + encodeURIComponent(token) + "; HttpOnly; Path=/; Max-Age=" + maxAge + "; SameSite=" + (secure ? "None; Secure" : "Lax"));
      res.json({ authenticated: true, user: safeUser(user) });
    } catch (error) { next(error); }
  });

  app.get("/api/auth/me", requireAuth, (req, res) => res.json({ authenticated: true, user: safeUser(req.authUser) }));
  app.post("/api/auth/logout", (req, res) => {
    const token = cookies(req.headers.cookie)[cookieName];
    if (token) sessions.delete(token);
    const sameSite = process.env.NODE_ENV === "production" ? "None; Secure" : "Lax";
    res.setHeader("Set-Cookie", cookieName + "=; HttpOnly; Path=/; Max-Age=0; SameSite=" + sameSite);
    res.json({ success: true });
  });

  app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res, next) => {
    try { res.json((await readUsers()).map(safeUser)); }
    catch (error) { next(error); }
  });

  app.post("/api/admin/users", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const name = asText(req.body?.name);
      const email = asText(req.body?.email).toLowerCase();
      const pin = asText(req.body?.pin);
      const role = asText(req.body?.role);
      if (!name || !emailPattern.test(email) || !pinPattern.test(pin) || !["Sub Admin", "Employee"].includes(role)) {
        return res.status(400).json({ message: "Enter a name, valid email, 4-8 digit PIN and select Sub Admin or Employee." });
      }
      const users = await readUsers();
      if (users.some((item) => item.email.toLowerCase() === email)) return res.status(409).json({ message: "An account with this email already exists." });
      if (users.some((item) => item.role === role && verifyPin(pin, item))) return res.status(409).json({ message: "This PIN is already assigned to another user with the same role. Choose a unique PIN." });
      const credentials = hashPin(pin);
      const user = { id: crypto.randomUUID(), name, email, role, pinSalt: credentials.salt, pinHash: credentials.hash, createdAt: new Date().toISOString(), createdBy: req.authUser.id };
      users.push(user);
      await writeUsers(users);
      res.status(201).json({ success: true, user: safeUser(user) });
    } catch (error) { next(error); }
  });

  app.put("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const users = await readUsers();
      const index = users.findIndex((item) => item.id === req.params.id);
      if (index < 0) return res.status(404).json({ message: "Account not found." });
      const existing = users[index];
      if (existing.role === "Admin") return res.status(403).json({ message: "Admin account cannot be edited here." });

      const name = asText(req.body?.name);
      const email = asText(req.body?.email).toLowerCase();
      const role = asText(req.body?.role);
      const pin = asText(req.body?.pin);
      if (!name || !emailPattern.test(email) || !["Sub Admin", "Employee"].includes(role)) {
        return res.status(400).json({ message: "Enter a name, valid email and select Sub Admin or Employee." });
      }
      if (users.some((item) => item.id !== existing.id && item.email.toLowerCase() === email)) {
        return res.status(409).json({ message: "An account with this email already exists." });
      }
      if (role !== existing.role && !pin) {
        return res.status(400).json({ message: "Enter a new PIN when changing the account role." });
      }
      if (pin && !pinPattern.test(pin)) {
        return res.status(400).json({ message: "PIN must contain 4-8 digits." });
      }
      if (pin && users.some((item) => item.id !== existing.id && item.role === role && verifyPin(pin, item))) {
        return res.status(409).json({ message: "This PIN is already assigned to another user with the same role. Choose a unique PIN." });
      }

      const updated = { ...existing, name, email, role, updatedAt: new Date().toISOString() };
      if (pin) {
        const credentials = hashPin(pin);
        updated.pinSalt = credentials.salt;
        updated.pinHash = credentials.hash;
      }
      users[index] = updated;
      await writeUsers(users);
      res.json({ success: true, user: safeUser(updated) });
    } catch (error) { next(error); }
  });

  app.delete("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      if (req.params.id === req.authUser.id) return res.status(400).json({ message: "You cannot delete your own account." });
      const users = await readUsers();
      const target = users.find((item) => item.id === req.params.id);
      if (!target) return res.status(404).json({ message: "Account not found." });
      if (target.role === "Admin") return res.status(403).json({ message: "Admin account cannot be deleted here." });
      await writeUsers(users.filter((item) => item.id !== target.id));
      for (const [token, session] of sessions.entries()) {
        if (session.userId === target.id) sessions.delete(token);
      }
      res.json({ success: true, message: "Account deleted successfully." });
    } catch (error) { next(error); }
  });

  return { requireAuth, requireAdmin, provisionInitialAdmin };
}
