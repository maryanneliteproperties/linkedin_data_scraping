import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Linkedin, Plus, RefreshCw, ExternalLink, Users, Upload,
  X, BriefcaseBusiness, GraduationCap, HeartHandshake, Award, Eye,
  FileJson, CheckCircle2, AlertCircle
} from "lucide-react";

const API = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "") + "/api";
const emptyForm = {
  name: "", headline: "", company: "", location: "", photoUrl: "",
  description: "", experience: "", education: "", skills: "", profileUrl: "",
  experiences: "[]", educations: "[]", volunteerExperience: "[]"
};

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i], next = text[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error("CSV file has no profile rows.");
  const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/[\s-]+/g, ""));
  return rows.slice(1).map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index] || ""])
  )).map((item) => ({
    name: item.name || item.fullname,
    headline: item.headline || item.title || item.jobtitle,
    company: item.company,
    location: item.location,
    profileUrl: item.profileurl || item.linkedinurl || item.url,
    skills: item.skills ? item.skills.split(";").length > 1 ? item.skills.split(";") : item.skills : []
  }));
}

function parseStructured(value, label) {
  try {
    const parsed = JSON.parse(value || "[]");
    if (!Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} must be a valid JSON array.`);
  }
}

function ProfileDetails({ profile, onClose }) {
  if (!profile) return null;
  const Section = ({ icon: Icon, title, items, fields }) => (
    <section className="detailSection">
      <h3><Icon size={16} />{title}</h3>
      {items?.length ? items.map((item, index) => (
        <article className="detailItem" key={index}>
          {fields.map(([label, key]) => item[key] ? <p key={key}><strong>{label}:</strong> {item[key]}</p> : null)}
        </article>
      )) : <p className="muted">No details added.</p>}
    </section>
  );
  const experiences = profile.experiences || [];
  const educations = profile.educations || [];
  const volunteers = profile.volunteerExperience || [];
  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="detailsModal" role="dialog" aria-modal="true" aria-label="Profile details">
        <div className="modalHeader">
          <div><p className="eyebrow">PROFILE DETAILS</p><h2>{profile.name}</h2><p>{profile.headline || "—"}{profile.company ? ` · ${profile.company}` : ""}</p></div>
          <button className="closeBtn" onClick={onClose} aria-label="Close"><X size={19}/></button>
        </div>
        {profile.description && <p className="profileDescription">{profile.description}</p>}
        <div className="detailGrid">
          <div><small>Location</small><strong>{profile.location || "—"}</strong></div>
          <div><small>Experience</small><strong>{profile.experience || "—"}</strong></div>
          <div><small>Education</small><strong>{profile.education || "—"}</strong></div>
          <div><small>Data source</small><strong>{profile.source || "User provided"}</strong></div>
        </div>
        <Section icon={BriefcaseBusiness} title="Experience" items={experiences} fields={[["Role","title"],["Company","company"],["Location","location"],["Duration","duration"],["Dates","dates"],["Description","description"]]} />
        <Section icon={GraduationCap} title="Education" items={educations} fields={[["Institution","school"],["Degree","degree"],["Field","field"],["Dates","dates"]]} />
        <Section icon={HeartHandshake} title="Volunteer experience" items={volunteers} fields={[["Role","role"],["Organization","organization"],["Dates","dates"],["Description","description"]]} />
        <section className="detailSection"><h3><Award size={16}/>Skills</h3><div className="chips detailChips">{(profile.skills || []).length ? profile.skills.map((skill) => <span key={skill}>{skill}</span>) : <p className="muted">No skills added.</p>}</div></section>
        {profile.profileUrl && <a className="profileLink modalProfileLink" href={profile.profileUrl} target="_blank" rel="noreferrer">Open LinkedIn profile <ExternalLink size={14}/></a>}
      </div>
    </div>
  );
}

export default function App() {
  const [profiles, setProfiles] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const fileInput = useRef(null);

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
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadProfiles(); }, []);

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    if (!term) return profiles;
    return profiles.filter((profile) => [
      profile.name, profile.headline, profile.company, profile.location,
      profile.description, ...(profile.skills || [])
    ].join(" ").toLowerCase().includes(term));
  }, [profiles, search]);

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function submitProfile(event) {
    event.preventDefault();
    setError(""); setNotice(""); setSaving(true);
    try {
      const payload = {
        ...form,
        skills: form.skills.split(",").map((skill) => skill.trim()).filter(Boolean),
        experiences: parseStructured(form.experiences, "Experience"),
        educations: parseStructured(form.educations, "Education"),
        volunteerExperience: parseStructured(form.volunteerExperience, "Volunteer experience")
      };
      const response = await fetch(`${API}/profiles`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to save profile.");
      setProfiles((current) => [data, ...current]);
      setForm(emptyForm); setShowForm(false);
      setNotice("Profile saved successfully.");
    } catch (err) {
      setError(err.message || "Unable to save profile.");
    } finally { setSaving(false); }
  }

  async function importFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(""); setNotice("");
    try {
      const text = await file.text();
      let imported;
      if (file.name.toLowerCase().endsWith(".json")) {
        const parsed = JSON.parse(text);
        imported = Array.isArray(parsed) ? parsed : parsed.profiles;
      } else if (file.name.toLowerCase().endsWith(".csv")) imported = parseCsv(text);
      else throw new Error("Please select a JSON or CSV file.");
      if (!Array.isArray(imported) || !imported.length) throw new Error("No profile records found in this file.");
      const response = await fetch(`${API}/profiles/import`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profiles: imported })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Import failed.");
      await loadProfiles(false);
      setNotice(`Import complete: ${result.imported} added, ${result.duplicates} duplicates skipped, ${result.failed} invalid.`);
    } catch (err) { setError(err.message || "Unable to import file."); }
    finally { event.target.value = ""; }
  }

  return (
    <main className="page">
      <header className="topbar">
        <div className="brand"><span className="brandIcon"><Linkedin size={22} /></span><div><strong>ProfileDesk</strong><small>LinkedIn data viewer</small></div></div>
        <span className="apiStatus"><i /> JSON storage connected via API</span>
      </header>

      <section className="hero">
        <div><p className="eyebrow">PROFILE MANAGEMENT</p><h1>LinkedIn Profiles</h1><p className="subtext">Manage structured profile information in one place.</p></div>
        <div className="heroActions">
          <input ref={fileInput} type="file" accept=".json,.csv,application/json,text/csv" hidden onChange={importFile}/>
          <button className="secondaryBtn" onClick={() => fileInput.current?.click()}><Upload size={16}/> Import</button>
          <button className="primaryBtn" onClick={() => { setShowForm((value) => !value); setNotice(""); }}><Plus size={17} /> Add profile</button>
        </div>
      </section>

      {showForm && <form className="formPanel" onSubmit={submitProfile}>
        <div className="formHeading"><div><h2>Add profile details</h2><p>Enter profile information you are authorized to store. Structured sections accept JSON arrays.</p></div><button type="button" className="closeBtn" onClick={() => setShowForm(false)} aria-label="Close"><X size={19}/></button></div>
        <div className="formGrid">
          <label>Full name *<input name="name" value={form.name} onChange={updateField} required placeholder="e.g. Arun Kumar" /></label>
          <label>Job title<input name="headline" value={form.headline} onChange={updateField} placeholder="e.g. Data Analyst" /></label>
          <label>Company<input name="company" value={form.company} onChange={updateField} placeholder="Company name" /></label>
          <label>Location<input name="location" value={form.location} onChange={updateField} placeholder="City, Country" /></label>
          <label>Experience summary<input name="experience" value={form.experience} onChange={updateField} placeholder="e.g. 3 years" /></label>
          <label>Education summary<input name="education" value={form.education} onChange={updateField} placeholder="Degree / Institution" /></label>
          <label>Profile photo URL<input name="photoUrl" value={form.photoUrl} onChange={updateField} placeholder="https://..." /></label>
          <label>LinkedIn profile URL<input name="profileUrl" value={form.profileUrl} onChange={updateField} placeholder="https://www.linkedin.com/in/..." /></label>
          <label className="wide">Skills<input name="skills" value={form.skills} onChange={updateField} placeholder="SQL, Power BI, Python (comma separated)" /></label>
          <label className="wide">Profile description<textarea name="description" value={form.description} onChange={updateField} rows="3" placeholder="Profile summary / about" /></label>
          <label className="wide">Experience details (JSON array)<textarea name="experiences" value={form.experiences} onChange={updateField} rows="3" spellCheck="false" /></label>
          <label className="wide">Education details (JSON array)<textarea name="educations" value={form.educations} onChange={updateField} rows="3" spellCheck="false" /></label>
          <label className="wide">Volunteer experience (JSON array)<textarea name="volunteerExperience" value={form.volunteerExperience} onChange={updateField} rows="3" spellCheck="false" /></label>
        </div>
        <div className="formActions"><button type="button" className="secondaryBtn" onClick={() => setShowForm(false)}>Cancel</button><button className="primaryBtn" type="submit" disabled={saving}>{saving ? "Saving..." : "Save profile"}</button></div>
      </form>}

      {error && <div className="errorBox"><AlertCircle size={15}/>{error}</div>}
      {notice && <div className="successBox"><CheckCircle2 size={15}/>{notice}</div>}

      <section className="stats">
        <div className="statCard"><span className="statIcon"><Users size={19} /></span><div><small>Total profiles</small><strong>{profiles.length}</strong></div></div>
        <div className="statCard"><span className="statIcon blue"><Linkedin size={19} /></span><div><small>Showing results</small><strong>{filtered.length}</strong></div></div>
      </section>

      <section className="tablePanel">
        <div className="tableToolbar"><div><h2>Profile records</h2><p>Profile data loaded from backend JSON file</p></div><div className="toolbarActions"><div className="searchBox"><Search size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, role, skills..." /></div><button className="iconBtn" onClick={() => loadProfiles()} title="Refresh"><RefreshCw size={17}/></button></div></div>
        <div className="tableWrap"><table><thead><tr><th>NAME</th><th>JOB TITLE</th><th>COMPANY</th><th>LOCATION</th><th>EXPERIENCE</th><th>SKILLS</th><th>PROFILE</th><th>DETAILS</th></tr></thead>
          <tbody>{loading ? <tr><td colSpan="8" className="empty">Loading profiles...</td></tr> : filtered.length === 0 ? <tr><td colSpan="8" className="empty">No profiles found. Add or import profiles to get started.</td></tr> : filtered.map((profile) => <tr key={profile.id}><td><strong>{profile.name}</strong></td><td>{profile.headline || "—"}</td><td>{profile.company || "—"}</td><td>{profile.location || "—"}</td><td>{profile.experience || "—"}</td><td><div className="chips">{(profile.skills || []).slice(0, 3).map((skill) => <span key={skill}>{skill}</span>)}{(profile.skills || []).length > 3 && <span>+{profile.skills.length - 3}</span>}</div></td><td>{profile.profileUrl ? <a className="profileLink" href={profile.profileUrl} target="_blank" rel="noreferrer">View <ExternalLink size={13}/></a> : "—"}</td><td><button className="viewBtn" onClick={() => setSelectedProfile(profile)}><Eye size={14}/> View</button></td></tr>)}</tbody>
        </table></div>
        <div className="tableFooter">Showing {filtered.length} of {profiles.length} profiles <span>Storage: backend/data/profiles.json</span></div>
      </section>
      <footer>ProfileDesk <span>•</span> React + Express + JSON</footer>
      <ProfileDetails profile={selectedProfile} onClose={() => setSelectedProfile(null)}/>
    </main>
  );
}
