const API_URL = "http://localhost:5000/api/profiles";

chrome.action.onClicked.addListener(async (tab) => {
  if (
    tab.id &&
    tab.url &&
    tab.url.includes("linkedin.com/in/")
  ) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "toggle"
      });

      console.log("[Background] Sent toggle message to tab:", tab.id);
    } catch (err) {
      console.warn(
        "[Background] Could not communicate with tab. Tab may need a refresh:",
        err
      );
    }
  }
});

// Message listener for both Email Search & Profile Save
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  // 1. New: Find Business Email via backend DNS/SMTP
  if (message.type === "FIND_BUSINESS_EMAIL") {
    (async () => {
      const endpoints = [
        "http://localhost:5000/api/profiles/find-email",
        "http://127.0.0.1:5000/api/profiles/find-email"
      ];

      let lastError = null;
      for (const url of endpoints) {
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              name: message.name,
              company: message.company
            })
          });

          if (response.ok) {
            const data = await response.json();
            return sendResponse(data);
          }
        } catch (err) {
          lastError = err;
        }
      }

      console.error("[Background] Find email request failed:", lastError);
      sendResponse({
        success: false,
        message: "Backend server not reachable at localhost:5000. Please ensure node server.js is running."
      });
    })();
    return true;
  }

  // 2. Existing: Save LinkedIn profile to backend
  if (message.type !== "SAVE_LINKEDIN_PROFILE") {
    return;
  }

  (async () => {
    try {
      const profile = message.profile || {};

      if (
        !profile.name ||
        profile.name === "Name Not Available" ||
        !profile.profileUrl
      ) {
        throw new Error("Valid profile name and URL are required.");
      }

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: profile.name,
          photoUrl: profile.avatar || profile.photoUrl || "",
          designation: profile.headline || profile.designation || "",
          companyName: profile.company || profile.companyName || "",
          location: profile.location || "",
          email: profile.email || "",
          phone: profile.phone || profile.phoneNumber || "",
          profileUrl: profile.profileUrl
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message || data.error || `API Error: ${response.status}`
        );
      }

      console.log("[Background] Profile saved:", data);

      sendResponse({
        success: true,
        data
      });
    } catch (error) {
      console.error("[Background] Profile save failed:", error);

      sendResponse({
        success: false,
        error: error.message
      });
    }
  })();

  return true;
});
