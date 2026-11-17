(() => {
  console.log("[Contact Finder] content.js initialized on:", location.href);

  const clean = (value) =>
    (value || "").replace(/\s+/g, " ").trim();

  const esc = (value) =>
    String(value || "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);

  let panel = null;
  let lastUrl = "";
  let manuallyClosedUrl = "";
  let contactRevealed = false;
  let cachedProfile = null;
  let scrapeTimer = null;

  function getBaseProfileUrl(url = location.href) {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname
        .replace(/\/overlay\/contact-info\/?$/i, "")
        .replace(/\/+$/, "");
      return `${parsed.origin}${path}/`;
    } catch {
      return url.split("?")[0].replace(/\/+$/, "") + "/";
    }
  }

  // 1. Extract contact details from About section (smart fallback)
  function extractAboutContact() {
    let email = "";
    let phone = "";

    try {
      const aboutAnchor = document.querySelector("#about");
      const aboutSection =
        aboutAnchor?.closest("section") ||
        [...document.querySelectorAll("section")].find((s) => {
          const h2 = s.querySelector("h2");
          return h2 && clean(h2.textContent).toLowerCase() === "about";
        });

      if (!aboutSection) return { email: "", phone: "" };

      const text = clean(aboutSection.innerText || aboutSection.textContent || "");

      // Match email
      const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i);
      if (emailMatch) {
        email = emailMatch[0].trim();
      }

      // Match phone with keywords
      const keywordMatch = text.match(
        /(?:phone|mobile|contact|call|whatsapp|tel|cell)[:\s-]*(\+?[\d][\d\s().-]{7,18}\d)/i
      );
      if (keywordMatch) {
        const raw = keywordMatch[1].trim();
        if (raw.replace(/\D/g, "").length >= 8) {
          phone = raw;
        }
      }

      // Match general phone if keyword match didn't find one
      if (!phone) {
        const phoneMatches =
          text.match(/\+?\d{1,4}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,5}[-.\s]?\d{1,5}/g) || [];
        for (const p of phoneMatches) {
          const digits = p.replace(/\D/g, "");
          if (
            digits.length >= 10 &&
            digits.length <= 14 &&
            !/^(19|20)\d{2}/.test(p.trim())
          ) {
            phone = p.trim();
            break;
          }
        }
      }
    } catch (err) {
      console.warn("[Contact Finder] Error extracting from About:", err);
    }

    return { email, phone };
  }



