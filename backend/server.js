import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import {
  searchSignalHire,
  getSignalHireCredits,
  parseLocation,
  deduplicateContacts
} from "./services/signalhire.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_FILE = path.join(__dirname, "data", "profiles.json");
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const LINKEDIN_REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI || "http://localhost:5000/auth/linkedin/callback";
const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || "";
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || "";
const SESSION_COOKIE = "linkedin_profile_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const pendingStates = new Map();
const sessions = new Map();

// Scalable CORS configuration
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
  })
);

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

// Helper utilities
const asText = (value) => (typeof value === "string" ? value.trim() : "");
const asRecords = (value) => (Array.isArray(value) ? value.filter((i) => i && typeof i === "object") : []);

/**
 * Standardize and normalize profile schema across all sources (SignalHire, Extension, CRM)
 * Guarantee "Not Available" for missing fields, with no guesswork and no duplicates.
 */
export function normalizeProfile(input, id = Date.now()) {
  const source = input.userProfile && typeof input.userProfile === "object"
    ? input.userProfile
    : input.profile && typeof input.profile === "object"
    ? input.profile
    : input;

  // 1. Profile: Name & Photo
  const firstName = asText(source.firstName || source.given_name);
  const lastName = asText(source.lastName || source.family_name);
  const combinedName = [firstName, lastName].filter(Boolean).join(" ");
  const rawName = asText(source.name || source.fullName || combinedName || input.name || input.fullName);
  const name = rawName && rawName !== "Name Not Available" ? rawName : "Not Available";

  const rawPhoto = asText(
    source.photoUrl || source.photo?.url || source.avatar || source.picture || input.photoUrl || input.avatar
  );
  const photoUrl = rawPhoto && rawPhoto !== "Not Available" ? rawPhoto : "Not Available";

  // 2. Professional: Designation & Company
  const rawDesignation = asText(
    source.designation || source.headline || source.headLine || source.title || input.designation || input.headline
  );
  const designation = rawDesignation && rawDesignation !== "Designation Not Available" ? rawDesignation : "Not Available";

  const rawCompany = asText(source.company || source.companyName || input.company || input.companyName);
  const company = rawCompany && rawCompany !== "Company Not Available" ? rawCompany : "Not Available";

  // 3. Location: City, Country, Full Location
  const rawLocation = asText(source.location || source.geoLocation || input.location);
  let city = asText(source.city || input.city);
  let country = asText(source.country || input.country);
  let locationStr = rawLocation && rawLocation !== "City Not Available" ? rawLocation : "";

  if (!locationStr && (city || country)) {
    locationStr = [city, country].filter(Boolean).join(", ");
  }

  if (locationStr && (!city || !country)) {
    const parts = locationStr.split(",").map((p) => p.trim()).filter(Boolean);
    if (!city && parts.length > 0) city = parts[0];
    if (!country && parts.length > 1) country = parts[parts.length - 1];
  }

  // 4. Contact: Email, Mobile, Personal Email, Deduplicated Lists
  const rawEmail = asText(source.email || source.emailAddress || input.email || input.emailAddress);
  const email = rawEmail && rawEmail !== "Not Available" ? rawEmail : "Not Available";

  const personalEmail = asText(source.personalEmail || input.personalEmail || "");

  const rawPhone = asText(source.phone || source.phoneNumber || source.mobile || input.phone || input.phoneNumber || input.mobile);
  const phone = rawPhone && rawPhone !== "Not Available" ? rawPhone : "Not Available";

  const allEmails = deduplicateContacts(
    [
      ...(Array.isArray(source.allEmails) ? source.allEmails : []),
      ...(Array.isArray(input.allEmails) ? input.allEmails : []),
      ...(email !== "Not Available" ? [{ type: "email", value: email, subType: "work" }] : []),
      ...(personalEmail ? [{ type: "email", value: personalEmail, subType: "personal" }] : [])
    ],
    "email"
  );

  const allPhones = deduplicateContacts(
    [
      ...(Array.isArray(source.allPhones) ? source.allPhones : []),
      ...(Array.isArray(input.allPhones) ? input.allPhones : []),
      ...(phone !== "Not Available" ? [{ type: "phone", value: phone, subType: "mobile" }] : [])
    ],
    "phone"
  );

  // 5. Experience: Work Experience
  const rawExperiences = asRecords(source.experiences || input.experiences || source.experience || input.experience);
  const experiences = rawExperiences.map((item) => ({
    position: asText(item.position || item.title || item.role) || "Not Available",
    company: asText(item.company || item.companyName) || "Not Available",
    started: asText(item.started || item.startDate || item.dates?.split("-")[0]),
    ended: asText(item.ended || item.endDate || (item.current ? "Present" : "")),
    current: Boolean(item.current),
    summary: asText(item.summary || item.description),
    location: asText(item.location)
  }));

  // 6. Education: Education Details
  const rawEducations = asRecords(source.educations || input.educations || source.education || input.education);
  const educations = rawEducations.map((item) => {
    let degreeStr = "";
    if (Array.isArray(item.degree)) {
      degreeStr = item.degree.filter(Boolean).join(", ");
    } else {
      degreeStr = asText(item.degree || item.degreeName);
    }

    return {
      university: asText(item.university || item.school || item.schoolName || item.institution) || "Not Available",
      degree: degreeStr || "Not Available",
      faculty: asText(item.faculty || item.fieldOfStudy || item.field),
      startedYear: asText(item.startedYear || item.startYear),
      endedYear: asText(item.endedYear || item.endYear)
    };
  });

  // 7. Skills: Deduplicated string list
  const rawSkills = Array.isArray(source.skills)
    ? source.skills
    : Array.isArray(input.skills)
    ? input.skills
    : [];
  const skills = [...new Set(rawSkills.map((s) => asText(typeof s === "object" ? s.name : s)).filter(Boolean))];

  // 8. Social: LinkedIn Profile URL
  const rawProfileUrl = asText(source.profileUrl || source.linkedinUrl || input.profileUrl || input.linkedinUrl);
  const profileUrl = rawProfileUrl || "Not Available";

  return {
    id,
    name,
    photoUrl,
    designation,
    company,
    location: locationStr || "Not Available",
    city: city || "Not Available",
    country: country || "Not Available",
    email,
    personalEmail,
    phone,
    allEmails,
    allPhones,
    experiences,
    educations,
    skills,
    profileUrl,
    source: asText(source.source || input.source) || "LinkedIn CRM",
    createdAt: asText(source.createdAt || input.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Validate required fields
 */
function validateProfile(profile) {
  if (!profile.name || profile.name === "Not Available") {
    return "Profile name is required.";
  }
  if (!profile.profileUrl || profile.profileUrl === "Not Available") {
    return "Profile URL is required.";
  }
  return null;
}

/**
 * Find index of duplicate profile (matches by LinkedIn URL or by Name + Company)
 */
function duplicateIndex(profiles, candidate) {
  const targetUrl = asText(candidate.profileUrl).toLowerCase().replace(/\/+$/, "");
  const targetName = asText(candidate.name).toLowerCase();
  const targetCompany = asText(candidate.company).toLowerCase();

  return profiles.findIndex((item) => {
    const itemUrl = asText(item.profileUrl).toLowerCase().replace(/\/+$/, "");
    if (targetUrl && targetUrl !== "not available" && itemUrl && itemUrl !== "not available") {
      if (itemUrl === targetUrl) return true;
    }
    const itemName = asText(item.name).toLowerCase();
    const itemCompany = asText(item.company).toLowerCase();
    if (targetName && targetCompany && targetCompany !== "not available") {
      if (itemName === targetName && itemCompany === targetCompany) return true;
    }
    return false;
  });
}

/**
 * Merge existing record with fresh incoming data cleanly without duplicates
 */
function mergeExistingProfile(existing, incoming) {
  const isAvailable = (val) => val && val !== "Not Available";

  return {
    ...existing,
    ...incoming,
    id: existing.id,
    name: isAvailable(incoming.name) ? incoming.name : existing.name,
    photoUrl: isAvailable(incoming.photoUrl) ? incoming.photoUrl : existing.photoUrl,
    designation: isAvailable(incoming.designation) ? incoming.designation : existing.designation,
    company: isAvailable(incoming.company) ? incoming.company : existing.company,
    location: isAvailable(incoming.location) ? incoming.location : existing.location,
    city: isAvailable(incoming.city) ? incoming.city : existing.city,
    country: isAvailable(incoming.country) ? incoming.country : existing.country,
    email: isAvailable(incoming.email) ? incoming.email : existing.email,
    personalEmail: incoming.personalEmail || existing.personalEmail || "",
    phone: isAvailable(incoming.phone) ? incoming.phone : existing.phone,
    allEmails: deduplicateContacts([...(existing.allEmails || []), ...(incoming.allEmails || [])], "email"),
    allPhones: deduplicateContacts([...(existing.allPhones || []), ...(incoming.allPhones || [])], "phone"),
    experiences: incoming.experiences && incoming.experiences.length > 0 ? incoming.experiences : (existing.experiences || []),
    educations: incoming.educations && incoming.educations.length > 0 ? incoming.educations : (existing.educations || []),
    skills: [...new Set([...(existing.skills || []), ...(incoming.skills || [])])],
    profileUrl: isAvailable(incoming.profileUrl) ? incoming.profileUrl : existing.profileUrl,
    createdAt: existing.createdAt || incoming.createdAt,
    updatedAt: new Date().toISOString()
  };
}

/**
 * File I/O for database persistence
 */
async function readProfiles() {
  try {
    const content = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      await writeProfiles([]);
      return [];
    }
    console.error("[Database] Read error:", error.message);
    return [];
  }
}

async function writeProfiles(profiles) {
  const tempFile = `${DATA_FILE}.tmp`;
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(tempFile, JSON.stringify(profiles, null, 2), "utf8");
  await fs.rename(tempFile, DATA_FILE);
}

// ----------------------------------------------------
// Health Route
// ----------------------------------------------------
app.get("/api/health", (_req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// ----------------------------------------------------
// SignalHire Integration Routes
// ----------------------------------------------------

/**
 * POST /api/profiles/signalhire
 * Look up full candidate details from SignalHire Person API
 */
app.post("/api/profiles/signalhire", async (req, res) => {
  try {
    const { profileUrl } = req.body || {};
    if (!profileUrl) {
      return res.status(400).json({
        success: false,
        message: "LinkedIn profileUrl is required."
      });
    }

    const result = await searchSignalHire(profileUrl);
    const credits = await getSignalHireCredits();

    if (!result.success || !result.found) {
      return res.status(200).json({
        success: true,
        found: false,
        credits,
        message: result.message || "Candidate not found in SignalHire."
      });
    }

    return res.status(200).json({
      success: true,
      found: true,
      profile: result.profile,
      credits
    });
  } catch (err) {
    console.error("[SignalHire Route] Error:", err.message);
    return res.status(500).json({
      success: false,
      message: err.message || "SignalHire enrichment failed."
    });
  }
});

/**
 * GET /api/signalhire/credits
 * Get real-time SignalHire credit balance
 */
app.get(["/api/signalhire/credits", "/api/profiles/signalhire-credits"], async (_req, res) => {
  try {
    const credits = await getSignalHireCredits();
    return res.json({ success: true, credits });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ----------------------------------------------------
// Profile CRUD Routes
// ----------------------------------------------------

/**
 * GET /api/profiles
 * Retrieve profiles with search and sorting
 */
app.get("/api/profiles", async (req, res, next) => {
  try {
    const profiles = await readProfiles();
    const query = asText(req.query.search).toLowerCase();

    let results = profiles;
    if (query) {
      results = profiles.filter((p) => {
        const textToSearch = [
          p.name,
          p.designation,
          p.company,
          p.city,
          p.country,
          p.location,
          p.email,
          p.personalEmail,
          p.phone,
          ...(p.skills || [])
        ].join(" ").toLowerCase();
        return textToSearch.includes(query);
      });
    }

    res.json(results);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/profiles/:id
 */
app.get("/api/profiles/:id", async (req, res, next) => {
  try {
    const profiles = await readProfiles();
    const profile = profiles.find((item) => String(item.id) === req.params.id);
    if (!profile) {
      return res.status(404).json({ message: "Profile not found." });
    }
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/profiles
 * Create or merge profile
 */
app.post("/api/profiles", async (req, res, next) => {
  try {
    const profile = normalizeProfile(req.body);
    const validationError = validateProfile(profile);

    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const profiles = await readProfiles();
    const dupIdx = duplicateIndex(profiles, profile);

    if (dupIdx !== -1) {
      const merged = mergeExistingProfile(profiles[dupIdx], profile);
      profiles[dupIdx] = merged;
      await writeProfiles(profiles);

      return res.status(200).json({
        success: true,
        action: "updated",
        message: "Existing profile updated successfully.",
        profile: merged
      });
    }

    profiles.unshift(profile);
    await writeProfiles(profiles);

    return res.status(201).json({
      success: true,
      action: "created",
      message: "Profile saved successfully.",
      profile
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/profiles/:id
 */
app.put("/api/profiles/:id", async (req, res, next) => {
  try {
    const profiles = await readProfiles();
    const index = profiles.findIndex((item) => String(item.id) === req.params.id);

    if (index === -1) {
      return res.status(404).json({ message: "Profile not found." });
    }

    const updated = normalizeProfile({ ...profiles[index], ...req.body }, profiles[index].id);
    const validationError = validateProfile(updated);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    profiles[index] = updated;
    await writeProfiles(profiles);

    res.json({
      success: true,
      message: "Profile updated successfully.",
      profile: updated
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/profiles/:id
 */
app.delete("/api/profiles/:id", async (req, res, next) => {
  try {
    const profiles = await readProfiles();
    const filtered = profiles.filter((item) => String(item.id) !== req.params.id);

    if (filtered.length === profiles.length) {
      return res.status(404).json({ message: "Profile not found." });
    }

    await writeProfiles(filtered);
    res.json({ success: true, message: "Profile deleted successfully." });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/profiles/import
 * Bulk import profiles
 */
app.post("/api/profiles/import", async (req, res, next) => {
  try {
    const incomingList = Array.isArray(req.body)
      ? req.body
      : Array.isArray(req.body?.profiles)
      ? req.body.profiles
      : [];

    if (incomingList.length === 0) {
      return res.status(400).json({ message: "An array of profiles is required for import." });
    }

    const existingProfiles = await readProfiles();
    let importedCount = 0;
    let updatedCount = 0;

    for (const raw of incomingList) {
      const normalized = normalizeProfile(raw, Date.now() + Math.floor(Math.random() * 1000));
      if (validateProfile(normalized)) continue;

      const dupIdx = duplicateIndex(existingProfiles, normalized);
      if (dupIdx !== -1) {
        existingProfiles[dupIdx] = mergeExistingProfile(existingProfiles[dupIdx], normalized);
        updatedCount++;
      } else {
        existingProfiles.push(normalized);
        importedCount++;
      }
    }

    await writeProfiles(existingProfiles);

    res.json({
      success: true,
      imported: importedCount,
      updated: updatedCount,
      total: existingProfiles.length
    });
  } catch (error) {
    next(error);
  }
});

// Error handling middleware
app.use((err, _req, res, _next) => {
  console.error("[Server Error]:", err);
  res.status(500).json({
    message: err.message || "Internal server error occurred."
  });
});

app.listen(PORT, () => {
  console.log(`API running at http://localhost:${PORT}`);
});