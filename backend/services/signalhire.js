import dotenv from "dotenv";
dotenv.config();

const SIGNALHIRE_BASE = "https://www.signalhire.com/api/v1";

/**
 * Clean and normalize location string into city and country
 */
export function parseLocation(locations = []) {
  if (!Array.isArray(locations) || locations.length === 0) {
    return { location: "Not Available", city: "Not Available", country: "Not Available" };
  }

  const raw = locations[0]?.name?.trim() || "";
  if (!raw) {
    return { location: "Not Available", city: "Not Available", country: "Not Available" };
  }

  const parts = raw.split(",").map(p => p.trim()).filter(Boolean);
  const city = parts[0] || "Not Available";
  const country = parts.length > 1 ? parts[parts.length - 1] : "Not Available";

  return { location: raw, city, country };
}

/**
 * Deduplicate contacts (emails or phones) by normalized value
 */
export function deduplicateContacts(contacts = [], targetType = "email") {
  const seen = new Set();
  const result = [];

  for (const c of contacts) {
    if (c.type !== targetType || !c.value) continue;
    const norm = String(c.value).trim().toLowerCase();
    if (!seen.has(norm)) {
      seen.add(norm);
      result.push({
        value: String(c.value).trim(),
        subType: c.subType || (targetType === "email" ? "work" : "mobile"),
        rating: c.rating || 100
      });
    }
  }

  return result;
}

/**
 * Normalize an array of items (strings or objects with name/title)
 */
export function normalizeNamedArray(arr) {
  if (!arr) return [];
  const list = Array.isArray(arr) ? arr : (typeof arr === "object" ? [arr] : (typeof arr === "string" ? [arr] : []));
  if (list.length === 0) return [];
  return list.map(item => {
    if (typeof item === "string" && item.trim()) return item.trim();
    if (item && typeof item === "object") {
      const name = item.name || item.title || item.position || item.degree || "";
      const extra = item.authority || item.issuer || item.proficiency || item.publisher || item.organization || item.role || "";
      if (name && extra) return `${String(name).trim()} (${String(extra).trim()})`;
      if (name) return String(name).trim();
      for (const val of Object.values(item)) {
        if (typeof val === "string" && val.trim() && !val.startsWith("http")) return val.trim();
      }
    }
    return "";
  }).filter(Boolean);
}

/**
 * Normalize SignalHire candidate object into our standard clean schema
 */
