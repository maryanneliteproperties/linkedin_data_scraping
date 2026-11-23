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