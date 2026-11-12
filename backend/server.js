import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const PORT = process.env.PORT || 5000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "data", "profiles.json");

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));

async function readProfiles() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeProfiles(profiles) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(profiles, null, 2) + "\n", "utf8");
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", message: "LinkedIn Profile Viewer API is running" });
});

app.get("/api/profiles", async (_req, res, next) => {
  try {
    res.json(await readProfiles());
  } catch (error) {
    next(error);
  }
});

app.post("/api/profiles", async (req, res, next) => {
  try {
    const { name, headline = "", company = "", location = "", experience = "",
      education = "", skills = [], profileUrl = "", source = "User entered" } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ message: "Name is required." });
    }
    if (profileUrl && !/^https:\/\/(www\.)?linkedin\.com\//i.test(profileUrl)) {
      return res.status(400).json({ message: "Please provide a valid LinkedIn profile URL." });
    }

    const profiles = await readProfiles();
    const profile = {
      id: Date.now(),
      name: name.trim(),
      headline,
      company,
      location,
      experience,
      education,
      skills: Array.isArray(skills) ? skills : String(skills).split(",").map(s => s.trim()).filter(Boolean),
      profileUrl,
      source
    };
    profiles.unshift(profile);
    await writeProfiles(profiles);
    res.status(201).json(profile);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: "Server error while processing the request." });
});

app.listen(PORT, () => console.log(`API running at http://localhost:${PORT}`));
