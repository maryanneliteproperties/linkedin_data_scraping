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

  // This repository also contains a historical Git-conflict backup. Recover the
  // stashed JSON side of that file so its additional profile is not silently lost.
  let backupProfiles = [];
  try {
    const backupText = await fs.readFile(path.join(here, "data", "profiles-conflict-backup.json"), "utf8");
    const separator = "\n=======\n";
    const endMarker = "\n>>>>>>> Stashed changes";
    if (backupText.includes(separator) && backupText.includes(endMarker)) {
      backupProfiles = JSON.parse(backupText.slice(backupText.indexOf(separator) + separator.length, backupText.indexOf(endMarker)));
    } else {
      backupProfiles = JSON.parse(backupText);
    }
    if (!Array.isArray(backupProfiles)) throw new Error("Conflict backup does not contain a profile array.");
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Could not safely read profiles-conflict-backup.json: " + error.message);
  }
  const knownProfileIds = new Set(oldProfiles.map((profile) => String(profile.id)));
  for (const profile of backupProfiles) {
    if (!knownProfileIds.has(String(profile.id))) {
      oldProfiles.push(profile);
      knownProfileIds.add(String(profile.id));
    }
  }

  await ensureEmpty("users");
  await ensureEmpty("profiles");

  const knownUserIds = new Set(oldUsers.map((user) => String(user.id)));
  const users = oldUsers.map((u) => ({
    id: u.id,
    username: u.role === "Admin" ? null : (String(u.username || "").trim().toLowerCase() || null),
    name: u.name,
    email: String(u.email || "").toLowerCase(),
    role: u.role,
    pin_salt: u.pinSalt || u.pin_salt,
    pin_hash: u.pinHash || u.pin_hash,
    created_at: u.createdAt || u.created_at || new Date().toISOString(),
    created_by: knownUserIds.has(String(u.createdBy || u.created_by || "")) ? (u.createdBy || u.created_by) : null,
    updated_at: u.updatedAt || u.updated_at || null
  }));
  const profiles = oldProfiles.map((p) => ({
    id: Number(p.id),
    data: p,
    created_at: p.createdAt || new Date().toISOString(),
    updated_at: p.updatedAt || new Date().toISOString()
  }));
  if (profiles.some((profile) => !Number.isSafeInteger(profile.id))) {
    throw new Error("One or more legacy profiles have a missing or invalid numeric ID. No rows have been imported.");
  }

  try {
    for (let i = 0; i < users.length; i += 100) {
      const { error } = await supabase.from("users").insert(users.slice(i, i + 100));
      if (error) throw error;
    }
    for (let i = 0; i < profiles.length; i += 100) {
      const { error } = await supabase.from("profiles").insert(profiles.slice(i, i + 100));
      if (error) throw error;
    }
  } catch (error) {
    // Both tables were verified empty before import; clear any partial batches
    // so the operator can safely correct the issue and rerun the migration.
    await supabase.from("profiles").delete().gte("id", 0);
    await supabase.from("users").delete().not("id", "is", null);
    throw error;
  }
  console.log("Supabase migration complete: " + users.length + " user account(s), " + profiles.length + " profile(s).");
}

run().catch((error) => {
  console.error("[Supabase migration failed]", error.message);
  process.exitCode = 1;
});
