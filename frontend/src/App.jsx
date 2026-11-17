import React, { useEffect, useMemo, useState } from "react";
import { Search, Linkedin, RefreshCw, Users, CheckCircle2, AlertCircle, DownloadCloud, LogIn, LogOut, UserRound, Save } from "lucide-react";

const API = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "") + "/api";
const API_ORIGIN = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "");

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
      profile.name, profile.email, profile.headline, profile.company, profile.location,
      profile.description, profile.phone, ...(profile.skills || [])
    ].join(" ").toLowerCase().includes(term));
  }, [profiles, search]);

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
        <div className="authActions">
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
        </div>
      </header>

      <section className="hero">
        <div><p className="eyebrow">LINKEDIN PROFILE EXTRACTION</p><h1>LinkedIn Profiles</h1><p className="subtext">Sign in to save your own LinkedIn basic profile, or view records already stored in this app.</p></div>
      </section>

      <form className="extractPanel" onSubmit={extractProfile}>
        <div className="extractHeading"><div><h2>Extract LinkedIn Profile</h2><p>Other members' profile extraction requires separate LinkedIn-approved API access.</p></div><span className="extractIcon"><DownloadCloud size={20}/></span></div>
        <div className="extractControls">
          <input aria-label="LinkedIn profile URL" type="url" value={profileUrl} onChange={(event) => setProfileUrl(event.target.value)} placeholder="https://www.linkedin.com/in/profile-name/" required />
          <button className="primaryBtn" type="submit" disabled={extracting || !profileUrl.trim()}>{extracting ? "Checking..." : "Extract Profile"}</button>
        </div>
      </form>

      {error && <div className="errorBox"><AlertCircle size={15}/>{error}</div>}
      {notice && <div className="successBox"><CheckCircle2 size={15}/>{notice}</div>}

      <section className="stats">
        <div className="statCard"><span className="statIcon"><Users size={19} /></span><div><small>Total profiles</small><strong>{profiles.length}</strong></div></div>
        <div className="statCard"><span className="statIcon blue"><Linkedin size={19} /></span><div><small>Showing results</small><strong>{filtered.length}</strong></div></div>
      </section>

      <section className="tablePanel">
        <div className="tableToolbar"><div><h2>Profile records</h2><p>LinkedIn member data saved in the application</p></div><div className="toolbarActions"><div className="searchBox"><Search size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, designation, company, email, phone..." /></div><button className="iconBtn" onClick={() => loadProfiles()} title="Refresh" type="button"><RefreshCw size={17}/></button></div></div>
        <div className="tableWrap"><table><thead><tr><th>PHOTO</th><th>NAME</th><th>DESIGNATION</th><th>COMPANY NAME</th><th>LOCATION</th><th>EMAIL</th><th>PHONE NUMBER</th></tr></thead>
          <tbody>{loading ? <tr><td colSpan="7" className="empty">Loading profiles...</td></tr> : filtered.length === 0 ? <tr><td colSpan="7" className="empty">No profiles found. Save profile details from the LinkedIn extension.</td></tr> : filtered.map((profile) => <tr key={profile.id}><td>{profile.photoUrl && profile.photoUrl !== "Not Available" ? <img className="profileAvatar" src={profile.photoUrl} alt="" referrerPolicy="no-referrer"/> : <span className="notAvailablePhoto">Not Available</span>}</td><td><strong>{profile.name || "Not Available"}</strong></td><td>{profile.headline || "Not Available"}</td><td>{profile.company || "Not Available"}</td><td>{profile.location || "Not Available"}</td><td>{profile.email || "Not Available"}</td><td>{profile.phone || "Not Available"}</td></tr>)}</tbody>
        </table></div>
        <div className="tableFooter">Showing {filtered.length} of {profiles.length} profiles <span>Profile details received from LinkedIn Contact Finder</span></div>
      </section>
      <footer>ProfileDesk <span>•</span> React + Express</footer>

    </main>
  );
}
