/**
 * The lead record schema - the single source of truth for field order, CSV
 * headers and the side panel's column picker. Loaded by both the content
 * scripts and the side panel, so it must stay dependency-free.
 */
(function (root) {
  const SNS = (root.SNS = root.SNS || {});

  /**
   * `api` marks fields only the intercepted JSON can supply; `dom` marks fields
   * readable from rendered markup. The side panel uses this to explain why a
   * column is empty when API capture didn't fire.
   */
  const FIELDS = [
    // Identity
    { key: "fullName", label: "Full name", group: "Identity", source: "dom" },
    { key: "firstName", label: "First name", group: "Identity", source: "api" },
    { key: "lastName", label: "Last name", group: "Identity", source: "api" },
    { key: "headline", label: "Headline", group: "Identity", source: "dom" },
    { key: "profileUrl", label: "Sales Nav URL", group: "Identity", source: "dom" },
    { key: "publicProfileUrl", label: "Public profile URL", group: "Identity", source: "api" },
    { key: "leadId", label: "Lead ID", group: "Identity", source: "dom" },
    { key: "memberUrn", label: "Member URN", group: "Identity", source: "api" },
    { key: "photoUrl", label: "Photo URL", group: "Identity", source: "dom" },

    // Current role
    { key: "title", label: "Title", group: "Current role", source: "dom" },
    { key: "company", label: "Company", group: "Current role", source: "dom" },
    { key: "companyId", label: "Company ID", group: "Current role", source: "api" },
    { key: "companyUrl", label: "Company URL", group: "Current role", source: "dom" },
    { key: "companyIndustry", label: "Company industry", group: "Current role", source: "api" },
    { key: "companySize", label: "Company size", group: "Current role", source: "api" },
    { key: "companyLocation", label: "Company location", group: "Current role", source: "api" },
    { key: "roleStart", label: "Role start", group: "Current role", source: "api" },
    { key: "roleMonths", label: "Months in role", group: "Current role", source: "dom" },
    { key: "companyStart", label: "Company start", group: "Current role", source: "api" },
    { key: "companyMonths", label: "Months at company", group: "Current role", source: "api" },
    { key: "roleDescription", label: "Role description", group: "Current role", source: "api" },

    // History
    { key: "pastTitle", label: "Previous title", group: "History", source: "api" },
    { key: "pastCompany", label: "Previous company", group: "History", source: "api" },
    { key: "pastPositions", label: "All past positions", group: "History", source: "api" },
    { key: "yearsExperience", label: "Years experience", group: "History", source: "api" },
    { key: "school", label: "School", group: "History", source: "api" },
    { key: "education", label: "Education detail", group: "History", source: "api" },

    // Context
    { key: "location", label: "Location", group: "Context", source: "dom" },
    { key: "country", label: "Country", group: "Context", source: "api" },
    { key: "industry", label: "Industry", group: "Context", source: "api" },
    { key: "summary", label: "About", group: "Context", source: "api" },
    { key: "degree", label: "Connection degree", group: "Context", source: "dom" },
    { key: "sharedConnections", label: "Shared connections", group: "Context", source: "dom" },
    { key: "connectionsCount", label: "Connections", group: "Context", source: "api" },

    // Signals
    { key: "spotlights", label: "Spotlights", group: "Signals", source: "dom" },
    { key: "openLink", label: "OpenLink", group: "Signals", source: "api" },
    { key: "premium", label: "Premium", group: "Signals", source: "api" },
    { key: "openToWork", label: "Open to work", group: "Signals", source: "api" },
    { key: "saved", label: "Saved lead", group: "Signals", source: "dom" },
    { key: "viewed", label: "Recently viewed", group: "Signals", source: "api" },
    { key: "lastActivity", label: "Last activity", group: "Signals", source: "api" },

    // Provenance
    { key: "source", label: "Source", group: "Meta", source: "dom" },
    { key: "page", label: "Result page", group: "Meta", source: "dom" },
    { key: "rank", label: "Rank on page", group: "Meta", source: "dom" },
    { key: "searchUrl", label: "Search URL", group: "Meta", source: "dom" },
    { key: "scrapedAt", label: "Scraped at", group: "Meta", source: "dom" },
  ];

  const COLUMNS = FIELDS.map((f) => f.key);

  const GROUPS = FIELDS.reduce((acc, field) => {
    (acc[field.group] = acc[field.group] || []).push(field);
    return acc;
  }, {});

  /** Flatten a record value into something a CSV cell can hold. */
  function cell(value) {
    if (value === null || value === undefined) return "";
    if (Array.isArray(value)) return value.filter(Boolean).join(" | ");
    if (typeof value === "boolean") return value ? "yes" : "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  Object.assign(SNS, { FIELDS, COLUMNS, GROUPS, cell });
})(typeof window !== "undefined" ? window : globalThis);
