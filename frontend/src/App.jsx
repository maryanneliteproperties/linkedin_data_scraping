import React, { useEffect, useMemo, useState } from "react";
import { Search, Linkedin, RefreshCw, Users, CheckCircle2, AlertCircle, DownloadCloud, LogIn, LogOut, UserRound, Save } from "lucide-react";

const API = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "") + "/api";
const API_ORIGIN = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "");

function formatListValue(item) {
  if (!item) return "";
  if (typeof item === "string") return item.trim();
  if (typeof item === "object") {
    const name = item.name || item.title || item.position || item.degree || "";
    const extra = item.authority || item.issuer || item.organization || item.proficiency || item.publisher || "";
    if (name && extra) return `${String(name).trim()} (${String(extra).trim()})`;
    if (name) return String(name).trim();
    for (const val of Object.values(item)) {
      if (typeof val === "string" && val.trim() && !val.startsWith("http")) return val.trim();
    }
  }
  return String(item);
}

function renderPills(data, max = 2) {
  if (!data) return <span className="emptyCellText">Not Available</span>;
  const list = Array.isArray(data)
    ? data
    : (typeof data === "object" ? [data] : (typeof data === "string" && data.trim() ? [data.trim()] : []));
  const formatted = list.map(formatListValue).filter(Boolean);
  if (formatted.length === 0) {
    return <span className="emptyCellText">Not Available</span>;
  }
  return (
    <div className="tablePillList">
      {formatted.slice(0, max).map((item, idx) => (
        <span key={idx} className="tablePillBadge" title={item}>{item}</span>
      ))}
      {formatted.length > max && (
        <span className="tablePillCount" title={formatted.slice(max).join(", ")}>
          +{formatted.length - max}
        </span>
      )}
    </div>
  );
}

