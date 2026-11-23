import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import { setupAuth } from "./auth.js";
import { supabase } from "./supabase.js";
import {
  searchSignalHire,
  getSignalHireCredits,
  parseLocation,
  deduplicateContacts,
  normalizeNamedArray
} from "./services/signalhire.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

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
const auth = setupAuth(app, null, asText);

/**
 * Standardize and normalize profile schema across all sources (SignalHire, Extension, CRM)
 * Guarantee "Not Available" for missing fields, with no guesswork and no duplicates.
 */
export function normalizeProfile(input, id = Date.now()) {
  const source = (input.candidate && typeof input.candidate === "object")
    ? input.candidate
    : (input.userProfile && typeof input.userProfile === "object")
    ? input.userProfile
    : (input.profile && typeof input.profile === "object")
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
    location: asText(item.location),
    companyUrl: asText(item.companyUrl),
    companyLogo: asText(item.companyLogo),
    companySize: asText(item.companySize),
    staffCount: item.staffCount ?? null,
    industry: asText(item.industry),
    website: asText(item.website)
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
      endedYear: asText(item.endedYear || item.endYear),
      url: asText(item.url)
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

  // 9. Additional Candidate Fields
  const rawCandidate = source.rawCandidate || input.rawCandidate || (source.candidate || null);
  const gender = asText(source.gender || input.gender || rawCandidate?.gender) || "Not Available";
  const rawExpYears = source.experienceYears ?? input.experienceYears ?? rawCandidate?.experienceYears;
  const experienceYears = (rawExpYears !== null && rawExpYears !== undefined && rawExpYears !== "" && rawExpYears !== "Not Available")
    ? rawExpYears
    : "Not Available";
  const headLine = asText(source.headLine || source.headline || input.headLine || input.headline || rawCandidate?.headLine) || "Not Available";

  const language = normalizeNamedArray(source.language || source.languages || input.language || input.languages || rawCandidate?.language || rawCandidate?.languages);
  const course = normalizeNamedArray(source.course || source.courses || input.course || input.courses || rawCandidate?.course || rawCandidate?.courses);
  const project = normalizeNamedArray(source.project || source.projects || input.project || input.projects || rawCandidate?.project || rawCandidate?.projects);
  const certification = normalizeNamedArray(source.certification || source.certifications || input.certification || input.certifications || rawCandidate?.certification || rawCandidate?.certifications);
  const patent = normalizeNamedArray(source.patent || source.patents || input.patent || input.patents || rawCandidate?.patent || rawCandidate?.patents);
  const publication = normalizeNamedArray(source.publication || source.publications || input.publication || input.publications || rawCandidate?.publication || rawCandidate?.publications);
  const honorAward = normalizeNamedArray(source.honorAward || source.honorAwards || input.honorAward || input.honorAwards || rawCandidate?.honorAward || rawCandidate?.honorAwards || rawCandidate?.honors);
  const organization = normalizeNamedArray(source.organization || source.organizations || input.organization || input.organizations || rawCandidate?.organization || rawCandidate?.organizations);

  return {
    id,
    uid: asText(source.uid || input.uid),
    name,
    photoUrl,
    gender,
    experienceYears,
    headLine,
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
    language,
    course,
    project,
    certification,
    patent,
    publication,
    honorAward,
    organization,
    social: Array.isArray(source.social) ? source.social : (Array.isArray(input.social) ? input.social : []),
    profileUrl,
    rawCandidate: rawCandidate || null,
    source: asText(source.source || input.source) || "LinkedIn CRM",
    createdAt: asText(source.createdAt || input.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    assignment: input.assignment || source.assignment || null,
    assignmentHistory: Array.isArray(input.assignmentHistory) ? input.assignmentHistory : (Array.isArray(source.assignmentHistory) ? source.assignmentHistory : [])
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
  const cleanUrl = (u) => String(u || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "").split("?")[0];
  const targetUrl = cleanUrl(candidate.profileUrl);
  const targetName = String(candidate.name || "").toLowerCase().trim();
  const targetUid = String(candidate.uid || "").trim();

  return profiles.findIndex((item) => {
    if (targetUid && item.uid && targetUid === item.uid) return true;

    const itemUrl = cleanUrl(item.profileUrl);
    if (targetUrl && targetUrl !== "not available" && itemUrl && itemUrl !== "not available") {
      if (itemUrl === targetUrl) return true;
      const targetSlug = targetUrl.match(/\/in\/([^/]+)/)?.[1];
      const itemSlug = itemUrl.match(/\/in\/([^/]+)/)?.[1];
      if (targetSlug && itemSlug && targetSlug === itemSlug) return true;
    }

    const itemName = String(item.name || "").toLowerCase().trim();
    if (targetName && targetName !== "not available" && itemName && itemName !== "not available") {
      if (itemName === targetName && targetName.length > 3) return true;
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
    social: incoming.social && incoming.social.length > 0 ? incoming.social : (existing.social || []),
    gender: isAvailable(incoming.gender) ? incoming.gender : (existing.gender || "Not Available"),
    experienceYears: (incoming.experienceYears !== "Not Available" && incoming.experienceYears !== null && incoming.experienceYears !== undefined)
      ? incoming.experienceYears
      : (existing.experienceYears ?? "Not Available"),
    headLine: isAvailable(incoming.headLine) ? incoming.headLine : (existing.headLine || "Not Available"),
    language: incoming.language && incoming.language.length > 0 ? incoming.language : (existing.language || []),
    course: incoming.course && incoming.course.length > 0 ? incoming.course : (existing.course || []),
    project: incoming.project && incoming.project.length > 0 ? incoming.project : (existing.project || []),
    certification: incoming.certification && incoming.certification.length > 0 ? incoming.certification : (existing.certification || []),
    patent: incoming.patent && incoming.patent.length > 0 ? incoming.patent : (existing.patent || []),
    publication: incoming.publication && incoming.publication.length > 0 ? incoming.publication : (existing.publication || []),
    honorAward: incoming.honorAward && incoming.honorAward.length > 0 ? incoming.honorAward : (existing.honorAward || []),
    organization: incoming.organization && incoming.organization.length > 0 ? incoming.organization : (existing.organization || []),
    uid: incoming.uid || existing.uid || "",
    rawCandidate: incoming.rawCandidate || existing.rawCandidate || null,
    profileUrl: isAvailable(incoming.profileUrl) ? incoming.profileUrl : existing.profileUrl,
    createdAt: existing.createdAt || incoming.createdAt,
    updatedAt: new Date().toISOString(),
    assignment: existing.assignment || incoming.assignment || null,
    assignmentHistory: existing.assignmentHistory || incoming.assignmentHistory || []
  };
}

/**
 * Supabase persistence for profile records.
 * Profile payloads remain JSONB so the existing API shape is unchanged.
 */
async function readProfiles() {
  const { data, error } = await supabase.from("profiles").select("data").order("id", { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => row.data).filter((item) => item && typeof item === "object");
}

async function writeProfiles(profiles) {
  const rows = profiles.map((profile) => ({
    id: Number(profile.id),
    data: profile,
    created_at: profile.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString()
  }));
  if (rows.some((row) => !Number.isSafeInteger(row.id))) {
    throw new Error("Profile ID must be a safe integer before saving to Supabase.");
  }

  if (rows.length) {
    const { error } = await supabase.from("profiles").upsert(rows, { onConflict: "id" });
    if (error) throw error;
    const ids = rows.map((row) => row.id);
    const { error: deleteError } = await supabase.from("profiles").delete().not("id", "in", "(" + ids.join(",") + ")");
    if (deleteError) throw deleteError;
  } else {
    const { error } = await supabase.from("profiles").delete().gte("id", 0);
    if (error) throw error;
  }
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
app.post("/api/profiles/signalhire", auth.requireAuth, async (req, res) => {
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

    // Auto-update an existing profile in Supabase when SignalHire returns a match
    try {
      const profiles = await readProfiles();
      const normalized = normalizeProfile(result.profile);
      const dupIdx = duplicateIndex(profiles, normalized);
      if (dupIdx !== -1) {
        profiles[dupIdx] = mergeExistingProfile(profiles[dupIdx], normalized);
        await writeProfiles(profiles);
      }
    } catch (saveErr) {
      console.warn("[SignalHire Auto-Update] Warning:", saveErr.message);
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
app.get(["/api/signalhire/credits", "/api/profiles/signalhire-credits"], auth.requireAuth, async (_req, res) => {
  try {
    const credits = await getSignalHireCredits();
    return res.json({ success: true, credits });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ----------------------------------------------------
// Profile Assignment Routes
// ----------------------------------------------------

app.get("/api/assignable-users", auth.requireAuth, async (req, res, next) => {
  try {
    if (!["Admin", "Sub Admin"].includes(req.authUser.role)) return res.status(403).json({ message: "Only Admin and Sub Admin can assign profiles." });
    const allowedRoles = req.authUser.role === "Admin" ? ["Sub Admin", "Employee"] : ["Employee"];
    const { data, error } = await supabase.from("users").select("id,username,name,email,role").in("role", allowedRoles).order("name", { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (error) { next(error); }
});

app.post("/api/profiles/assign", auth.requireAuth, async (req, res, next) => {
  try {
    const ids = [...new Set((Array.isArray(req.body?.profileIds) ? req.body.profileIds : []).map((id) => Number(id)).filter((id) => Number.isSafeInteger(id)))];
    const assignedToId = asText(req.body?.assignedToId);
    if (!ids.length || !assignedToId) return res.status(400).json({ message: "Select profiles and an assignee." });
    if (!["Admin", "Sub Admin"].includes(req.authUser.role)) return res.status(403).json({ message: "Employees cannot assign profiles." });
    const { data: target, error: targetError } = await supabase.from("users").select("id,name,role").eq("id", assignedToId).maybeSingle();
    if (targetError) throw targetError;
    const allowedRoles = req.authUser.role === "Admin" ? ["Sub Admin", "Employee"] : ["Employee"];
    if (!target || !allowedRoles.includes(target.role)) return res.status(403).json({ message: "You cannot assign profiles to this user." });
    const { data: rows, error: readError } = await supabase.from("profiles").select("id,data,created_at").in("id", ids);
    if (readError) throw readError;
    if (!rows || rows.length !== ids.length) return res.status(404).json({ message: "One or more selected profiles could not be found. Refresh the Lead List and try again." });
    const now = new Date().toISOString();
    const updatedRows = [];
    for (const row of rows) {
      const profile = row.data || {};
      const current = profile.assignment || null;
      if (req.authUser.role === "Admin" && current) return res.status(409).json({ message: "One or more selected profiles are already assigned. Refresh the Lead List." });
      if (req.authUser.role === "Sub Admin" && (!current || current.assignedToId !== req.authUser.id || current.assignedByRole !== "Admin")) return res.status(403).json({ message: "Sub Admin can assign only profiles assigned to them by Admin." });
      const assignment = { assignedToId: target.id, assignedToName: target.name, assignedToRole: target.role, assignedById: req.authUser.id, assignedByName: req.authUser.name, assignedByRole: req.authUser.role, assignedAt: now };
      const history = Array.isArray(profile.assignmentHistory) ? profile.assignmentHistory : [];
      updatedRows.push({ id: row.id, data: { ...profile, assignment, assignmentHistory: [...history, assignment], updatedAt: now }, created_at: row.created_at || now, updated_at: now });
    }
    const { error: saveError } = await supabase.from("profiles").upsert(updatedRows, { onConflict: "id" });
    if (saveError) throw saveError;
    res.json({ success: true, assignedCount: updatedRows.length, message: updatedRows.length + " profile(s) assigned to " + target.name + "." });
  } catch (error) { next(error); }
});

app.get("/api/assigned-tasks", auth.requireAuth, async (req, res, next) => {
  try {
    const profiles = await readProfiles();
    const tasks = profiles.filter((profile) => {
      const assignment = profile.assignment;
      if (!assignment) return false;
      if (req.authUser.role === "Admin") return true;
      if (req.authUser.role === "Sub Admin") return assignment.assignedToId === req.authUser.id || assignment.assignedById === req.authUser.id;
      return assignment.assignedToId === req.authUser.id;
    });
    res.json(tasks);
  } catch (error) { next(error); }
});

// ----------------------------------------------------
// Profile CRUD Routes
// ----------------------------------------------------

/**
 * GET /api/profiles
 * Retrieve profiles with search and sorting
 */
app.get("/api/profiles", auth.requireAuth, async (req, res, next) => {
  try {
    const profiles = await readProfiles();
    const query = asText(req.query.search).toLowerCase();

    let results = profiles.filter((profile) => {
      const assignment = profile.assignment;
      if (req.authUser.role === "Admin") return !assignment;
      if (req.authUser.role === "Sub Admin") return !assignment || assignment.assignedToId === req.authUser.id;
      return assignment?.assignedToId === req.authUser.id;
    });
    if (query) {
      results = results.filter((p) => {
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
app.get("/api/profiles/:id", auth.requireAuth, async (req, res, next) => {
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
app.post("/api/profiles", auth.requireAuth, async (req, res, next) => {
  try {
    if (!["Admin", "Sub Admin"].includes(req.authUser.role)) {
      return res.status(403).json({ message: "Only Admin and Sub Admin can save LinkedIn profiles." });
    }
    const profile = normalizeProfile(req.body);
    profile.createdById = req.authUser.id;
    profile.createdByName = req.authUser.name;
    profile.createdByRole = req.authUser.role;
    const validationError = validateProfile(profile);

    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const profiles = await readProfiles();
    const dupIdx = duplicateIndex(profiles, profile);

    if (dupIdx !== -1) {
      const existing = profiles[dupIdx];
      if (existing.createdById && String(existing.createdById) !== String(req.authUser.id)) {
        return res.status(409).json({ message: "This LinkedIn profile is already saved by another user." });
      }
      const merged = mergeExistingProfile(existing, profile);
      merged.createdById = req.authUser.id;
      merged.createdByName = req.authUser.name;
      merged.createdByRole = req.authUser.role;
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
app.put("/api/profiles/:id", auth.requireAuth, async (req, res, next) => {
  try {
    const profiles = await readProfiles();
    const index = profiles.findIndex((item) => String(item.id) === req.params.id);

    if (index === -1) {
      return res.status(404).json({ message: "Profile not found." });
    }

    const currentProfile = profiles[index];
    const assignment = currentProfile.assignment || null;
    if (req.authUser.role === "Admin" && currentProfile.createdByRole === "Sub Admin") {
      return res.status(403).json({ message: "Admin cannot edit profiles saved by Sub Admin." });
    }
    if (req.authUser.role === "Employee" && assignment) {
      return res.status(403).json({ message: "Employees cannot edit assigned tasks." });
    }
    if (req.authUser.role === "Sub Admin" && assignment?.assignedByRole === "Admin") {
      return res.status(403).json({ message: "Sub Admin cannot edit tasks assigned by Admin." });
    }

    const updated = normalizeProfile({ ...currentProfile, ...req.body, assignment: currentProfile.assignment || null, assignmentHistory: currentProfile.assignmentHistory || [] }, currentProfile.id);
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
app.delete("/api/profiles/:id", auth.requireAuth, async (req, res, next) => {
  try {
    const profiles = await readProfiles();
    const profileToDelete = profiles.find((item) => String(item.id) === req.params.id);
    if (!profileToDelete) {
      return res.status(404).json({ message: "Profile not found." });
    }

    const assignment = profileToDelete.assignment || null;
    if (req.authUser.role === "Admin" && profileToDelete.createdByRole === "Sub Admin") {
      return res.status(403).json({ message: "Admin cannot delete profiles saved by Sub Admin." });
    }
    if (req.authUser.role === "Employee" && assignment) {
      return res.status(403).json({ message: "Employees cannot delete assigned tasks." });
    }
    if (req.authUser.role === "Sub Admin" && assignment?.assignedByRole === "Admin") {
      return res.status(403).json({ message: "Sub Admin cannot delete tasks assigned by Admin." });
    }

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
app.post("/api/profiles/import", auth.requireAuth, auth.requireAdmin, async (req, res, next) => {
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

auth.provisionInitialAdmin()
  .then(() => app.listen(PORT, () => console.log("API running at http://localhost:" + PORT)))
  .catch((error) => {
    console.error("[Startup] Supabase connection or Admin provisioning failed:", error.message);
    process.exitCode = 1;
  });