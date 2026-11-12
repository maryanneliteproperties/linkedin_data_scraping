import { useEffect, useMemo, useState } from "react";
import { Search, Linkedin, Plus, RefreshCw, ExternalLink, Users } from "lucide-react";

const API = "http://localhost:5000/api";

export default function App() {
  const [profiles, setProfiles] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "", headline: "", company: "", location: "",
    experience: "", education: "", skills: "", profileUrl: ""
  });

  async function loadProfiles() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API}/profiles`);
      if (!response.ok) throw new Error("Could not load profiles.");
      setProfiles(await response.json());
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
    return profiles.filter(p =>
      [p.name, p.headline, p.company, p.location, ...(p.skills || [])]
        .join(" ").toLowerCase().includes(term)
    );
  }, [profiles, search]);

  function updateField(event) {
    setForm(current => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function submitProfile(event) {
    event.preventDefault();
    setError("");
    try {
      const response = await fetch(`${API}/profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          skills: form.skills.split(",").map(s => s.trim()).filter(Boolean)
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to save profile.");
      setForm({ name: "", headline: "", company: "", location: "", experience: "", education: "", skills: "", profileUrl: "" });
      setShowForm(false);
      await loadProfiles();
    } catch (err) {
      setError(err.message || "Unable to save profile.");
    }
  }

  return (
    <main className="page">
      <header className="topbar">
        <div className="brand"><span className="brandIcon"><Linkedin size={22} /></span><div><strong>ProfileDesk</strong><small>LinkedIn data viewer</small></div></div>
        <span className="apiStatus"><i /> JSON storage connected via API</span>
      </header>

      <section className="hero">
        <div><p className="eyebrow">PROFILE MANAGEMENT</p><h1>LinkedIn Profiles</h1><p className="subtext">Store profile details as JSON and view them in one simple table.</p></div>
        <button className="primaryBtn" onClick={() => setShowForm(v => !v)}><Plus size={17} /> Add profile</button>
      </section>

      {showForm && <form className="formPanel" onSubmit={submitProfile}>
        <div className="formHeading"><div><h2>Add profile details</h2><p>Enter data you are authorized to store.</p></div><button type="button" className="closeBtn" onClick={() => setShowForm(false)}>×</button></div>
        <div className="formGrid">
          <label>Full name *<input name="name" value={form.name} onChange={updateField} required placeholder="e.g. Arun Kumar" /></label>
          <label>Job title<input name="headline" value={form.headline} onChange={updateField} placeholder="e.g. Data Analyst" /></label>
          <label>Company<input name="company" value={form.company} onChange={updateField} placeholder="Company name" /></label>
          <label>Location<input name="location" value={form.location} onChange={updateField} placeholder="City, Country" /></label>
          <label>Experience<input name="experience" value={form.experience} onChange={updateField} placeholder="e.g. 3 years" /></label>
          <label>Education<input name="education" value={form.education} onChange={updateField} placeholder="Degree / Institution" /></label>
          <label className="wide">Skills <input name="skills" value={form.skills} onChange={updateField} placeholder="SQL, Power BI, Python (comma separated)" /></label>
          <label className="wide">LinkedIn profile URL<input name="profileUrl" value={form.profileUrl} onChange={updateField} placeholder="https://www.linkedin.com/in/..." /></label>
        </div>
        <div className="formActions"><button type="button" className="secondaryBtn" onClick={() => setShowForm(false)}>Cancel</button><button className="primaryBtn" type="submit">Save to JSON</button></div>
      </form>}

      {error && <div className="errorBox">{error}</div>}

      <section className="stats">
        <div className="statCard"><span className="statIcon"><Users size={19} /></span><div><small>Total profiles</small><strong>{profiles.length}</strong></div></div>
        <div className="statCard"><span className="statIcon blue"><Linkedin size={19} /></span><div><small>Showing results</small><strong>{filtered.length}</strong></div></div>
      </section>

      <section className="tablePanel">
        <div className="tableToolbar"><div><h2>Profile records</h2><p>Profile data loaded from backend JSON file</p></div><div className="toolbarActions"><div className="searchBox"><Search size={17}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, role, skills..." /></div><button className="iconBtn" onClick={loadProfiles} title="Refresh"><RefreshCw size={17}/></button></div></div>
        <div className="tableWrap"><table><thead><tr><th>NAME</th><th>JOB TITLE</th><th>COMPANY</th><th>LOCATION</th><th>EXPERIENCE</th><th>SKILLS</th><th>PROFILE</th></tr></thead>
          <tbody>{loading ? <tr><td colSpan="7" className="empty">Loading profiles...</td></tr> : filtered.length === 0 ? <tr><td colSpan="7" className="empty">No profiles found. Add a profile to get started.</td></tr> : filtered.map(p => <tr key={p.id}><td><strong>{p.name}</strong><small className="mobileMeta">{p.education || "—"}</small></td><td>{p.headline || "—"}</td><td>{p.company || "—"}</td><td>{p.location || "—"}</td><td>{p.experience || "—"}</td><td><div className="chips">{(p.skills || []).map(skill => <span key={skill}>{skill}</span>)}</div></td><td>{p.profileUrl ? <a className="profileLink" href={p.profileUrl} target="_blank" rel="noreferrer">View <ExternalLink size={13}/></a> : "—"}</td></tr>)}</tbody>
        </table></div>
        <div className="tableFooter">Showing {filtered.length} of {profiles.length} profiles <span>Storage: backend/data/profiles.json</span></div>
      </section>
      <footer>ProfileDesk <span>•</span> React + Express + JSON</footer>
    </main>
  );
}
