import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

const app = express();
const PORT = process.env.PORT || 5000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });
const DATA_FILE = path.join(__dirname, "data", "profiles.json");
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const LINKEDIN_REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI || "http://localhost:5000/auth/linkedin/callback";
const LINKEDIN_CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || "";
const LINKEDIN_CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || "";
const SESSION_COOKIE = "linkedin_profile_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const pendingStates = new Map();
const sessions = new Map();

const allowedOrigins = (process.env.CORS_ORIGINS || FRONTEND_URL)
  .split(",").map((origin) => origin.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS."));
  },
  credentials: true
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
  const source = input.userProfile && typeof input.userProfile === "object"
    ? input.userProfile
    : input.profile && typeof input.profile === "object" ? input.profile : input;
  const firstName = asText(source.firstName || source.given_name);
  const lastName = asText(source.lastName || source.family_name);
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const rawExperiences = asRecords(input.experiences || input.positions);
  const rawEducations = asRecords(input.educations || input.educationDetails || input.education);
  const rawVolunteers = asRecords(input.volunteerExperience || input.volunteerExperiences || input.volunteer);
  const rawSkills = Array.isArray(input.skills) ? input.skills : source.skills;

  return {
    id,
    name: asText(source.name || source.fullName || fullName || input.name || input.fullName),
    email: asText(source.email || input.email),
    linkedinMemberId: asText(source.linkedinMemberId || input.linkedinMemberId),
    headline: asText(source.headline || source.title || source.jobTitle || source.occupation || input.headline || input.title || input.jobTitle),
    company: asText(source.company || source.companyName || input.company),
    location: asText(source.location || source.geoLocation || input.location),
    photoUrl: asText(source.photoUrl || source.profilePicture || source.profilePictureUrl || source.picture || source.pictureUrl || input.photoUrl || input.profilePicture),
    description: asText(source.description || source.summary || input.description || input.summary),
    experience: asText(input.experience),
    education: asText(typeof input.education === "string" ? input.education : ""),
    experiences: rawExperiences.map((item) => ({
      ...item,
      title: asText(item.title || item.position || item.role),
      company: asText(item.company || item.companyName),
      location: asText(item.location),
      duration: asText(item.duration),
      dates: asText(item.dates || [item.startDate, item.endDate].filter(Boolean).join(" - ")),
      description: asText(item.description)
    })),
    educations: rawEducations.map((item) => ({
      ...item,
      school: asText(item.school || item.schoolName || item.institution),
      degree: asText(item.degree || item.degreeName),
      field: asText(item.field || item.fieldOfStudy),
      dates: asText(item.dates || [item.startDate, item.endDate].filter(Boolean).join(" - "))
    })),
    volunteerExperience: rawVolunteers.map((item) => ({
      ...item,
      role: asText(item.role || item.title),
      organization: asText(item.organization || item.company || item.companyName),
      dates: asText(item.dates || [item.startDate, item.endDate].filter(Boolean).join(" - ")),
      description: asText(item.description)
    })),
    skills: Array.isArray(rawSkills)
      ? rawSkills.map((skill) => typeof skill === "string" ? asText(skill) : asText(skill?.name)).filter(Boolean)
      : asList(rawSkills),
    profileUrl: asText(source.profileUrl || source.linkedinUrl || source.url || input.profileUrl || input.linkedinUrl || input.url),
    source: asText(input.source) || "Authorized data",
    updatedAt: new Date().toISOString()
  };
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

function getCookie(req, name) {
  const cookies = asText(req.headers.cookie).split(";").map((part) => part.trim());
  const entry = cookies.find((part) => part.startsWith(name + "="));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}

function setSessionCookie(res, sessionId) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`);
}

function requireLinkedInConfig(req, res, next) {
  if (!LINKEDIN_CLIENT_ID || !LINKEDIN_CLIENT_SECRET) {
    return res.status(503).json({
      code: "LINKEDIN_OAUTH_NOT_CONFIGURED",
      message: "Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in backend/.env before using LinkedIn Login."
    });
  }
  next();
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", message: "LinkedIn Profile Viewer API is running" });
});

// Start LinkedIn's official OpenID Connect authorization-code flow.
app.get("/auth/linkedin", requireLinkedInConfig, (req, res) => {
  const state = crypto.randomBytes(24).toString("hex");
  pendingStates.set(state, { createdAt: Date.now() });
  const params = new URLSearchParams({
    response_type: "code",
    client_id: LINKEDIN_CLIENT_ID,
    redirect_uri: LINKEDIN_REDIRECT_URI,
    state,
    scope: "openid profile email"
  });
  res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`);
});