function sendProfileToBackend(profile) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "SAVE_LINKEDIN_PROFILE",
        profile
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            "[Contact Finder] Backend communication failed:",
            chrome.runtime.lastError.message
          );

          resolve(false);
          return;
        }

        if (response?.success) {
          console.log(
            "[Contact Finder] Profile saved successfully:",
            response.data
          );
          resolve(true);
        } else {
          console.error(
            "[Contact Finder] Profile save failed:",
            response?.error
          );
          resolve(false);
        }
      }
    );
  });
}


  // 2. Extract contact details from contact modal or document
  function extractContactDetails(root = document) {
    let email = "";
    let phone = "";

    try {
      const modal =
        root && root !== document
          ? root
          : (document.querySelector(".artdeco-modal, [role='dialog']") || document);

      // A. Email from mailto links
      const emailLinks = modal.querySelectorAll('a[href^="mailto:"]');
      for (const link of emailLinks) {
        const value = (link.getAttribute("href") || "")
          .replace(/^mailto:/i, "")
          .split("?")[0]
          .trim();

        if (value.includes("@")) {
          email = value;
          break;
        }
      }

      // Email regex fallback
      if (!email) {
        const modalText = clean(modal.innerText || modal.textContent || "");
        const emailMatch = modalText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
        if (emailMatch) {
          email = emailMatch[0];
        }
      }

      // B. Phone from tel: link
      const phoneLink = modal.querySelector('a[href^="tel:"]');
      if (phoneLink) {
        phone = (phoneLink.getAttribute("href") || "")
          .replace(/^tel:/i, "")
          .split("?")[0]
          .trim();
      }

      // C. Phone from section headings
      if (!phone) {
        const headings = [...modal.querySelectorAll("h3, h4, p, span, div")];
        const phoneLabel = headings.find((el) => {
          const txt = clean(el.textContent).toLowerCase();
          return (
            txt === "phone" ||
            txt === "phone number" ||
            txt === "mobile" ||
            txt === "contact number"
          );
        });

        if (phoneLabel) {
          const section =
            phoneLabel.closest("section") ||
            phoneLabel.parentElement?.parentElement ||
            phoneLabel.parentElement;
          const sectionText = section
            ? section.innerText || section.textContent || ""
            : "";

          const lines = sectionText.split("\n").map(clean).filter(Boolean);
          for (let i = 0; i < lines.length; i++) {
            if (/^(phone|phone number|mobile|contact number)$/i.test(lines[i])) {
              const candidate = lines[i + 1] || "";
              const match = candidate.match(/\+?[\d][\d\s().-]{6,18}\d/);
              if (match && match[0].replace(/\D/g, "").length >= 7) {
                phone = match[0].trim();
                break;
              }
            }
          }

          if (!phone) {
            const match = sectionText.match(/\+?\d[\d\s().-]{5,}\d/);
            if (match && match[0].replace(/\D/g, "").length >= 7) {
              phone = match[0].trim();
            }
          }
        }
      }
    } catch (e) {
      console.warn("[Contact Finder] Error extracting contact details:", e);
    }

    return { email, phone };
  }

  async function saveContactDetails(profileUrl, contact) {
    const baseUrl = getBaseProfileUrl(profileUrl);
    const storageKey = `linkedin_contact:${baseUrl}`;

    const savedData = {
      profileUrl: baseUrl,
      email: contact.email || "",
      phone: contact.phone || "",
      savedAt: new Date().toISOString()
    };

    try {
      await chrome.storage.local.set({
        [storageKey]: savedData
      });
      console.log("[Contact Finder] Contact Saved:", savedData);
    } catch (e) {
      console.error("[Contact Finder] Error saving contact:", e);
    }

    return savedData;
  }

  // Auto-capture when contact overlay is open
