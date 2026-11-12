import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const PORT = process.env.PORT || 5000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "data", "profiles.json");
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS."));
  }
}));
app.use(express.json({ limit: "5mb" }));

const asText = (value) => typeof value === "string" ? value.trim() : "";
const asList = (value) => {
  if (Array.isArray(value)) return value.map(asText).filter(Boolean);
  if (typeof value === "string") return value.split(",").map(asText).filter(Boolean);
  return [];
};
const asRecords = (value) => Array.isArray(value)
  ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item))
  : [];

function normalizeProfile(input, id = Date.now()) {
  const profile = {
    id,
    name: asText(input.name || input.fullName),
    headline: asText(input.headline || input.title || input.jobTitle),
    company: asText(input.company),
    location: asText(input.location),
    photoUrl: asText(input.photoUrl || input.profilePicture),
    description: asText(input.description || input.summary),
    experience: asText(input.experience),
    education: asText(input.education),
    experiences: asRecords(input.experiences || input.positions),
    educations: asRecords(input.educations || input.educationDetails),
    volunteerExperience: asRecords(input.volunteerExperience || input.volunteer),
    skills: asList(input.skills),
    profileUrl: asText(input.profileUrl || input.linkedinUrl || input.url),
    source: asText(input.source) || "User provided",
    updatedAt: new Date().toISOString()
  };
  return profile;
}

function validateProfile(profile) {
  if (!profile.name) return "Name is required.";
  if (profile.profileUrl && !/^https:\/\/(www\.)?linkedin\.com\//i.test(profile.profileUrl)) {
    return "Please provide a valid LinkedIn profile URL.";
  }
  if (profile.photoUrl && !/^https:\/\//i.test(profile.photoUrl)) {
    return "Photo URL must use HTTPS.";
  }
  return "";
}

function duplicateIndex(profiles, candidate) {
  const url = candidate.profileUrl.toLowerCase();
  if (url) return profiles.findIndex((item) => asText(item.profileUrl).toLowerCase() === url);
  const name = candidate.name.toLowerCase();
  const company = candidate.company.toLowerCase();
  return profiles.findIndex((item) =>
    asText(item.name).toLowerCase() === name &&
    asText(item.company).toLowerCase() === company
  );
}

async function readProfiles() {
  try {
    const parsed = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeProfiles(profiles) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  const temporaryFile = `${DATA_FILE}.tmp`;
  await fs.writeFile(temporaryFile, JSON.stringify(profiles, null, 2) + "\n", "utf8");
  await fs.rename(temporaryFile, DATA_FILE);
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

app.get("/api/profiles/:id", async (req, res, next) => {
  try {
    const profiles = await readProfiles();
    const profile = profiles.find((item) => String(item.id) === req.params.id);
    if (!profile) return res.status(404).json({ message: "Profile not found." });
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

app.post("/api/profiles", async (req, res, next) => {
  try {
    const profile = normalizeProfile(req.body);
    const validationError = validateProfile(profile);
    if (validationError) return res.status(400).json({ message: validationError });

    const profiles = await readProfiles();
    const duplicateAt = duplicateIndex(profiles, profile);
    if (duplicateAt !== -1) {
      return res.status(409).json({
        message: "A profile with the same LinkedIn URL or name and company already exists.",
        duplicateId: profiles[duplicateAt].id
      });
    }

    profiles.unshift(profile);
    await writeProfiles(profiles);
    res.status(201).json(profile);
  } catch (error) {
    next(error);
  }
});

app.post("/api/profiles/import", async (req, res, next) => {
  try {
    const incoming = Array.isArray(req.body) ? req.body : req.body?.profiles;
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return res.status(400).json({ message: "Provide a non-empty profiles array." });
    }
    if (incoming.length > 500) {
      return res.status(413).json({ message: "Import is limited to 500 profiles per request." });
    }

    const profiles = await readProfiles();
    const added = [];
    const duplicates = [];
    const errors = [];

    incoming.forEach((item, index) => {
      const candidate = normalizeProfile(item, Date.now() + index);
      const validationError = validateProfile(candidate);
      if (validationError) {
        errors.push({ row: index + 1, message: validationError });
        return;
      }
      const duplicateAt = duplicateIndex([...profiles, ...added], candidate);
      if (duplicateAt !== -1) {
        duplicates.push({ row: index + 1, name: candidate.name });
        return;
      }
      added.push(candidate);
    });

    if (added.length) {
      await writeProfiles([...added, ...profiles]);
    }
    res.status(200).json({
      imported: added.length,
      duplicates: duplicates.length,
      failed: errors.length,
      profiles: added,
      duplicateRows: duplicates,
      errors
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.message === "Origin is not allowed by CORS." ? 403 : 500;
  res.status(status).json({ message: status === 403 ? error.message : "Server error while processing the request." });
});

app.listen(PORT, () => console.log(`API running at http://localhost:${PORT}`));