app.get("/auth/linkedin/callback", requireLinkedInConfig, async (req, res) => {
  const state = asText(req.query.state);
  const pending = pendingStates.get(state);
  pendingStates.delete(state);
  if (!state || !pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
    return res.redirect(`${FRONTEND_URL}/?linkedin_auth=invalid_state`);
  }
  if (req.query.error || !req.query.code) {
    return res.redirect(`${FRONTEND_URL}/?linkedin_auth=denied`);
  }

  try {
    const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: asText(req.query.code),
        redirect_uri: LINKEDIN_REDIRECT_URI,
        client_id: LINKEDIN_CLIENT_ID,
        client_secret: LINKEDIN_CLIENT_SECRET
      })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error("LinkedIn token exchange failed:", tokenData.error || tokenData.error_description || tokenResponse.status);
      return res.redirect(`${FRONTEND_URL}/?linkedin_auth=token_error`);
    }

    const userResponse = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const user = await userResponse.json();
    if (!userResponse.ok || !user.sub) {
      console.error("LinkedIn userinfo failed:", user.error || userResponse.status);
      return res.redirect(`${FRONTEND_URL}/?linkedin_auth=profile_error`);
    }

    const sessionId = crypto.randomBytes(32).toString("hex");
    sessions.set(sessionId, {
      user: {
        id: asText(user.sub),
        linkedinMemberId: asText(user.sub),
        name: asText(user.name || [user.given_name, user.family_name].filter(Boolean).join(" ")),
        firstName: asText(user.given_name),
        lastName: asText(user.family_name),
        email: asText(user.email),
        photoUrl: asText(user.picture),
        source: "LinkedIn OpenID Connect"
      },
      accessToken: tokenData.access_token,
      expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000
    });
    setSessionCookie(res, sessionId);
    res.redirect(`${FRONTEND_URL}/?linkedin_auth=success`);
  } catch (error) {
    console.error("LinkedIn OAuth callback failed:", error);
    res.redirect(`${FRONTEND_URL}/?linkedin_auth=error`);
  }
});

app.get("/api/auth/me", (req, res) => {
  const sessionId = getCookie(req, SESSION_COOKIE);
  const session = sessions.get(sessionId);
  if (!session || session.expiresAt < Date.now()) {
    if (sessionId) sessions.delete(sessionId);
    return res.status(401).json({ authenticated: false });
  }
  res.json({ authenticated: true, user: session.user });
});

app.post("/api/auth/save-my-profile", async (req, res, next) => {
  try {
    const sessionId = getCookie(req, SESSION_COOKIE);
    const session = sessions.get(sessionId);
    if (!session || session.expiresAt < Date.now()) {
      return res.status(401).json({ message: "Please sign in with LinkedIn first." });
    }
    const profile = normalizeProfile({
      ...session.user,
      profileUrl: asText(req.body?.profileUrl),
      source: "LinkedIn OpenID Connect"
    });
    const validationError = validateProfile(profile);
    if (validationError) return res.status(400).json({ message: validationError });

    const profiles = await readProfiles();
    const existingAt = profiles.findIndex((item) =>
      (profile.linkedinMemberId && item.linkedinMemberId === profile.linkedinMemberId) ||
      (!item.linkedinMemberId &&
        item.source === "LinkedIn OpenID Connect" &&
        asText(item.name).toLowerCase() === profile.name.toLowerCase())
    );
    if (existingAt !== -1) {
      const existing = profiles[existingAt];
      const updatedProfile = {
        ...existing,
        ...profile,
        id: existing.id,
        email: profile.email || existing.email || "",
        photoUrl: profile.photoUrl || existing.photoUrl || "",
        profileUrl: profile.profileUrl || existing.profileUrl || "",
        headline: profile.headline || existing.headline || "",
        company: profile.company || existing.company || "",
        location: profile.location || existing.location || "",
        description: profile.description || existing.description || "",
        experience: profile.experience || existing.experience || "",
        education: profile.education || existing.education || "",
        experiences: profile.experiences.length ? profile.experiences : (existing.experiences || []),
        educations: profile.educations.length ? profile.educations : (existing.educations || []),
        volunteerExperience: profile.volunteerExperience.length ? profile.volunteerExperience : (existing.volunteerExperience || []),
        skills: profile.skills.length ? profile.skills : (existing.skills || []),
        linkedinMemberId: profile.linkedinMemberId || existing.linkedinMemberId || ""
      };
      profiles[existingAt] = updatedProfile;
      await writeProfiles(profiles);
      return res.status(200).json(updatedProfile);
    }
    profiles.unshift(profile);
    await writeProfiles(profiles);
    res.status(201).json(profile);
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", (req, res) => {
  const sessionId = getCookie(req, SESSION_COOKIE);
  if (sessionId) sessions.delete(sessionId);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ success: true });
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

app.post("/api/profiles/extract", async (req, res) => {
  const profileUrl = asText(req.body?.profileUrl);
  if (!/^https:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9_%.-]+\/?(?:\?.*)?$/i.test(profileUrl)) {
    return res.status(400).json({ message: "Please provide a valid LinkedIn profile URL." });
  }
  return res.status(503).json({
    code: "PROFILE_PROVIDER_NOT_CONFIGURED",
    message: "LinkedIn OpenID Connect only provides the signed-in member's basic profile. It does not authorize extraction of other members' profiles. An approved API/provider for that data is required."
  });
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