export default function App() {
  const [profiles, setProfiles] = useState([]);
  const [search, setSearch] = useState("");
  const [profileUrl, setProfileUrl] = useState("");
  const [linkedinProfileUrl, setLinkedinProfileUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [savingMyProfile, setSavingMyProfile] = useState(false);
  const [editingProfile, setEditingProfile] = useState(null);
  const [viewingProfile, setViewingProfile] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingProfile, setDeletingProfile] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  

  async function loadProfiles(showLoader = true) {
    if (showLoader) setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API}/profiles`);
      if (!response.ok) throw new Error("Could not load profiles.");
      const data = await response.json();
      setProfiles(Array.isArray(data) ? data : []);
    } catch {
      setError("Backend connect aagala. Backend terminal-la npm run dev start pannunga.");
    } finally { setLoading(false); }
  }

  async function loadAuth() {
    setAuthLoading(true);
    try {
      const response = await fetch(`${API}/auth/me`, { credentials: "include" });
      const data = response.ok ? await response.json() : { authenticated: false };
      setAuthUser(data.authenticated ? data.user : null);
    } catch {
      setAuthUser(null);
    } finally {
      setAuthLoading(false);
    }
  }

  useEffect(() => {
    loadProfiles();
    loadAuth();

    // Refresh extension-saved profiles while the app is open,
    // and immediately when the user returns to this tab.
    const refreshProfiles = () => {
      if (document.visibilityState === "visible") {
        loadProfiles(false);
      }
    };
    const refreshTimer = window.setInterval(refreshProfiles, 5000);
    window.addEventListener("focus", refreshProfiles);
    document.addEventListener("visibilitychange", refreshProfiles);

    const params = new URLSearchParams(window.location.search);
    const authStatus = params.get("linkedin_auth");
    if (authStatus === "success") setNotice("LinkedIn login successful. You can now save your own basic profile.");
    if (authStatus && authStatus !== "success") setError(`LinkedIn login could not be completed (${authStatus.replaceAll("_", " ")}). Please try again.`);
    if (authStatus) {
      params.delete("linkedin_auth");
      const query = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (query ? `?${query}` : ""));
    }

    return () => {
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", refreshProfiles);
      document.removeEventListener("visibilitychange", refreshProfiles);
    };
  }, []);

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    if (!term) return profiles;
    return profiles.filter((profile) => [
      profile.name, profile.email, profile.headline, profile.headLine, profile.company, profile.location,
      profile.description, profile.phone, profile.gender, ...(profile.skills || []),
      ...(profile.language || []), ...(profile.certification || []), ...(profile.project || [])
    ].join(" ").toLowerCase().includes(term));
  }, [profiles, search]);

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;

  const paginatedProfiles = filtered.slice(
    startIndex,
    startIndex + itemsPerPage
  );

  const firstItem = filtered.length === 0 ? 0 : startIndex + 1;

  const lastItem = Math.min(
    startIndex + itemsPerPage,
    filtered.length
  );

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filtered.length / itemsPerPage));

    if (currentPage > maxPage) {
      setCurrentPage(maxPage);
    }
  }, [filtered.length, itemsPerPage, currentPage]);

  async function extractProfile(event) {
    event.preventDefault();
    setError(""); setNotice("");
    const url = profileUrl.trim();
    if (!/^https:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9_%.-]+\/?(?:\?.*)?$/i.test(url)) {
      setError("Valid LinkedIn profile URL enter pannunga.");
      return;
    }
    setExtracting(true);
    try {
      const response = await fetch(`${API}/profiles/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileUrl: url })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Profile extraction failed.");
      setProfiles((current) => [result, ...current.filter((item) => item.id !== result.id)]);
      setProfileUrl("");
      setNotice("Profile extracted and saved successfully.");
    } catch (err) {
      setError(err.message || "Unable to extract profile.");
    } finally { setExtracting(false); }
  }

  async function saveMyProfile() {
    setError(""); setNotice(""); setSavingMyProfile(true);
    try {
      const response = await fetch(`${API}/auth/save-my-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ profileUrl: linkedinProfileUrl.trim() })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not save LinkedIn profile.");
      setProfiles((current) => [result, ...current.filter((item) => item.id !== result.id)]);
      setNotice("Your LinkedIn basic profile has been saved or updated.");
    } catch (err) {
      setError(err.message || "Unable to save your profile.");
    } finally { setSavingMyProfile(false); }
  }


function startEdit(profile) {
  setEditingProfile(profile);
  setEditForm({
    name: profile.name || "",
    headline: profile.headline || "",
    company: profile.company || "",
    location: profile.location || "",
    email: profile.email || "",
    phone: profile.phone || ""
  });

  setError("");
  setNotice("");
}

async function saveEdit(event) {
  event.preventDefault();
  if (!editingProfile) return;

  setSavingEdit(true);
  setError("");
  setNotice("");

  try {
    const response = await fetch(
      `${API}/profiles/${encodeURIComponent(editingProfile.id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm)
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Profile update failed.");
    }

    const updated = result.profile;

    setProfiles(current =>
      current.map(item =>
        String(item.id) === String(updated.id) ? updated : item
      )
    );

    setEditingProfile(null);
    setNotice("Profile updated successfully.");
  } catch (err) {
    setError(err.message || "Unable to update profile.");
  } finally {
    setSavingEdit(false);
  }
}

function deleteProfile(profile) {
  setDeletingProfile(profile);
}

async function confirmDelete() {
  if (!deletingProfile) return;

  setDeleting(true);
  setError("");
  setNotice("");

  try {
    const response = await fetch(
      `${API}/profiles/${encodeURIComponent(deletingProfile.id)}`,
      { method: "DELETE" }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Profile deletion failed.");
    }

    setProfiles(current =>
      current.filter(
        item => String(item.id) !== String(deletingProfile.id)
      )
    );

    setDeletingProfile(null);
    setNotice("Profile deleted successfully.");
  } catch (err) {
    setError(err.message || "Unable to delete profile.");
  } finally {
    setDeleting(false);
  }
}


  async function logout() {
    try {
      await fetch(`${API}/auth/logout`, { method: "POST", credentials: "include" });
    } finally {
      setAuthUser(null);
      setNotice("LinkedIn account signed out.");
    }
  }

  return (
    <main className="page">
      <header className="topbar">
        <div className="brand"><span className="brandIcon"><Linkedin size={22} /></span><div><strong>ProfileDesk</strong><small>LinkedIn data viewer</small></div></div>
        {/* <div className="authActions">
          {authUser ? (
            <>
              <span className="signedInUser"><UserRound size={15}/><span>{authUser.name || authUser.email || "LinkedIn member"}</span></span>
              <div className="saveProfileControls">
                <input aria-label="Your LinkedIn profile URL" type="url" value={linkedinProfileUrl} onChange={(event) => setLinkedinProfileUrl(event.target.value)} placeholder="Paste your LinkedIn profile URL (optional)" />
                <button className="secondaryBtn" onClick={saveMyProfile} disabled={savingMyProfile}><Save size={15}/>{savingMyProfile ? "Saving..." : "Save My Profile"}</button>
              </div>
              <button className="iconBtn" onClick={logout} title="Sign out" type="button"><LogOut size={16}/></button>
            </>
          ) : (
            <button className="primaryBtn" type="button" onClick={() => { window.location.href = `${API_ORIGIN}/auth/linkedin`; }} disabled={authLoading}><LogIn size={15}/>{authLoading ? "Checking..." : "Sign in with LinkedIn"}</button>
          )}
          <span className="apiStatus"><i /> Backend API</span>
        </div> */}
      </header>

      <section className="hero">
        <div><p className="eyebrow">LINKEDIN PROFILE EXTRACTION</p><h1>LinkedIn Profiles</h1><p className="subtext">Sign in to save your own LinkedIn basic profile, or view records already stored in this app.</p></div>
      </section>

      {/* <form className="extractPanel" onSubmit={extractProfile}>
        <div className="extractHeading"><div><h2>Extract LinkedIn Profile</h2><p>Other members' profile extraction requires separate LinkedIn-approved API access.</p></div><span className="extractIcon"><DownloadCloud size={20}/></span></div>
        <div className="extractControls">
          <input aria-label="LinkedIn profile URL" type="url" value={profileUrl} onChange={(event) => setProfileUrl(event.target.value)} placeholder="https://www.linkedin.com/in/profile-name/" required />
          <button className="primaryBtn" type="submit" disabled={extracting || !profileUrl.trim()}>{extracting ? "Checking..." : "Extract Profile"}</button>
        </div>
      </form> */}

      {error && <div className="errorBox"><AlertCircle size={15}/>{error}</div>}
      {notice && <div className="successBox"><CheckCircle2 size={15}/>{notice}</div>}

      <section className="stats">
        <div className="statCard"><span className="statIcon"><Users size={19} /></span><div><small>Total profiles</small><strong>{profiles.length}</strong></div></div>
        <div className="statCard"><span className="statIcon blue"><Linkedin size={19} /></span><div><small>Showing results</small><strong>{filtered.length}</strong></div></div>
      </section>

      <section className="tablePanel">
        <div className="tableToolbar"><div><h2>Profile records</h2><p>LinkedIn member data saved in the application</p></div><div className="toolbarActions"><div className="searchBox"><Search size={17}/><input value={search} onChange={(event) =>{ setSearch(event.target.value);setCurrentPage(1);}} placeholder="Search name, designation, company, email, phone..." /></div><button className="iconBtn" onClick={() => loadProfiles()} title="Refresh" type="button"><RefreshCw size={17}/></button></div></div>

{viewingProfile && (
  <div className="modalBackdrop" onClick={() => setViewingProfile(null)}>
    <div
      className="detailsModal"
      onClick={(e) => e.stopPropagation()}
      style={{ maxWidth: "780px", width: "95%" }}
    >
      <div className="modalHeader" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          {viewingProfile.photoUrl && viewingProfile.photoUrl !== "Not Available" ? (
            <img
              src={viewingProfile.photoUrl}
              alt=""
              style={{ width: "64px", height: "64px", borderRadius: "50%", objectFit: "cover" }}
              referrerPolicy="no-referrer"
            />
          ) : (
            <div
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "50%",
                background: "#e2e8f0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: "bold",
                fontSize: "24px",
                color: "#475569"
              }}
            >
              {(viewingProfile.name || "?").charAt(0)}
            </div>
          )}
          <div>
            <h2 style={{ margin: "0 0 4px", fontSize: "20px" }}>{viewingProfile.name || "Not Available"}</h2>
            <p style={{ margin: "0 0 4px", color: "#475569", fontWeight: 500, fontSize: "14px" }}>
              {viewingProfile.designation || viewingProfile.headline || "Not Available"}
            </p>
            <p style={{ margin: 0, color: "#64748b", fontSize: "13px" }}>
              🏢 {viewingProfile.company || "Not Available"} • 📍 {[viewingProfile.city, viewingProfile.country].filter(c => c && c !== "Not Available").join(", ") || viewingProfile.location || "Not Available"}
            </p>
            <div style={{ display: "flex", gap: "10px", marginTop: "6px", fontSize: "12px", color: "#334155" }}>
              <span><strong>Gender:</strong> {viewingProfile.gender || "Not Available"}</span>
              <span>•</span>
              <span><strong>Experience:</strong> {viewingProfile.experienceYears ? `${viewingProfile.experienceYears} yr(s)` : "Not Available"}</span>
              <span>•</span>
              <span><strong>Headline:</strong> {viewingProfile.headLine || "Not Available"}</span>
            </div>
          </div>
        </div>

        <button
          className="closeBtn"
          type="button"
          onClick={() => setViewingProfile(null)}
          style={{ background: "none", border: "none", fontSize: "24px", cursor: "pointer", color: "#64748b" }}
        >
          ×
        </button>
      </div>

      <div style={{ marginTop: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Contact Information */}
        <div style={{ background: "#f8fafc", padding: "14px 16px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
          <h3 style={{ fontSize: "13px", margin: "0 0 10px", color: "#0f172a", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            📞 Contact Information
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
            <div>
              <span style={{ fontSize: "12px", color: "#64748b" }}>Business Email</span>
              <div style={{ fontWeight: 600, color: "#1e293b", fontSize: "14px" }}>{viewingProfile.email || "Not Available"}</div>
            </div>
            <div>
              <span style={{ fontSize: "12px", color: "#64748b" }}>Personal Email</span>
              <div style={{ fontWeight: 600, color: "#1e293b", fontSize: "14px" }}>{viewingProfile.personalEmail || "Not Available"}</div>
            </div>
            <div>
              <span style={{ fontSize: "12px", color: "#64748b" }}>Mobile Phone</span>
              <div style={{ fontWeight: 600, color: "#1e293b", fontSize: "14px" }}>{viewingProfile.phone || "Not Available"}</div>
            </div>
          </div>
        </div>

        {/* Work Experience */}
        <div>
          <h3 style={{ fontSize: "13px", margin: "0 0 10px", color: "#0f172a", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            💼 Work Experience ({viewingProfile.experiences?.length || 0})
          </h3>
          {viewingProfile.experiences && viewingProfile.experiences.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {viewingProfile.experiences.map((exp, idx) => (
                <div key={idx} style={{ padding: "10px 14px", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <strong style={{ color: "#0f172a", fontSize: "14px" }}>{exp.position || "Not Available"}</strong>
                    <span style={{ fontSize: "12px", color: "#64748b" }}>
                      {[exp.started, exp.ended].filter(Boolean).join(" - ") || (exp.current ? "Present" : "")}
                    </span>
                  </div>
                  <div style={{ color: "#2563eb", fontSize: "13px", fontWeight: 500, margin: "2px 0 4px" }}>
                    {exp.company || "Not Available"}
                  </div>
                  {exp.summary && <p style={{ fontSize: "12px", color: "#475569", margin: "4px 0 0" }}>{exp.summary}</p>}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: "#64748b", fontSize: "13px", fontStyle: "italic" }}>Not Available</div>
          )}
        </div>

        {/* Education Details */}
        <div>
          <h3 style={{ fontSize: "13px", margin: "0 0 10px", color: "#0f172a", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            🎓 Education Details ({viewingProfile.educations?.length || 0})
          </h3>
          {viewingProfile.educations && viewingProfile.educations.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {viewingProfile.educations.map((edu, idx) => (
                <div key={idx} style={{ padding: "10px 14px", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <strong style={{ color: "#0f172a", fontSize: "14px" }}>{edu.university || "Not Available"}</strong>
                    <span style={{ fontSize: "12px", color: "#64748b" }}>
                      {[edu.startedYear, edu.endedYear].filter(Boolean).join(" - ")}
                    </span>
                  </div>
                  <div style={{ color: "#475569", fontSize: "13px", marginTop: "2px" }}>
                    {[edu.degree, edu.faculty].filter(Boolean).join(" • ") || "Not Available"}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: "#64748b", fontSize: "13px", fontStyle: "italic" }}>Not Available</div>
          )}
        </div>

        {/* Skills */}
        <div>
          <h3 style={{ fontSize: "13px", margin: "0 0 10px", color: "#0f172a", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            ⭐ Skills ({viewingProfile.skills?.length || 0})
          </h3>
          {viewingProfile.skills && viewingProfile.skills.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {viewingProfile.skills.map((skill, idx) => (
                <span
                  key={idx}
                  style={{
                    background: "#eff6ff",
                    color: "#1d4ed8",
                    border: "1px solid #bfdbfe",
                    padding: "3px 8px",
                    borderRadius: "12px",
                    fontSize: "12px",
                    fontWeight: 500
                  }}
                >
                  {skill}
                </span>
              ))}
            </div>
          ) : (
            <div style={{ color: "#64748b", fontSize: "13px", fontStyle: "italic" }}>Not Available</div>
          )}
        </div>

        {/* Footer / Social Link */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "14px", borderTop: "1px solid #e2e8f0" }}>
          {viewingProfile.profileUrl && viewingProfile.profileUrl !== "Not Available" ? (
            <a
              href={viewingProfile.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                color: "#0a66c2",
                fontWeight: 600,
                textDecoration: "none",
                fontSize: "13px"
              }}
            >
              <Linkedin size={16} /> Open LinkedIn Profile ↗
            </a>
          ) : (
            <span style={{ fontSize: "12px", color: "#64748b" }}>LinkedIn: Not Available</span>
          )}

          <button
            type="button"
            className="editBtn"
            onClick={() => {
              const p = viewingProfile;
              setViewingProfile(null);
              startEdit(p);
            }}
          >
            Edit Profile
          </button>
        </div>
      </div>
    </div>
  </div>
)}

{editingProfile && (
  <div className="modalBackdrop" onClick={() => setEditingProfile(null)}>
    <form
      className="detailsModal editModal"
      onSubmit={saveEdit}
      onClick={e => e.stopPropagation()}
    >
      <div className="modalHeader">
        <div>
          <p className="eyebrow">PROFILE MANAGEMENT</p>
          <h2>Edit Profile</h2>
          <p>Update LinkedIn profile details.</p>
        </div>

        <button
          className="closeBtn"
          type="button"
          onClick={() => setEditingProfile(null)}
        >
          ×
        </button>
      </div>

      <div className="formGrid editFormGrid">
        {[
          ["name", "Name"],
          ["headline", "Designation"],
          ["company", "Company Name"],
          ["location", "Location"],
          ["email", "Email"],
          ["phone", "Phone"]
        ].map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              value={editForm[key]}
              onChange={e =>
                setEditForm(current => ({
                  ...current,
                  [key]: e.target.value
                }))
              }
            />
          </label>
        ))}
      </div>

      <div className="formActions">
        <button
          className="secondaryBtn"
          type="button"
          onClick={() => setEditingProfile(null)}
        >
          Cancel
        </button>

        <button className="primaryBtn" type="submit" disabled={savingEdit}>
          {savingEdit ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  </div>
)}


{deletingProfile && (
  <div
    className="modalBackdrop"
    onClick={() => !deleting && setDeletingProfile(null)}
  >
    <div
      className="deleteConfirmModal"
      onClick={e => e.stopPropagation()}
    >
      <div className="deleteIcon">
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="m19 6-1 14H6L5 6" />
          <path d="M10 11v5M14 11v5" />
        </svg>
      </div>

      <h2>Delete Profile?</h2>

      <p>
        Are you sure you want to delete
        <strong> {deletingProfile.name}</strong>?
      </p>

      <p className="deleteWarning">
        This action cannot be undone. The profile will be permanently removed.
      </p>

      <div className="deleteModalActions">
        <button
          type="button"
          className="cancelDeleteBtn"
          disabled={deleting}
          onClick={() => setDeletingProfile(null)}
        >
          Cancel
        </button>

        <button
          type="button"
          className="confirmDeleteBtn"
          disabled={deleting}
          onClick={confirmDelete}
        >
          {deleting ? "Deleting..." : "Yes, Delete"}
        </button>
      </div>
    </div>
  </div>
)}


        <div className="tableWrap"><table><thead><tr>
      <th style={{ width: "65px", minWidth: "65px" }}>PHOTO</th>
      <th style={{ width: "160px", minWidth: "160px" }}>NAME</th>
      <th style={{ width: "100px", minWidth: "100px" }}>GENDER</th>
      <th style={{ width: "110px", minWidth: "110px" }}>EXP YEARS</th>
      <th style={{ width: "220px", minWidth: "220px" }}>HEADLINE</th>
      <th style={{ width: "180px", minWidth: "180px" }}>DESIGNATION</th>
      <th style={{ width: "150px", minWidth: "150px" }}>COMPANY</th>
      <th style={{ width: "160px", minWidth: "160px" }}>LOCATION</th>
      <th style={{ width: "210px", minWidth: "210px" }}>EMAIL</th>
      <th style={{ width: "140px", minWidth: "140px" }}>PHONE</th>
      <th style={{ width: "260px", minWidth: "260px" }}>EXPERIENCE</th>
      <th style={{ width: "260px", minWidth: "260px" }}>EDUCATION</th>
      <th style={{ width: "220px", minWidth: "220px" }}>SKILLS</th>
      <th style={{ width: "160px", minWidth: "160px" }}>LANGUAGE</th>
      <th style={{ width: "180px", minWidth: "180px" }}>COURSE</th>
      <th style={{ width: "200px", minWidth: "200px" }}>PROJECT</th>
      <th style={{ width: "200px", minWidth: "200px" }}>CERTIFICATION</th>
      <th style={{ width: "160px", minWidth: "160px" }}>PATENT</th>
      <th style={{ width: "180px", minWidth: "180px" }}>PUBLICATION</th>
      <th style={{ width: "180px", minWidth: "180px" }}>HONOR AWARD</th>
      <th style={{ width: "180px", minWidth: "180px" }}>ORGANIZATION</th>
      <th style={{ width: "130px", minWidth: "130px" }}>LINKEDIN URL</th>
      <th style={{ width: "170px", minWidth: "170px" }}>ACTION</th>
    </tr></thead>
    <tbody>{loading ? (
      <tr><td colSpan="23" className="empty">Loading profiles...</td></tr>
    ) : filtered.length === 0 ? (
      <tr><td colSpan="23" className="empty">No profiles found. Save profile details from the LinkedIn extension.</td></tr>
    ) : (
      paginatedProfiles.map((profile) => (
        <tr key={profile.id}>
          {/* 1. PHOTO */}
          <td>
            {profile.photoUrl && profile.photoUrl !== "Not Available" ? (
              <img className="profileAvatar" src={profile.photoUrl} alt="" referrerPolicy="no-referrer"/>
            ) : (
              <span className="notAvailablePhoto">Not Available</span>
            )}
          </td>

          {/* 2. NAME */}
          <td>
            <div className="tableNameWrap">
              <strong className="profileNameText">{profile.name || "Not Available"}</strong>
            </div>
          </td>

          {/* 3. GENDER */}
          <td>
            {profile.gender && profile.gender !== "Not Available" ? (
              <span className="tableSolidText">{profile.gender}</span>
            ) : (
              <span className="emptyCellText">Not Available</span>
            )}
          </td>

          {/* 4. EXP YEARS */}
          <td>
            {profile.experienceYears !== null && profile.experienceYears !== undefined && profile.experienceYears !== "" && profile.experienceYears !== "Not Available" ? (
              <span className="tableSolidText">{profile.experienceYears} yr{Number(profile.experienceYears) === 1 ? "" : "s"}</span>
            ) : (
              <span className="emptyCellText">Not Available</span>
            )}
          </td>

          {/* 5. HEADLINE */}
          <td>
            {profile.headLine && profile.headLine !== "Not Available" ? (
              <div className="tableHeadlineText">{profile.headLine}</div>
            ) : (
              <span className="emptyCellText">Not Available</span>
            )}
          </td>

          {/* 6. DESIGNATION */}
          <td>
            <div className="tableDesignationText">
              {profile.designation || profile.headline || "Not Available"}
            </div>
          </td>

          {/* 7. COMPANY */}
          <td>
            <div className="tableCompanyWrap">
              <strong className="tableCompanyText">{profile.company || "Not Available"}</strong>
              {profile.experiences?.[0]?.industry ? (
                <div className="tableSubMeta">{profile.experiences[0].industry}</div>
              ) : null}
            </div>
          </td>

          {/* 8. LOCATION */}
          <td>
            <div className="tableLocationText">
              {[profile.city, profile.country].filter(c => c && c !== "Not Available").join(", ") || profile.location || "Not Available"}
            </div>
          </td>

          {/* 9. EMAIL */}
          <td>
            <div className="tableContactCol">
              <div className="tableEmailPrimary">{profile.email || "Not Available"}</div>
              {profile.personalEmail && profile.personalEmail !== profile.email ? (
                <div className="tableEmailSecondary">
                  Personal: {profile.personalEmail}
                </div>
              ) : null}
            </div>
          </td>

          {/* 10. PHONE */}
          <td>
            <div className="tablePhonePrimary">{profile.phone || "Not Available"}</div>
          </td>

          {/* 11. EXPERIENCE */}
          <td>
            {profile.experiences && profile.experiences.length > 0 ? (
              <div className="tableCellList">
                {profile.experiences.map((exp, idx) => (
                  <div key={idx} className="tableCellListItem">
                    <div className="tableItemHead">
                      <strong>{exp.position || "Position"}</strong>
                      {exp.company && exp.company !== "Not Available" ? ` @ ${exp.company}` : ""}
                    </div>
                    <div className="tableItemSub">
                      {[exp.started, exp.ended].filter(Boolean).join(" - ") || (exp.current ? "Present" : "")}
                      {exp.location ? ` • ${exp.location}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <span className="emptyCellText">Not Available</span>
            )}
          </td>

          {/* 12. EDUCATION */}
          <td>
            {profile.educations && profile.educations.length > 0 ? (
              <div className="tableCellList">
                {profile.educations.map((edu, idx) => (
                  <div key={idx} className="tableCellListItem">
                    <div className="tableItemHead">
                      <strong>{edu.degree || "Degree"}</strong>
                      {edu.faculty ? ` in ${edu.faculty.trim()}` : ""}
                    </div>
                    <div className="tableItemSub">
                      {edu.university || "University"}
                      {[edu.startedYear, edu.endedYear].filter(Boolean).length > 0
                        ? ` (${[edu.startedYear, edu.endedYear].filter(Boolean).join(" - ")})`
                        : ""}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <span className="emptyCellText">Not Available</span>
            )}
          </td>

          {/* 13. SKILLS */}
          <td>
            {profile.skills && profile.skills.length > 0 ? (
              <div className="tableSkillsCell">
                <div className="tableSkillChips">
                  {profile.skills.slice(0, 4).map((skill, idx) => (
                    <span key={idx} className="tableSkillChip">{skill}</span>
                  ))}
                </div>
                {profile.skills.length > 4 && (
                  <button
                    type="button"
                    className="tableMoreBtn"
                    onClick={() => setViewingProfile(profile)}
                    title="Click to view all skills"
                  >
                    +{profile.skills.length - 4} more
                  </button>
                )}
              </div>
            ) : (
              <span className="emptyCellText">Not Available</span>
            )}
          </td>

          {/* 14. LANGUAGE */}
          <td>{renderPills(profile.language || profile.languages, 3)}</td>

          {/* 15. COURSE */}
          <td>{renderPills(profile.course || profile.courses, 3)}</td>

          {/* 16. PROJECT */}
          <td>{renderPills(profile.project || profile.projects, 2)}</td>

          {/* 17. CERTIFICATION */}
          <td>{renderPills(profile.certification || profile.certifications, 2)}</td>

          {/* 18. PATENT */}
          <td>{renderPills(profile.patent || profile.patents, 2)}</td>

          {/* 19. PUBLICATION */}
          <td>{renderPills(profile.publication || profile.publications, 2)}</td>

          {/* 20. HONOR AWARD */}
          <td>{renderPills(profile.honorAward || profile.honorAwards || profile.honors, 2)}</td>

          {/* 21. ORGANIZATION */}
          <td>{renderPills(profile.organization || profile.organizations, 2)}</td>

          {/* 22. LINKEDIN URL */}
          <td>
            {profile.profileUrl && profile.profileUrl !== "Not Available" ? (
              <a
                href={profile.profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="tableLinkedinLink"
                title={profile.profileUrl}
              >
                <Linkedin size={13} />
                <span>Profile ↗</span>
              </a>
            ) : (
              <span className="emptyCellText">Not Available</span>
            )}
          </td>

          {/* 23. ACTION */}
          <td>
            <div className="actionButtons">
              <button
                className="viewBtn"
                type="button"
                onClick={() => setViewingProfile(profile)}
                title="View full candidate details"
              >
                View
              </button>
              <button
                className="editBtn"
                type="button"
                onClick={() => startEdit(profile)}
              >
                Edit
              </button>
              <button
                className="deleteBtn"
                type="button"
                onClick={() => setDeletingProfile(profile)}
              >
                Delete
              </button>
            </div>
          </td>
        </tr>
      ))
    )}</tbody></table></div>
        <div className="paginationContainer">
          <div className="paginationInfo">
            Showing <strong>{firstItem}-{lastItem}</strong> of{" "}
            <strong>{filtered.length}</strong> profiles
          </div>

          <div className="paginationControls">
            <div className="itemsPerPage">
              <span>Rows per page</span>

              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <button
              className="pageBtn"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((page) => page - 1)}
            >
              Previous
            </button>

            <span className="currentPage">
              {currentPage} / {Math.max(totalPages, 1)}
            </span>

            <button
              className="pageBtn"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((page) => page + 1)}
            >
              Next
            </button>
          </div>
        </div>
        <div className="tableFooter">Showing {filtered.length} of {profiles.length} profiles <span>Profile details received from LinkedIn Contact Finder</span></div>
      </section>
      <footer>ProfileDesk <span>•</span> React + Express</footer>

    </main>
  );
}