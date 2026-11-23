import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { supabase } from "./supabase.js";

dotenv.config();

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = async (file) => {
  try { return JSON.parse(await fs.readFile(path.join(here, "data", file), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
};

async function ensureEmpty(table) {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) throw error;
  if (count > 0) throw new Error("Supabase table public." + table + " already contains " + count + " row(s). Migration stopped to prevent overwriting existing data.");
}

async function run() {
  const oldUsers = await readJson("users.json");
  const oldProfiles = await readJson("profiles.json");
  if (!Array.isArray(oldUsers) || !Array.isArray(oldProfiles)) throw new Error("Legacy JSON data must contain arrays.");
  await ensureEmpty("users");
  await ensureEmpty("profiles");

  const users = oldUsers.map((u) => ({
    id: u.id,
    username: u.role === "Admin" ? null : (String(u.username || "").trim().toLowerCase() || null),
    name: u.name,
    email: String(u.email || "").toLowerCase(),
    role: u.role,
    pin_salt: u.pinSalt || u.pin_salt,
    pin_hash: u.pinHash || u.pin_hash,
    created_at: u.createdAt || u.created_at || new Date().toISOString(),
    created_by: u.createdBy || u.created_by || null,
    updated_at: u.updatedAt || u.updated_at || null
  }));
  for (let i = 0; i < users.length; i += 100) {
    const { error } = await supabase.from("users").insert(users.slice(i, i + 100));
    if (error) throw error;
  }

  const profiles = oldProfiles.map((p) => ({
    id: Number(p.id),
    data: p,
    created_at: p.createdAt || new Date().toISOString(),
    updated_at: p.updatedAt || new Date().toISOString()
  }));
  for (let i = 0; i < profiles.length; i += 100) {
    const { error } = await supabase.from("profiles").insert(profiles.slice(i, i + 100));
    if (error) throw error;
  }
  console.log("Supabase migration complete: " + users.length + " user account(s), " + profiles.length + " profile(s).");
}

run().catch((error) => {
  console.error("[Supabase migration failed]", error.message);
  process.exitCode = 1;
});
