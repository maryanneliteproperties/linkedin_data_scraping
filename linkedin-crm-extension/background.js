const API_BASE = "http://localhost:5000/api";
const AUTH_STORAGE_KEY = "linkedin_crm_extension_auth";

async function getStoredAuth() {
  const result = await chrome.storage.local.get(AUTH_STORAGE_KEY);
  return result[AUTH_STORAGE_KEY] || null;
}

async function sendAuthStatus(sendResponse) {
  const auth = await getStoredAuth();
  if (!auth?.token || !auth?.user) {
    sendResponse({ success: true, authenticated: false });
    return;
  }
  sendResponse({ success: true, authenticated: true, user: auth.user });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id && tab.url && tab.url.includes("linkedin.com/in/")) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "toggle" });
    } catch (err) {
      console.warn("[Background] Tab communication failed (refresh tab):", err);
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "EXTENSION_AUTH_STATUS" || message.type === "EXTENSION_GET_SESSION") {
    getStoredAuth()
      .then((auth) => sendResponse({
        success: true,
        authenticated: Boolean(auth?.token && auth?.user),
        user: auth?.user || null
      }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === "EXTENSION_LOGIN") {
    (async () => {
      try {
        const credentials = message.credentials || message;
        const role = String(credentials.role || "");
        if (!["Admin", "Sub Admin"].includes(role)) {
          throw new Error("Only Admin and Sub Admin can use this extension.");
        }
        const response = await fetch(`${API_BASE}/extension/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role,
            username: String(credentials.username || "").trim(),
            pin: String(credentials.pin || "").trim()
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.token || !data.user || !["Admin", "Sub Admin"].includes(data.user.role)) {
          throw new Error(data.message || "Login failed. Please check your credentials.");
        }
        await chrome.storage.local.set({
          [AUTH_STORAGE_KEY]: { token: data.token, user: data.user }
        });
        sendResponse({ success: true, user: data.user });
      } catch (error) {
        sendResponse({ success: false, message: error.message || "Unable to log in." });
      }
    })();
    return true;
  }

  if (message.type === "EXTENSION_LOGOUT") {
    (async () => {
      try {
        const auth = await getStoredAuth();
        if (auth?.token) {
          await fetch(`${API_BASE}/extension/auth/logout`, {
            method: "POST",
            headers: { Authorization: `Bearer ${auth.token}` }
          }).catch(() => {});
        }
        await chrome.storage.local.remove(AUTH_STORAGE_KEY);
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.type === "SIGNALHIRE_ENRICH") {
    (async () => {
      try {
        const auth = await getStoredAuth();
        if (!auth?.token) throw new Error("Please log in to the LinkedIn extension.");
        const response = await fetch(`${API_BASE}/profiles/signalhire`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({ profileUrl: message.profileUrl })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || `SignalHire request failed (${response.status})`);
        sendResponse(data);
      } catch (error) {
        sendResponse({ success: false, message: error.message || "SignalHire request failed." });
      }
    })();
    return true;
  }

  if (message.type === "SAVE_LINKEDIN_PROFILE") {
    (async () => {
      try {
        const auth = await getStoredAuth();
        if (!auth?.token || !["Admin", "Sub Admin"].includes(auth.user?.role)) {
          throw new Error("Please log in as Admin or Sub Admin before saving a profile.");
        }
        const p = message.profile || {};
        if (!p.name || p.name === "Not Available" || !p.profileUrl || p.profileUrl === "Not Available") {
          throw new Error("Valid profile name and LinkedIn URL are required to save.");
        }

        const response = await fetch(`${API_BASE}/profiles`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({
            name: p.name,
            photoUrl: p.photoUrl || p.avatar || "Not Available",
            designation: p.designation || p.headline || "Not Available",
            company: p.company || "Not Available",
            location: p.location || "Not Available",
            city: p.city || "Not Available",
            country: p.country || "Not Available",
            email: p.email || "Not Available",
            personalEmail: p.personalEmail || "",
            phone: p.phone || "Not Available",
            allEmails: Array.isArray(p.allEmails) ? p.allEmails : [],
            allPhones: Array.isArray(p.allPhones) ? p.allPhones : [],
            experiences: Array.isArray(p.experiences) ? p.experiences : [],
            educations: Array.isArray(p.educations) ? p.educations : [],
            skills: Array.isArray(p.skills) ? p.skills : [],
            profileUrl: p.profileUrl
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || `Failed to save profile (${response.status})`);
        sendResponse({ success: true, profile: data.profile || data });
      } catch (error) {
        console.error("[Background] Profile save failed:", error);
        sendResponse({ success: false, message: error.message || "Profile save failed.", error: error.message || "Profile save failed." });
      }
    })();
    return true;
  }
});