export function normalizeCandidate(candidate, requestedUrl = "") {
  if (!candidate) return null;

  // 1. Profile: Photo, Name
  const name = candidate.fullName?.trim() || "Not Available";
  const photoUrl = candidate.photo?.url?.trim() || "Not Available";

  // 2. Professional: Designation, Company
  const designation = candidate.headLine?.trim() || candidate.experience?.[0]?.position?.trim() || "Not Available";
  const company = candidate.experience?.[0]?.company?.trim() || "Not Available";

  // 3. Location: City, Country
  const loc = parseLocation(candidate.locations);

  // 4. Contact: Email, Mobile (deduplicated)
  const allEmails = deduplicateContacts(candidate.contacts || [], "email");
  const allPhones = deduplicateContacts(candidate.contacts || [], "phone");

  const workEmail = allEmails.find(e => e.subType === "work")?.value;
  const personalEmail = allEmails.find(e => e.subType === "personal")?.value || "";
  const primaryEmail = workEmail || allEmails[0]?.value || "Not Available";

  const mobilePhone = allPhones.find(p => p.subType === "mobile" || p.subType === "cell")?.value;
  const primaryPhone = mobilePhone || allPhones[0]?.value || "Not Available";

  // 5. Experience: Work Experience
  const experiences = (candidate.experience || []).map(exp => ({
    position: exp.position?.trim() || "Not Available",
    company: exp.company?.trim() || "Not Available",
    started: exp.started ? String(exp.started).slice(0, 7) : "",
    ended: exp.current ? "Present" : (exp.ended ? String(exp.ended).slice(0, 7) : ""),
    current: Boolean(exp.current),
    summary: exp.summary?.trim() || "",
    location: exp.location?.trim() || "",
    companyUrl: exp.companyUrl || "",
    companyLogo: exp.companyLogo || "",
    companySize: exp.companySize || "",
    staffCount: exp.staffCount || null,
    industry: exp.industry || "",
    website: exp.website || ""
  }));

  // 6. Education: Education Details
  const educations = (candidate.education || []).map(edu => {
    let degreeStr = "";
    if (Array.isArray(edu.degree)) {
      degreeStr = edu.degree.filter(Boolean).join(", ");
    } else if (typeof edu.degree === "string") {
      degreeStr = edu.degree.trim();
    }

    return {
      university: edu.university?.trim() || "Not Available",
      degree: degreeStr || "Not Available",
      faculty: edu.faculty?.trim() || "",
      startedYear: edu.startedYear || "",
      endedYear: edu.endedYear || "",
      url: edu.url || ""
    };
  });

  // 7. Skills: Skills (deduplicated array)
  const skills = Array.isArray(candidate.skills)
    ? [...new Set(candidate.skills.map(s => String(s).trim()).filter(Boolean))]
    : [];

  // 8. Social: LinkedIn Profile URL
  const linkedinUrl = candidate.social?.find(s => s.type === "li")?.link || requestedUrl || "Not Available";

  // 9. Additional Fields (Gender, ExperienceYears, Headline, Language, Course, Project, Certification, Patent, Publication, HonorAward, Organization)
  const gender = candidate.gender ? String(candidate.gender).trim() : "Not Available";
  const experienceYears = (candidate.experienceYears !== null && candidate.experienceYears !== undefined && candidate.experienceYears !== "")
    ? candidate.experienceYears
    : "Not Available";
  const headLine = candidate.headLine?.trim() || "Not Available";

  const language = normalizeNamedArray(candidate.language || candidate.languages);
  const course = normalizeNamedArray(candidate.course || candidate.courses);
  const project = normalizeNamedArray(candidate.project || candidate.projects);
  const certification = normalizeNamedArray(candidate.certification || candidate.certifications);
  const patent = normalizeNamedArray(candidate.patent || candidate.patents);
  const publication = normalizeNamedArray(candidate.publication || candidate.publications);
  const honorAward = normalizeNamedArray(candidate.honorAward || candidate.honorAwards || candidate.honors);
  const organization = normalizeNamedArray(candidate.organization || candidate.organizations);

  return {
    uid: candidate.uid || "",
    name,
    photoUrl,
    gender,
    experienceYears,
    headLine,
    designation,
    company,
    location: loc.location,
    city: loc.city,
    country: loc.country,
    email: primaryEmail,
    personalEmail,
    phone: primaryPhone,
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
    social: Array.isArray(candidate.social) ? candidate.social : [],
    profileUrl: linkedinUrl,
    rawCandidate: candidate,
    source: "SignalHire API"
  };
}

/**
 * Fetch candidate from SignalHire Person API
 */
export async function searchSignalHire(profileUrl) {
  const apiKey = process.env.SIGNALHIRE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("SIGNALHIRE_API_KEY is not configured in backend/.env");
  }

  const cleanUrl = String(profileUrl || "").trim().replace(/\/+$/, "");
  if (!cleanUrl) {
    throw new Error("LinkedIn profile URL is required");
  }

  const response = await fetch(`${SIGNALHIRE_BASE}/candidate/search`, {
    method: "POST",
    headers: {
      "apikey": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      items: [cleanUrl],
      withoutWaterfall: true
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SignalHire API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const item = Array.isArray(data) ? data[0] : (data.items?.[0] || data);

  if (!item || item.status === "failed" || !item.candidate) {
    return {
      success: true,
      found: false,
      message: "Candidate profile not found in SignalHire database."
    };
  }

  const normalized = normalizeCandidate(item.candidate, cleanUrl);

  return {
    success: true,
    found: true,
    profile: normalized
  };
}

/**
 * Fetch remaining credits
 */
export async function getSignalHireCredits() {
  const apiKey = process.env.SIGNALHIRE_API_KEY?.trim();
  if (!apiKey) return null;

  try {
    const response = await fetch(`${SIGNALHIRE_BASE}/credits`, {
      headers: { "apikey": apiKey }
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.credits ?? null;
  } catch {
    return null;
  }
}