async function captureContactIfVisible() {
  const isContactRoute =
    /\/overlay\/contact-info\/?$/i.test(location.pathname);

  const modal = document.querySelector(
    ".artdeco-modal, [role='dialog']"
  );

  if (!isContactRoute && !modal) return;

  const contact = extractContactDetails(modal || document);

  if (!contact.email && !contact.phone) return;

  const profileUrl = getBaseProfileUrl(location.href);

  let changed = false;
  const wasRevealed = contactRevealed;

  if (cachedProfile) {
    if (contact.email && contact.email !== cachedProfile.email) {
      cachedProfile.email = contact.email;
      changed = true;
    }

    if (contact.phone && contact.phone !== cachedProfile.phone) {
      cachedProfile.phone = contact.phone;
      changed = true;
    }
  }

  contactRevealed = true;

  // Render only when contact data or reveal state changes.
  if (panel && (changed || !wasRevealed)) {
    render();
  }

  if (changed || !cachedProfile) {
    await saveContactDetails(profileUrl, contact);
  }
}

  function startContactObserver() {
    const observer = new MutationObserver(() => {
      captureContactIfVisible();
      checkAndRefreshProfileIfIncomplete();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  // Trigger modal open and fast capture
  
// Trigger Contact Info quickly and capture details without blocking the panel.

async function revealContactModal(timeout = 1200) {
  const aboutContact = extractAboutContact();

  // Both details already available in About.
  if (aboutContact.email && aboutContact.phone) {
    return aboutContact;
  }

  let modal = document.querySelector(
    "#artdeco-modal-outlet .artdeco-modal, [role='dialog'], .artdeco-modal"
  );

  // Open Contact Info only when it is not already open.
  if (!modal) {
    const contactLinks = [
      ...document.querySelectorAll(
        'a[href*="contact-info" i], a#top-card-text-details-contact-info, button[aria-label*="contact info" i], [data-control-name="contact_info"]'
      )
    ];

    if (contactLinks.length === 0) {
      const candidates = [
        ...document.querySelectorAll("main a, header a, a, button")
      ];

      const byText = candidates.find((el) =>
        clean(el.textContent).toLowerCase().includes("contact info")
      );

      if (byText) contactLinks.push(byText);
    }

    const link = contactLinks[0];

    if (link) {
      console.log("[Contact Finder] Opening Contact Info");
      link.click();
    }
  }

  const result = {
    email: aboutContact.email || "",
    phone: aboutContact.phone || ""
  };

  const startTime = Date.now();

  // Wait for contact details to load.
  while (Date.now() - startTime < timeout) {
    modal = document.querySelector(
      "#artdeco-modal-outlet .artdeco-modal, [role='dialog'], .artdeco-modal"
    );

    if (modal) {
      const current = extractContactDetails(modal);

      if (current.email) result.email = current.email;
      if (current.phone) result.phone = current.phone;

      // Stop only when both details are available.
      if (result.email && result.phone) {
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  // About-section fallback.
  if (!result.email && aboutContact.email) {
    result.email = aboutContact.email;
  }

  if (!result.phone && aboutContact.phone) {
    result.phone = aboutContact.phone;
  }

  // Close Contact Info after capturing available information.
  if (result.email || result.phone) {
    const isContactRoute =
      /\/overlay\/contact-info\/?$/i.test(location.pathname);

    // Target only the actual visible LinkedIn Contact Info dialog.
    const dialog = document.querySelector(
      'dialog[data-testid="dialog"][open]'
    );

    const closeButton = dialog?.querySelector(
      'button[aria-label="Dismiss"]'
    );

    if (closeButton) {
      closeButton.click();
      console.log("[Contact Finder] Contact Info dialog closed");
    } else {
      console.log("[Contact Finder] Contact Info close button not found");
    }

    // Return to profile route if LinkedIn overlay is still active.
    if (isContactRoute) {
      setTimeout(() => {
        if (/\/overlay\/contact-info\/?$/i.test(location.pathname)) {
          console.log("[Contact Finder] Returning to profile route");
          history.back();
        }
      }, 400);
    }
  }


  return result;
}


  // 3. Profile Scrape (Name, Headline, Company, Location, Avatar, About Contacts)
  function scrape() {
    try {
      const main = document.querySelector("main") || document;

      // Profile Name
      const headings = [...main.querySelectorAll("h1, h2")];
      const heading = headings.find((el) => {
        const value = clean(el.innerText || el.textContent);
        return (
          value &&
          value.toLowerCase() !== "activity" &&
          !/experience|education|skills|analytics|resources/i.test(value)
        );
      });

      let name = clean(heading?.innerText || heading?.textContent);
      if (!name) {
        name = clean(document.title.replace(/\s*\|\s*LinkedIn\s*$/i, ""));
      }

      const isNoise = (line) =>
        !line ||
        line === "·" ||
        /^contact info$/i.test(line) ||
        /^(he\/him|she\/her|they\/them)$/i.test(line) ||
        /^\d+(st|nd|rd|th)$/i.test(line) ||
        /^\d+\+?\s+connections?$/i.test(line) ||
        /^(message|connect|follow|open to work|show details)$/i.test(line) ||
        /verif/i.test(line);

      // Headline extraction
      let headline = "";
      const directHeadline =
        main.querySelector(".text-body-medium.break-words") ||
        main.querySelector('[data-generated-suggestion-target]');
      if (directHeadline) {
        const text = clean(directHeadline.innerText || directHeadline.textContent);
        if (text && text.length > 3 && !isNoise(text)) {
          headline = text;
        }
      }

      const header = heading
        ? (() => {
            let el = heading;
            for (let i = 0; i < 15 && el && el !== main; i++) {
              const text = clean(el.innerText);
              if (
                text.includes(name) &&
                text.length > name.length &&
                text.length < 2500
              ) {
                const hasHeadline = text.includes("@") || /contact info/i.test(text);
                if (hasHeadline) return el;
              }
              el = el.parentElement;
            }
            return null;
          })()
        : null;

      const headerText = (header?.innerText || main.innerText || "")
        .split("\n")
        .map(clean)
        .filter(Boolean);

      if (!headline) {
        const nameIndex = headerText.findIndex(
          (line) => line.toLowerCase() === name.toLowerCase()
        );
        if (nameIndex >= 0) {
          for (let i = nameIndex + 1; i < headerText.length; i++) {
            const line = headerText[i];
            if (isNoise(line)) continue;
            if (line.length > 5) {
              headline = line;
              break;
            }
          }
        }
      }

      // Extract Company
      let company = "";

      // Strategy 1: Right-side Top Card Company Icon / Widget
      const companyIcon = document.querySelector(
        'svg[id*="company-accent"], svg[id*="company"], img[src*="company-logo"], [data-field="experience_company_logo"]'
      );
      if (companyIcon) {
        const container =
          companyIcon.closest('[role="button"]') ||
          companyIcon.closest("li") ||
          companyIcon.closest("a") ||
          companyIcon.parentElement?.parentElement;
        if (container) {
          const txt = clean(container.innerText || container.textContent);
          if (txt && !/university|college|school|education/i.test(txt)) {
            company = txt.split("\n")[0].trim();
          }
        }
      }

      // Strategy 2: Headline with "at" or "@"
      if (!company && headline) {
        const atMatch = headline.match(/(?:\s+at\s+|\s+@\s+)(.+)$/i);
        if (atMatch && atMatch[1]) {
          company = clean(atMatch[1].split(/[|•·,]/)[0]).replace(/[.,;]+$/, "");
        }
      }

      // Strategy 3: Traditional right-panel lists
      if (!company) {
        const rightPanelSelectors = [
          "ul.pv-text-details__right-panel li",
          "[class*='right-panel'] li",
          "[class*='right-panel'] button",
          "[class*='right-panel'] a",
          "button[aria-label*='Current company']",
          "a[aria-label*='Current company']"
        ];
        const items = [...document.querySelectorAll(rightPanelSelectors.join(", "))];
        for (const item of items) {
          const text = clean(item.innerText || item.textContent);
          if (
            text &&
            !/university|college|school|education|institute|academy/i.test(text)
          ) {
            company = text.split("\n")[0].trim();
            if (company) break;
          }
        }
      }

      // Strategy 4: Company link in header/main
      if (!company) {
        const companyLink = (header || main).querySelector('a[href*="/company/"]');
        if (companyLink) {
          const txt = clean(companyLink.innerText || companyLink.textContent);
          if (txt && !/see all|follow/i.test(txt)) {
            company = txt;
          }
        }
      }

      // Strategy 5: First current position in Experience
      if (!company) {
        const expSection = document.querySelector("#experience")?.closest("section");
        if (expSection) {
          const expItems = expSection.querySelectorAll(
            "li.artdeco-list__item, [data-view-name*='profile-component-entity']"
          );
          for (const exp of expItems) {
            const lines = clean(exp.innerText).split("\n").map(clean).filter(Boolean);
            if (lines.length >= 2) {
              const candidate = lines[1].split("·")[0].split("•")[0].trim();
              if (
                candidate &&
                !/full-time|part-time|contract|internship|present/i.test(candidate)
              ) {
                company = candidate;
                break;
              }
            }
          }
        }
      }

      // Extract Location / City
      let locationText = "";
      const directLoc =
        main.querySelector(".pv-text-details__left-panel span.text-body-small") ||
        main.querySelector('[class*="text-details"] span.text-body-small') ||
        main.querySelector('span[class*="t-black--light"].break-words');
      if (directLoc) {
        const txt = clean(directLoc.innerText || directLoc.textContent);
        if (
          txt &&
          !/^contact info$/i.test(txt) &&
          !/connections?/i.test(txt) &&
          txt.length > 2
        ) {
          locationText = txt;
        }
      }

      if (!locationText) {
        const contactLink = main.querySelector('a[href*="/overlay/contact-info/"]');
        if (contactLink) {
          const parent = contactLink.parentElement;
          if (parent) {
            const spans = [...parent.querySelectorAll("span")];
            for (const s of spans) {
              const txt = clean(s.innerText || s.textContent);
              if (
                txt &&
                !/^contact info$/i.test(txt) &&
                !/connections?/i.test(txt) &&
                txt.length > 3
              ) {
                locationText = txt;
                break;
              }
            }
          }
        }
      }

      if (!locationText) {
        const locCandidates = headerText.filter(
          (line) =>
            line.includes(",") &&
            !isNoise(line) &&
            line !== headline &&
            line !== company &&
            !/developer|engineer|manager|director|founder|lead|consultant/i.test(line)
        );
        if (locCandidates.length > 0) {
          locationText = locCandidates[0];
        }
      }

      // Profile Image
      const profileImages = [
        ...main.querySelectorAll(
          "img[src*='profile-displayphoto'], img[src*='profile-framedphoto'], .pv-top-card-profile-picture img"
        )
      ];
      const avatar = profileImages[0]?.getAttribute("src") || "";

      // About section contacts (Smart fallback)
      const aboutContacts = extractAboutContact();

      return {
        name: name || "Name Not Available",
        headline: headline || "Designation Not Available",
        company: company || "",
        location: locationText || "",
        avatar: avatar,
        profileUrl: getBaseProfileUrl(location.href),
        email: aboutContacts.email || "",
        phone: aboutContacts.phone || ""
      };
    } catch (e) {
      console.error("[Contact Finder] Error in scrape():", e);
      return {
        name: "Name Not Available",
        headline: "Designation Not Available",
        company: "",
        location: "",
        avatar: "",
        profileUrl: getBaseProfileUrl(location.href),
        email: "",
        phone: ""
      };
    }
  }

  function getProfile() {
    if (!cachedProfile) {
      cachedProfile = scrape();
    }
    return cachedProfile;
  }

  function createPanel() {
    let existing = document.getElementById("acc-panel");
    if (existing) {
      panel = existing;
    } else {
      panel = document.createElement("div");
      panel.id = "acc-panel";
      document.body.appendChild(panel);
    }
    render();
  }

  function render() {
    if (!panel) return;

    const p = getProfile();

    panel.innerHTML = `
      <div class="acc-head">
        <div class="acc-brand">
          <b>LinkedIn <span>Contact Finder</span></b>
          <small>Profile Information</small>
        </div>
        <button data-action="close" title="Close">✕</button>
      </div>

      <div class="acc-body">
        <div class="acc-card">
          ${
            p.avatar
              ? `<img class="acc-avatar" src="${esc(p.avatar)}" alt="Profile Image">`
              : `<div class="acc-avatar acc-placeholder">${esc((p.name || "?").charAt(0))}</div>`
          }

          <div class="acc-profile">
            <div class="acc-name">${esc(p.name || "Name Not Available")}</div>
            <div class="acc-designation">${esc(p.headline || "Designation Not Available")}</div>
            <div class="acc-company">${esc(p.company || "Company Not Available")}</div>
            <div class="acc-location">
              <span>📍</span>
              ${esc(p.location || "City Not Available")}
            </div>
          </div>
        </div>

        <div class="acc-divider"></div>
        <div class="acc-section-title">Contact Information</div>

        ${
          contactRevealed || (p.email || p.phone)
            ? `
              <div class="acc-contact">
                <div class="acc-contact-item">
                  <span class="acc-contact-label">Business Email</span>
                  <div class="acc-contact-value">${esc(p.email || "Not Available")}</div>
                </div>

                <div class="acc-contact-item">
                  <span class="acc-contact-label">Contact Number</span>
                  <div class="acc-contact-value">${esc(p.phone || "Not Available")}</div>
                </div>
              </div>

              <button class="acc-main" data-action="copy">Copy Contact Details</button>
            `
            : `<button class="acc-main" data-action="reveal">👁 Reveal Contact</button>`
        }

        <div class="acc-message"></div>
        <div class="acc-footer">LinkedIn Profile Capture</div>
      </div>
    `;

    panel.onclick = async (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;

      const action = button.dataset.action;
      const message = panel.querySelector(".acc-message");

      if (action === "close") {
        closePanel(true);
        console.log("[Contact Finder] Panel closed by user for profile:", manuallyClosedUrl);
        return;
      }

      if (action === "reveal") {
        button.disabled = true;
        button.textContent = "Loading Contact...";

        try {
          const contact = await revealContactModal(2500);

          if (cachedProfile) {
            cachedProfile.email = contact.email || cachedProfile.email || "";
            cachedProfile.phone = contact.phone || cachedProfile.phone || "";

            // Save extracted profile details to backend table
            await sendProfileToBackend(cachedProfile);
          }

          if (contact.email || contact.phone) {
            await saveContactDetails(
              cachedProfile?.profileUrl || location.href,
              contact
            );
          }

          contactRevealed = true;
          render();
        } catch (err) {
          console.error("[Contact Finder] Reveal error:", err);
          button.disabled = false;
          button.textContent = "👁 Reveal Contact";
          if (message) {
            message.textContent = "Unable to fetch contact details.";
            message.className = "acc-message error";
          }
        }
        return;
      }

      if (action === "copy") {
        const current = getProfile();

        const contactText = [
          `Name: ${current.name}`,
          `Designation: ${current.headline}`,
          `Company: ${current.company || "Not Available"}`,
          `City: ${current.location || "Not Available"}`,
          `Email: ${current.email || "Not Available"}`,
          `Phone: ${current.phone || "Not Available"}`,
          `LinkedIn: ${current.profileUrl}`
        ].join("\n");

        try {
          await navigator.clipboard.writeText(contactText);
          if (message) {
            message.textContent = "Contact details copied ✓";
            message.className = "acc-message success";
          }
        } catch {
          if (message) {
            message.textContent = "Unable to copy contact details.";
            message.className = "acc-message error";
          }
        }
      }
    };
  }

  // Load profile and restore stored contacts
  function loadProfile(baseUrl) {
    cachedProfile = scrape();

    const storageKey = `linkedin_contact:${baseUrl}`;
    chrome.storage.local.get([storageKey], (result) => {
      const saved = result[storageKey];
      if (saved && (saved.email || saved.phone)) {
        if (cachedProfile) {
          cachedProfile.email = saved.email || cachedProfile.email || "";
          cachedProfile.phone = saved.phone || cachedProfile.phone || "";
          contactRevealed = true;
        }
      }
      if (panel) render();
    });

    if (panel) render();
  }

  // Retry scraping on SPA transition until all details (company, city, name, etc.) are found
  function scheduleProfileRetries(baseUrl, attempt = 0) {
    if (attempt > 4) return;

    setTimeout(() => {
      if (getBaseProfileUrl(location.href) !== baseUrl) return;

      const latest = scrape();
      let changed = false;

      if (cachedProfile) {
        if (latest.name && latest.name !== "Name Not Available" && latest.name !== cachedProfile.name) {
          cachedProfile.name = latest.name;
          changed = true;
        }
        if (latest.headline && latest.headline !== "Designation Not Available" && latest.headline !== cachedProfile.headline) {
          cachedProfile.headline = latest.headline;
          changed = true;
        }
        if (latest.company && latest.company !== cachedProfile.company) {
          cachedProfile.company = latest.company;
          changed = true;
        }
        if (latest.location && latest.location !== cachedProfile.location) {
          cachedProfile.location = latest.location;
          changed = true;
        }
        if (latest.avatar && latest.avatar !== cachedProfile.avatar) {
          cachedProfile.avatar = latest.avatar;
          changed = true;
        }
        if (latest.profileUrl && latest.profileUrl !== cachedProfile.profileUrl) {
          cachedProfile.profileUrl = latest.profileUrl;
          changed = true;
        }
        if (latest.email && !cachedProfile.email) {
          cachedProfile.email = latest.email;
          changed = true;
        }
        if (latest.phone && !cachedProfile.phone) {
          cachedProfile.phone = latest.phone;
          changed = true;
        }

        if (changed && panel) {
          render();
        }
      }

      if ((!cachedProfile?.company || !cachedProfile?.location || cachedProfile?.name === "Name Not Available") && attempt < 4) {
        scheduleProfileRetries(baseUrl, attempt + 1);
      }
    }, [300, 750, 1400, 2200, 3500][attempt]);
  }

  function closePanel(manual = false) {
    if (manual) {
      manuallyClosedUrl = getBaseProfileUrl(location.href);
    }
    const existing = document.getElementById("acc-panel");
    if (existing) existing.remove();
    if (panel && panel !== existing) panel.remove();
    panel = null;
    contactRevealed = false;
  }

  function handleNavigation() {
    const isProfilePage = location.pathname.startsWith("/in/");

    if (!isProfilePage) {
      if (panel) {
        closePanel(false);
      }
      lastUrl = location.href;
      return;
    }

    const newBaseUrl = getBaseProfileUrl(location.href);

    if (newBaseUrl !== lastUrl) {
      lastUrl = newBaseUrl;
      contactRevealed = false;
      cachedProfile = null;

      // If navigated to a different profile, reset manual close suppression
      if (manuallyClosedUrl && manuallyClosedUrl !== newBaseUrl) {
        manuallyClosedUrl = "";
      }

      // Auto-open panel on new profile
      if (!manuallyClosedUrl) {
        openPanel(newBaseUrl);
      } else if (panel) {
        loadProfile(newBaseUrl);
        scheduleProfileRetries(newBaseUrl, 0);
      }
    }
  }

  function checkAndRefreshProfileIfIncomplete() {
    if (!panel || !location.pathname.startsWith("/in/")) return;

    if (
      !cachedProfile ||
      !cachedProfile.company ||
      !cachedProfile.location ||
      cachedProfile.name === "Name Not Available" ||
      cachedProfile.headline === "Designation Not Available"
    ) {
      clearTimeout(scrapeTimer);
      scrapeTimer = setTimeout(() => {
        const latest = scrape();
        let changed = false;

        if (cachedProfile) {
          if (cachedProfile.name === "Name Not Available" && latest.name && latest.name !== "Name Not Available") {
            cachedProfile.name = latest.name;
            changed = true;
          }
          if (cachedProfile.headline === "Designation Not Available" && latest.headline && latest.headline !== "Designation Not Available") {
            cachedProfile.headline = latest.headline;
            changed = true;
          }
          if (!cachedProfile.company && latest.company) {
            cachedProfile.company = latest.company;
            changed = true;
          }
          if (!cachedProfile.location && latest.location) {
            cachedProfile.location = latest.location;
            changed = true;
          }
          if (!cachedProfile.avatar && latest.avatar) {
            cachedProfile.avatar = latest.avatar;
            changed = true;
          }
          if (!cachedProfile.email && latest.email) {
            cachedProfile.email = latest.email;
            changed = true;
          }
          if (!cachedProfile.phone && latest.phone) {
            cachedProfile.phone = latest.phone;
            changed = true;
          }
        }

        if (changed && panel) {
          render();
        }
      }, 400);
    }
  }

  function openPanel(targetUrl) {
    if (!location.pathname.startsWith("/in/")) {
      console.log("[Contact Finder] Not on a profile page (/in/):", location.pathname);
      return;
    }

    const baseUrl = targetUrl || getBaseProfileUrl(location.href);
    lastUrl = baseUrl;
    manuallyClosedUrl = "";
    contactRevealed = false;
    createPanel();
    loadProfile(baseUrl);
    scheduleProfileRetries(baseUrl, 0);
  }

  chrome.runtime.onMessage.addListener((message) => {
    console.log("[Contact Finder] Received message:", message);
    if (message.type === "toggle") {
      const existing = document.getElementById("acc-panel");
      if (existing || panel) {
        closePanel(true);
        console.log("[Contact Finder] Panel toggled closed");
      } else {
        manuallyClosedUrl = "";
        openPanel();
        console.log("[Contact Finder] Panel toggled open");
      }
    }
  });

  startContactObserver();

  // Watch for SPA URL changes safely and quickly
  window.addEventListener("popstate", handleNavigation);

  // Auto-open on initial load if on a profile page
  if (location.pathname.startsWith("/in/")) {
    setTimeout(() => {
      handleNavigation();
    }, 250);
  }

  // Periodic check for LinkedIn in-app SPA link navigations
  setInterval(() => {
    const isProfile = location.pathname.startsWith("/in/");
    if (isProfile) {
      const current = getBaseProfileUrl(location.href);
      if (current !== lastUrl) {
        handleNavigation();
      }
    } else if (lastUrl && panel) {
      handleNavigation();
    }
  }, 350);
})();