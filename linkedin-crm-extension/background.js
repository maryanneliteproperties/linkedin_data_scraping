const API_BASE = "http://localhost:5000/api";

// Toggle extension panel when clicking the extension icon on LinkedIn
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id && tab.url && tab.url.includes("linkedin.com/in/")) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "toggle" });
      console.log("[Background] Sent toggle message to tab:", tab.id);
    } catch (err) {
      console.warn("[Background] Tab communication failed (refresh tab):", err);
    }
  }
});

// Centralized message router
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // 1. Enrich profile with SignalHire API
  if (message.type === "SIGNALHIRE_ENRICH") {
    (async () => {
      const endpoints = [
        `${API_BASE}/profiles/signalhire`,
        "http://127.0.0.1:5000/api/profiles/signalhire"
      ];

      let lastError = null;
      for (const url of endpoints) {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              profileUrl: message.profileUrl
            })
          });

          const data = await res.json().catch(() => ({}));
          if (res.ok) {
            return sendResponse(data);
          } else {
            return sendResponse({
              success: false,
              message: data.message || `SignalHire request failed (${res.status})`
            });
          }
        } catch (err) {
          lastError = err;
        }
      }

      console.error("[Background] SignalHire request failed:", lastError);
      sendResponse({
        success: false,
        message: "Backend server not reachable on localhost:5000. Ensure 'node server.js' is running."
      });
    })();
    return true;
  }

  // 2. Save complete profile to CRM database
  if (message.type === "SAVE_LINKEDIN_PROFILE") {
    (async () => {
      try {
        const p = message.profile || {};
        if (!p.name || p.name === "Not Available" || !p.profileUrl || p.profileUrl === "Not Available") {
          throw new Error("Valid profile name and LinkedIn URL are required to save.");
        }

        const res = await fetch(`${API_BASE}/profiles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.message || `Failed to save profile (${res.status})`);
        }

        sendResponse({ success: true, profile: data.profile || data });
      } catch (err) {
        console.error("[Background] Profile save failed:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }
});