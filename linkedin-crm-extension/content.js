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
  let isSavingProfile = false;

  const PROFILE_STORAGE_PREFIX = "linkedin_profile:";

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

  function isValidValue(value, placeholder = "") {
    const text = clean(value);
    return !!text && text !== placeholder;
  }

  function dataProfileUrl(profile) {
    return getBaseProfileUrl(
      profile?.profileUrl || location.href
    );
  }

  // Save exactly seven fields to Chrome Local Storage.
  async function saveProfileToLocalStorage(profile) {
    if (!profile) return null;

    const data = {
      name: isValidValue(profile.name, "Name Not Available")
        ? profile.name
        : "",
      headline: isValidValue(
        profile.headline,
        "Designation Not Available"
      ) ? profile.headline : "",
      company: profile.company || "",
      location: profile.location || "",
      photoUrl: profile.avatar || profile.photoUrl || "",
      email: profile.email || "",
      phone: profile.phone || ""
    };

    const key =
      PROFILE_STORAGE_PREFIX + dataProfileUrl(profile);

    try {
      await chrome.storage.local.set({
        [key]: data
      });

      console.log(
        "[Contact Finder] Local profile saved:",
        data
      );

      return data;
    } catch (error) {
      console.error(
        "[Contact Finder] Local storage save failed:",
        error
      );
      return null;
    }
  }

  async function getProfileFromLocalStorage(profileUrl) {
    const key =
      PROFILE_STORAGE_PREFIX + getBaseProfileUrl(profileUrl);

    try {
      const result = await chrome.storage.local.get(key);
      return result[key] || null;
    } catch (error) {
      console.error(
        "[Contact Finder] Local storage read failed:",
        error
      );
      return null;
    }
  }

  async function persistCachedProfile() {
    if (!cachedProfile) return;
    await saveProfileToLocalStorage(cachedProfile);
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

  // 1. Extract contact details from About section.
  function extractAboutContact() {
    let email = "";
    let phone = "";

    try {
      const aboutAnchor = document.querySelector("#about");

      const aboutSection =
        aboutAnchor?.closest("section") ||
        [...document.querySelectorAll("section")].find((s) => {
          const h2 = s.querySelector("h2");
          return h2 &&
            clean(h2.textContent).toLowerCase() === "about";
        });

      if (!aboutSection) {
        return { email: "", phone: "" };
      }

      const text = clean(
        aboutSection.innerText || aboutSection.textContent || ""
      );

      const emailMatch = text.match(
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i
      );

      if (emailMatch) {
        email = emailMatch[0].trim();
      }

      const keywordMatch = text.match(
        /(?:phone|mobile|contact|call|whatsapp|tel|cell)[:\s-]*(\+?[\d][\d\s().-]{7,18}\d)/i
      );

      if (keywordMatch) {
        const raw = keywordMatch[1].trim();

        if (raw.replace(/\D/g, "").length >= 8) {
          phone = raw;
        }
      }

      if (!phone) {
        const phoneMatches =
          text.match(
            /\+?\d{1,4}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,5}[-.\s]?\d{1,5}/g
          ) || [];

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
      console.warn(
        "[Contact Finder] Error extracting from About:",
        err
      );
    }

    return { email, phone };
  }

  // 1b. Extract contact details from Featured section, Resume cards, and Portfolio links.
  function extractResumeAndFeaturedContact() {
    let email = "";
    let phone = "";
    let resumeUrl = "";

    try {
      // Find Featured section
      const featuredSection =
        document.querySelector("#featured")?.closest("section") ||
        [...document.querySelectorAll("section")].find((s) => {
          const h2 = s.querySelector("h2");
          return h2 && /featured|media/i.test(h2.textContent || "");
        });

      const candidateNodes = [];
      if (featuredSection) {
        candidateNodes.push(...featuredSection.querySelectorAll("li, .artdeco-card, a, [data-view-name]"));
      }

      // Check for Resume / CV / Drive / PDF links
      const resumeLinks = [
        ...document.querySelectorAll(
          'a[href*="drive.google.com"], a[href*="dropbox.com"], a[href*=".pdf"], a[href*="/document/"], a[href*="/media/"], a[aria-label*="resume" i], a[aria-label*="cv" i]'
        )
      ];

      for (const link of resumeLinks) {
        const href = link.getAttribute("href") || "";
        const label = (link.textContent || "").toLowerCase();
        if (/resume|cv|curriculum|portfolio|bio|\.pdf/i.test(href) || /resume|cv|portfolio|profile/i.test(label)) {
          if (!resumeUrl) resumeUrl = href;
          candidateNodes.push(link.closest("div") || link.parentElement || link);
        }
      }

      const allText = [];
      if (featuredSection) {
        allText.push(featuredSection.innerText || featuredSection.textContent || "");
      }
      for (const node of candidateNodes) {
        if (node) allText.push(node.innerText || node.textContent || "");
      }

      const combinedText = allText.join("\n");

      // Extract email from resume/featured text
      if (!email) {
        const emailMatch = combinedText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i);
        if (emailMatch) {
          email = emailMatch[0].trim();
        }
      }

      // Extract phone: keyword format (Phone: 8807..., Mobile: +91..., Contact: ...)
      if (!phone) {
        const keywordMatch = combinedText.match(
          /(?:phone|mobile|contact|call|whatsapp|tel|cell|ph)[:\s-]*(\+?[\d][\d\s().-]{7,18}\d)/i
        );
        if (keywordMatch) {
          const raw = keywordMatch[1].trim();
          if (raw.replace(/\D/g, "").length >= 8) {
            phone = raw;
          }
        }
      }

      // Extract phone: Indian 10-digit mobile format (+91 or starts with 6,7,8,9)
      if (!phone) {
        const indianMatch = combinedText.match(/(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/);
        if (indianMatch) {
          phone = indianMatch[0].trim();
        }
      }

      // Extract phone: general international number
      if (!phone) {
        const phoneMatches = combinedText.match(/\+?\d{1,4}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,5}[-.\s]?\d{1,5}/g) || [];
        for (const p of phoneMatches) {
          const digits = p.replace(/\D/g, "");
          if (digits.length >= 10 && digits.length <= 14 && !/^(19|20)\d{2}/.test(p.trim())) {
            phone = p.trim();
            break;
          }
        }
      }
    } catch (err) {
      console.warn("[Contact Finder] Error extracting from Resume / Featured:", err);
    }

    return { email, phone, resumeUrl };
  }

  // 2. Extract contact details from contact modal or document.
  function extractContactDetails(root = document) {
    let email = "";
    let phone = "";

    try {
      const modal =
        root && root !== document
          ? root
          : (
              document.querySelector(
                ".artdeco-modal, [role='dialog']"
              ) || document
            );

      const emailLinks = modal.querySelectorAll(
        'a[href^="mailto:"]'
      );

      for (const link of emailLinks) {
        const value = (
          link.getAttribute("href") || ""
        )
          .replace(/^mailto:/i, "")
          .split("?")[0]
          .trim();

        if (value.includes("@")) {
          email = value;
          break;
        }
      }

      if (!email) {
        const modalText = clean(
          modal.innerText || modal.textContent || ""
        );

        const emailMatch = modalText.match(
          /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
        );

        if (emailMatch) {
          email = emailMatch[0];
        }
      }

      const phoneLink = modal.querySelector(
        'a[href^="tel:"]'
      );

      if (phoneLink) {
        phone = (
          phoneLink.getAttribute("href") || ""
        )
          .replace(/^tel:/i, "")
          .split("?")[0]
          .trim();
      }

      if (!phone) {
        const headings = [
          ...modal.querySelectorAll("h3, h4, p, span, div")
        ];

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

          const lines = sectionText
            .split("\n")
            .map(clean)
            .filter(Boolean);

          for (let i = 0; i < lines.length; i++) {
            if (
              /^(phone|phone number|mobile|contact number)$/i.test(
                lines[i]
              )
            ) {
              const candidate = lines[i + 1] || "";

              const match = candidate.match(
                /\+?[\d][\d\s().-]{6,18}\d/
              );

              if (
                match &&
                match[0].replace(/\D/g, "").length >= 7
              ) {
                phone = match[0].trim();
                break;
              }
            }
          }

          if (!phone) {
            const match = sectionText.match(
              /\+?\d[\d\s().-]{5,}\d/
            );

            if (
              match &&
              match[0].replace(/\D/g, "").length >= 7
            ) {
              phone = match[0].trim();
            }
          }
        }
      }
    } catch (e) {
      console.warn(
        "[Contact Finder] Error extracting contact details:",
        e
      );
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

      console.log(
        "[Contact Finder] Contact Saved:",
        savedData
      );
    } catch (e) {
      console.error(
        "[Contact Finder] Error saving contact:",
        e
      );
    }

    return savedData;
  }

  // Auto-capture when contact overlay is open.
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

    if (!cachedProfile) {
      cachedProfile = scrape();
    }

    let changed = false;
    const wasRevealed = contactRevealed;

    if (contact.email && contact.email !== cachedProfile.email) {
      cachedProfile.email = contact.email;
      changed = true;
    }

    if (contact.phone && contact.phone !== cachedProfile.phone) {
      cachedProfile.phone = contact.phone;
      changed = true;
    }

    contactRevealed = true;

    if (panel && (changed || !wasRevealed)) {
      render();
    }

    await saveProfileToLocalStorage(cachedProfile);
    await saveContactDetails(profileUrl, contact);
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

  // 3. Open Contact Info and capture details.
    async function revealContactModal(timeout = 1200) {
    const aboutContact = extractAboutContact();
    const resumeContact = extractResumeAndFeaturedContact();
    const fallbackContact = {
      email: aboutContact.email || resumeContact.email || "",
      phone: aboutContact.phone || resumeContact.phone || ""
    };

    if (fallbackContact.email && fallbackContact.phone) {
      return fallbackContact;
    }

    let modal = document.querySelector(
      "#artdeco-modal-outlet .artdeco-modal, [role='dialog'], .artdeco-modal"
    );

    if (!modal) {
      const contactLinks = [
        ...document.querySelectorAll(
          'a[href*="contact-info" i], a#top-card-text-details-contact-info, button[aria-label*="contact info" i], [data-control-name="contact_info"]'
        )
      ];

      if (contactLinks.length === 0) {
        const candidates = [
          ...document.querySelectorAll(
            "main a, header a, a, button"
          )
        ];

        const byText = candidates.find((el) =>
          clean(el.textContent)
            .toLowerCase()
            .includes("contact info")
        );

        if (byText) contactLinks.push(byText);
      }

      const link = contactLinks[0];

      if (link) {
        console.log(
          "[Contact Finder] Opening Contact Info"
        );
        link.click();
      }
    }

    const result = {
      email: aboutContact.email || "",
      phone: aboutContact.phone || ""
    };

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      modal = document.querySelector(
        "#artdeco-modal-outlet .artdeco-modal, [role='dialog'], .artdeco-modal"
      );

      if (modal) {
        const current = extractContactDetails(modal);

        if (current.email) result.email = current.email;
        if (current.phone) result.phone = current.phone;

        if (result.email && result.phone) {
          break;
        }
      }

      await new Promise((resolve) =>
        setTimeout(resolve, 60)
      );
    }

    if (!result.email) {
      result.email = aboutContact.email || resumeContact.email || "";
    }

    if (!result.phone) {
      result.phone = aboutContact.phone || resumeContact.phone || "";
    }


    if (result.email || result.phone) {
      const isContactRoute =
        /\/overlay\/contact-info\/?$/i.test(location.pathname);

      const dialog = document.querySelector(
        'dialog[data-testid="dialog"][open]'
      );

      const closeButton = dialog?.querySelector(
        'button[aria-label="Dismiss"]'
      );

      if (closeButton) {
        closeButton.click();
        console.log(
          "[Contact Finder] Contact Info dialog closed"
        );
      } else {
        console.log(
          "[Contact Finder] Contact Info close button not found"
        );
      }

      if (isContactRoute) {
        setTimeout(() => {
          if (
            /\/overlay\/contact-info\/?$/i.test(
              location.pathname
            )
          ) {
            console.log(
              "[Contact Finder] Returning to profile route"
            );
            history.back();
          }
        }, 400);
      }
    }

    return result;
  }

  // 4. Profile Scrape.
  function scrape() {
    try {
      const main = document.querySelector("main") || document;

      const headings = [
        ...main.querySelectorAll("h1, h2")
      ];

      const heading = headings.find((el) => {
        const value = clean(
          el.innerText || el.textContent
        );

        return (
          value &&
          value.toLowerCase() !== "activity" &&
          !/experience|education|skills|analytics|resources/i.test(
            value
          )
        );
      });

      let name = clean(
        heading?.innerText || heading?.textContent
      );

      if (!name) {
        name = clean(
          document.title.replace(
            /\s*\|\s*LinkedIn\s*$/i,
            ""
          )
        );
      }

      const isNoise = (line) =>
        !line ||
        line === "·" ||
        /^contact info$/i.test(line) ||
        /^(he\/him|she\/her|they\/them)$/i.test(line) ||
        /^\d+(st|nd|rd|th)$/i.test(line) ||
        /^\d+\+?\s+connections?$/i.test(line) ||
        /^(message|connect|follow|open to work|show details)$/i.test(
          line
        ) ||
        /verif/i.test(line);

      let headline = "";

      const directHeadline =
        main.querySelector(
          ".text-body-medium.break-words"
        ) ||
        main.querySelector(
          "[data-generated-suggestion-target]"
        );

      if (directHeadline) {
        const text = clean(
          directHeadline.innerText ||
          directHeadline.textContent
        );

        if (
          text &&
          text.length > 3 &&
          !isNoise(text)
        ) {
          headline = text;
        }
      }

      const header = heading
        ? (() => {
            let el = heading;

            for (
              let i = 0;
              i < 15 && el && el !== main;
              i++
            ) {
              const text = clean(el.innerText);

              if (
                text.includes(name) &&
                text.length > name.length &&
                text.length < 2500
              ) {
                const hasHeadline =
                  text.includes("@") ||
                  /contact info/i.test(text);

                if (hasHeadline) return el;
              }

              el = el.parentElement;
            }

            return null;
          })()
        : null;

      const headerText = (
        header?.innerText || main.innerText || ""
      )
        .split("\n")
        .map(clean)
        .filter(Boolean);

      if (!headline) {
        const nameIndex = headerText.findIndex(
          (line) =>
            line.toLowerCase() === name.toLowerCase()
        );

        if (nameIndex >= 0) {
          for (
            let i = nameIndex + 1;
            i < headerText.length;
            i++
          ) {
            const line = headerText[i];

            if (isNoise(line)) continue;

            if (line.length > 5) {
              headline = line;
              break;
            }
          }
        }
      }

      let company = "";

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
          const txt = clean(
            container.innerText || container.textContent
          );

          if (
            txt &&
            !/university|college|school|education/i.test(txt)
          ) {
            company = txt.split("\n")[0].trim();
          }
        }
      }

      if (!company && headline) {
        const atMatch = headline.match(
          /(?:\s+at\s+|\s+@\s+)(.+)$/i
        );

        if (atMatch && atMatch[1]) {
          company = clean(
            atMatch[1].split(/[|•·,]/)[0]
          ).replace(/[.,;]+$/, "");
        }
      }

      if (!company) {
        const rightPanelSelectors = [
          "ul.pv-text-details__right-panel li",
          "[class*='right-panel'] li",
          "[class*='right-panel'] button",
          "[class*='right-panel'] a",
          "button[aria-label*='Current company']",
          "a[aria-label*='Current company']"
        ];

        const items = [
          ...document.querySelectorAll(
            rightPanelSelectors.join(", ")
          )
        ];

        for (const item of items) {
          const text = clean(
            item.innerText || item.textContent
          );

          if (
            text &&
            !/university|college|school|education|institute|academy/i.test(
              text
            )
          ) {
            company = text.split("\n")[0].trim();

            if (company) break;
          }
        }
      }

      if (!company) {
        const companyLink = (
          header || main
        ).querySelector('a[href*="/company/"]');

        if (companyLink) {
          const txt = clean(
            companyLink.innerText ||
            companyLink.textContent
          );

          if (txt && !/see all|follow/i.test(txt)) {
            company = txt;
          }
        }
      }

      if (!company) {
        const expSection = document
          .querySelector("#experience")
          ?.closest("section");

        if (expSection) {
          const expItems = expSection.querySelectorAll(
            "li.artdeco-list__item, [data-view-name*='profile-component-entity']"
          );

          for (const exp of expItems) {
            const lines = clean(exp.innerText)
              .split("\n")
              .map(clean)
              .filter(Boolean);

            if (lines.length >= 2) {
              const candidate = lines[1]
                .split("·")[0]
                .split("•")[0]
                .trim();

              if (
                candidate &&
                !/full-time|part-time|contract|internship|present/i.test(
                  candidate
                )
              ) {
                company = candidate;
                break;
              }
            }
          }
        }
      }

      let locationText = "";

      const directLoc =
        main.querySelector(
          ".pv-text-details__left-panel span.text-body-small"
        ) ||
        main.querySelector(
          "[class*='text-details'] span.text-body-small"
        ) ||
        main.querySelector(
          "span[class*='t-black--light'].break-words"
        );

      if (directLoc) {
        const txt = clean(
          directLoc.innerText || directLoc.textContent
        );

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
        const contactLink = main.querySelector(
          'a[href*="/overlay/contact-info/"]'
        );

        if (contactLink) {
          const parent = contactLink.parentElement;

          if (parent) {
            const spans = [
              ...parent.querySelectorAll("span")
            ];

            for (const s of spans) {
              const txt = clean(
                s.innerText || s.textContent
              );

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
            !/developer|engineer|manager|director|founder|lead|consultant/i.test(
              line
            )
        );

        if (locCandidates.length > 0) {
          locationText = locCandidates[0];
        }
      }

      const profileImages = [
        ...main.querySelectorAll(
          "img[src*='profile-displayphoto'], img[src*='profile-framedphoto'], .pv-top-card-profile-picture img"
        )
      ];

      const avatar =
        profileImages[0]?.getAttribute("src") || "";

      const aboutContacts = extractAboutContact();
      const resumeContacts = extractResumeAndFeaturedContact();

      return {
        name: name || "Name Not Available",
        headline: headline || "Designation Not Available",
        company: company || "",
        location: locationText || "",
        avatar,
        profileUrl: getBaseProfileUrl(location.href),
        email: aboutContacts.email || resumeContacts.email || "",
        phone: aboutContacts.phone || resumeContacts.phone || ""
      };
    } catch (e) {
      console.error(
        "[Contact Finder] Error in scrape():",
        e
      );

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
          contactRevealed || p.email || p.phone
            ? `
              <div class="acc-contact">
               
                <div class="acc-contact-item">
                  <span class="acc-contact-label">Business Email</span>
                  <div class="acc-contact-value">${esc(p.email || "Not Available")}</div>
                  ${
                    (!p.email || p.email === "Not Available") && p.name && p.company
                      ? `<button class="acc-sub-btn" data-action="find-email">⚡ Find Business Email</button>`
                      : ""
                  }
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

        <button class="acc-main" data-action="save-profile">Save Profile</button>

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

        console.log(
          "[Contact Finder] Panel closed by user for profile:",
          manuallyClosedUrl
        );

        return;
      }

      if (action === "reveal") {
        button.disabled = true;
        button.textContent = "Loading Contact...";

        try {
          const contact = await revealContactModal(2500);

          if (!cachedProfile) {
            cachedProfile = scrape();
          }

          cachedProfile.email =
            contact.email || cachedProfile.email || "";

          cachedProfile.phone =
            contact.phone || cachedProfile.phone || "";

          if (contact.email || contact.phone) {
            await saveContactDetails(
              cachedProfile.profileUrl || location.href,
              contact
            );
          }

          // Update Local Storage only.
          // Do NOT send to backend automatically.
          await saveProfileToLocalStorage(cachedProfile);

          contactRevealed = true;
          render();
        } catch (err) {
          console.error(
            "[Contact Finder] Reveal error:",
            err
          );

          button.disabled = false;
          button.textContent = "👁 Reveal Contact";

          if (message) {
            message.textContent =
              "Unable to fetch contact details.";
            message.className = "acc-message error";
          }
        }

        return;
      }

      if (action === "find-email") {
        button.disabled = true;
        button.textContent = "🔍 Checking Mail Server...";

        try {
          const current = getProfile();
          
          chrome.runtime.sendMessage(
            {
              type: "FIND_BUSINESS_EMAIL",
              name: current.name,
              company: current.company
            },
            async (data) => {
              if (chrome.runtime.lastError) {
                console.error("[Contact Finder] Extension background error:", chrome.runtime.lastError.message);
                button.disabled = false;
                button.textContent = "⚡ Find Business Email";
                if (message) {
                  message.textContent = "Service worker error. Please reload extension.";
                  message.className = "acc-message error";
                }
                return;
              }

              if (data && data.success && data.email) {
                cachedProfile.email = data.email;
                await saveProfileToLocalStorage(cachedProfile);
                contactRevealed = true;
                render();
                const newMsg = panel?.querySelector(".acc-message");
                if (newMsg) {
                  newMsg.textContent = `Found ${data.status === "deliverable" ? "verified" : "predicted"} email: ${data.email}`;
                  newMsg.className = "acc-message success";
                }
              } else {
                button.disabled = false;
                button.textContent = "⚡ Find Business Email";
                if (message) {
                  message.textContent = data?.message || "No active mail domain found for this company.";
                  message.className = "acc-message error";
                }
              }
            }
          );
        } catch (err) {
          console.error("[Contact Finder] Error:", err);
          button.disabled = false;
          button.textContent = "⚡ Find Business Email";
          if (message) {
            message.textContent = "Could not initiate search.";
            message.className = "acc-message error";
          }
        }

        return;
      }

      if (action === "save-profile") {
        if (isSavingProfile) return;

        isSavingProfile = true;
        button.disabled = true;
        button.textContent = "Saving Profile...";

        try {
          const latest = scrape();

          const stored = await getProfileFromLocalStorage(
            latest.profileUrl
          );

          const finalProfile = {
            name: isValidValue(
              latest.name,
              "Name Not Available"
            )
              ? latest.name
              : stored?.name || "",

            headline: isValidValue(
              latest.headline,
              "Designation Not Available"
            )
              ? latest.headline
              : stored?.headline || "",

            company:
              latest.company || stored?.company || "",

            location:
              latest.location || stored?.location || "",

            avatar:
              latest.avatar || stored?.photoUrl || "",

            profileUrl: latest.profileUrl,

            email:
              cachedProfile?.email ||
              stored?.email ||
              latest.email ||
              "",

            phone:
              cachedProfile?.phone ||
              stored?.phone ||
              latest.phone ||
              ""
          };

          // Keep the current profile updated.
          cachedProfile = finalProfile;

          // Save the seven fields locally first.
          await saveProfileToLocalStorage(finalProfile);

          // Only this button sends data to the backend.
          const success =
            await sendProfileToBackend(finalProfile);

          if (!success) {
            throw new Error("Backend save failed.");
          }

          button.textContent = "Saved ✓";
          button.disabled = true;

          console.log(
            "[Contact Finder] Final profile saved:",
            finalProfile
          );

          if (message) {
            message.textContent =
              "Profile saved successfully ✓";
            message.className = "acc-message success";
          }
        } catch (error) {
          console.error(
            "[Contact Finder] Save Profile Error:",
            error
          );

          button.disabled = false;
          button.textContent = "Save Profile";

          if (message) {
            message.textContent =
              "Profile save failed. Please try again.";
            message.className = "acc-message error";
          }
        } finally {
          isSavingProfile = false;
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
            message.textContent =
              "Contact details copied ✓";
            message.className = "acc-message success";
          }
        } catch {
          if (message) {
            message.textContent =
              "Unable to copy contact details.";
            message.className = "acc-message error";
          }
        }
      }
    };
  }

  // Load profile and restore stored contacts/profile fields.
  async function loadProfile(baseUrl) {
    cachedProfile = scrape();

    const profileUrl = getBaseProfileUrl(baseUrl);

    const storedProfile =
      await getProfileFromLocalStorage(profileUrl);

    if (
      storedProfile &&
      cachedProfile.profileUrl === profileUrl
    ) {
      cachedProfile.name =
        isValidValue(
          cachedProfile.name,
          "Name Not Available"
        )
          ? cachedProfile.name
          : storedProfile.name || cachedProfile.name;

      cachedProfile.headline =
        isValidValue(
          cachedProfile.headline,
          "Designation Not Available"
        )
          ? cachedProfile.headline
          : storedProfile.headline ||
            cachedProfile.headline;

      cachedProfile.company =
        cachedProfile.company || storedProfile.company || "";

      cachedProfile.location =
        cachedProfile.location || storedProfile.location || "";

      cachedProfile.avatar =
        cachedProfile.avatar || storedProfile.photoUrl || "";

      cachedProfile.email =
        cachedProfile.email || storedProfile.email || "";

      cachedProfile.phone =
        cachedProfile.phone || storedProfile.phone || "";
    }

    const storageKey = `linkedin_contact:${profileUrl}`;

    try {
      const result = await chrome.storage.local.get([
        storageKey
      ]);

      const saved = result[storageKey];

      if (saved && (saved.email || saved.phone)) {
        cachedProfile.email =
          saved.email || cachedProfile.email || "";

        cachedProfile.phone =
          saved.phone || cachedProfile.phone || "";

        contactRevealed = true;
      }
    } catch (error) {
      console.error(
        "[Contact Finder] Contact restore failed:",
        error
      );
    }

    await persistCachedProfile();

    if (panel) render();
  }

  // Retry scraping on SPA transition.
  function scheduleProfileRetries(baseUrl, attempt = 0) {
    if (attempt > 4) return;

    setTimeout(async () => {
      if (getBaseProfileUrl(location.href) !== baseUrl) {
        return;
      }

      const latest = scrape();
      let changed = false;

      if (cachedProfile) {
        if (
          isValidValue(
            latest.name,
            "Name Not Available"
          ) &&
          latest.name !== cachedProfile.name
        ) {
          cachedProfile.name = latest.name;
          changed = true;
        }

        if (
          isValidValue(
            latest.headline,
            "Designation Not Available"
          ) &&
          latest.headline !== cachedProfile.headline
        ) {
          cachedProfile.headline = latest.headline;
          changed = true;
        }

        if (
          latest.company &&
          latest.company !== cachedProfile.company
        ) {
          cachedProfile.company = latest.company;
          changed = true;
        }

        if (
          latest.location &&
          latest.location !== cachedProfile.location
        ) {
          cachedProfile.location = latest.location;
          changed = true;
        }

        if (
          latest.avatar &&
          latest.avatar !== cachedProfile.avatar
        ) {
          cachedProfile.avatar = latest.avatar;
          changed = true;
        }

        if (
          latest.profileUrl &&
          latest.profileUrl !== cachedProfile.profileUrl
        ) {
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

        if (changed) {
          await persistCachedProfile();

          if (panel) render();
        }
      }

      if (
        (
          !cachedProfile?.company ||
          !cachedProfile?.location ||
          cachedProfile?.name === "Name Not Available"
        ) &&
        attempt < 4
      ) {
        scheduleProfileRetries(baseUrl, attempt + 1);
      }
    }, [300, 750, 1400, 2200, 3500][attempt]);
  }

  function closePanel(manual = false) {
    if (manual) {
      manuallyClosedUrl =
        getBaseProfileUrl(location.href);
    }

    const existing = document.getElementById("acc-panel");

    if (existing) existing.remove();
    if (panel && panel !== existing) panel.remove();

    panel = null;
    contactRevealed = false;
  }

  function handleNavigation() {
    const isProfilePage =
      location.pathname.startsWith("/in/");

    if (!isProfilePage) {
      if (panel) {
        closePanel(false);
      }

      lastUrl = location.href;
      return;
    }

    const newBaseUrl =
      getBaseProfileUrl(location.href);

    if (newBaseUrl !== lastUrl) {
      lastUrl = newBaseUrl;
      contactRevealed = false;
      cachedProfile = null;

      if (
        manuallyClosedUrl &&
        manuallyClosedUrl !== newBaseUrl
      ) {
        manuallyClosedUrl = "";
      }

      if (!manuallyClosedUrl) {
        openPanel(newBaseUrl);
      } else if (panel) {
        loadProfile(newBaseUrl);
        scheduleProfileRetries(newBaseUrl, 0);
      }
    }
  }

  function checkAndRefreshProfileIfIncomplete() {
    if (
      !panel ||
      !location.pathname.startsWith("/in/")
    ) {
      return;
    }

    if (
      !cachedProfile ||
      !cachedProfile.company ||
      !cachedProfile.location ||
      cachedProfile.name === "Name Not Available" ||
      cachedProfile.headline === "Designation Not Available"
    ) {
      clearTimeout(scrapeTimer);

      scrapeTimer = setTimeout(async () => {
        const latest = scrape();
        let changed = false;

        if (cachedProfile) {
          if (
            cachedProfile.name === "Name Not Available" &&
            isValidValue(
              latest.name,
              "Name Not Available"
            )
          ) {
            cachedProfile.name = latest.name;
            changed = true;
          }

          if (
            cachedProfile.headline ===
              "Designation Not Available" &&
            isValidValue(
              latest.headline,
              "Designation Not Available"
            )
          ) {
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

        if (changed) {
          await persistCachedProfile();

          if (panel) render();
        }
      }, 400);
    }
  }

  function openPanel(targetUrl) {
    if (!location.pathname.startsWith("/in/")) {
      console.log(
        "[Contact Finder] Not on a profile page (/in/):",
        location.pathname
      );
      return;
    }

    const baseUrl =
      targetUrl || getBaseProfileUrl(location.href);

    lastUrl = baseUrl;
    manuallyClosedUrl = "";
    contactRevealed = false;

    createPanel();
    loadProfile(baseUrl);
    scheduleProfileRetries(baseUrl, 0);
  }

  chrome.runtime.onMessage.addListener((message) => {
    console.log(
      "[Contact Finder] Received message:",
      message
    );

    if (message.type === "toggle") {
      const existing =
        document.getElementById("acc-panel");

      if (existing || panel) {
        closePanel(true);

        console.log(
          "[Contact Finder] Panel toggled closed"
        );
      } else {
        manuallyClosedUrl = "";
        openPanel();

        console.log(
          "[Contact Finder] Panel toggled open"
        );
      }
    }
  });

  startContactObserver();

  window.addEventListener(
    "popstate",
    handleNavigation
  );

  if (location.pathname.startsWith("/in/")) {
    setTimeout(() => {
      handleNavigation();
    }, 250);
  }

  setInterval(() => {
    const isProfile =
      location.pathname.startsWith("/in/");

    if (isProfile) {
      const current =
        getBaseProfileUrl(location.href);

      if (current !== lastUrl) {
        handleNavigation()
      }
    } else if (lastUrl && panel) {
      handleNavigation();
    }
  }, 350);
})();
