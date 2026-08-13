/**
 * Voyager payload -> flat lead record.
 *
 * Written defensively on purpose. Rather than assume an envelope shape, it
 * hunts the whole response tree for objects that *look* like a person, then
 * reads each field through a priority list of paths with a name-based deep
 * search as the last resort. A LinkedIn refactor should degrade individual
 * columns, never the whole extractor.
 */
(function (root) {
  const SNS = (root.SNS = root.SNS || {});
  const { dig, digAny, collect, deepGet, isEmpty } = SNS;

  // ------------------------------------------------------------- primitives

  const str = (v) => {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v.trim();
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    // Localized text nodes: { text: "..." } or { localized: { en_US: "..." } }
    if (typeof v === "object") {
      if (typeof v.text === "string") return v.text.trim();
      if (v.localized && typeof v.localized === "object") {
        const first = Object.values(v.localized)[0];
        if (typeof first === "string") return first.trim();
      }
      if (typeof v.name === "string") return v.name.trim();
    }
    return "";
  };

  const isUrn = (v) => typeof v === "string" && v.startsWith("urn:");

  /** `urn:li:fs_salesProfile:(ACwAAA...,NAME_SEARCH,x)` -> `ACwAAA...` */
  function urnToken(urn) {
    const s = str(urn);
    const paren = s.match(/\(([^,)]+)/);
    if (paren) return paren[1];
    const tail = s.match(/urn:li:[^:]+:(.+)$/);
    return tail ? tail[1] : "";
  }

  const numericUrnId = (urn) => {
    const m = str(urn).match(/(\d+)\D*$/);
    return m ? m[1] : "";
  };

  /** `{ year: 2021, month: 3 }` -> `2021-03` */
  function ymd(value) {
    if (!value || typeof value !== "object") return "";
    const { year, month } = value;
    if (!year) return "";
    return month ? `${year}-${String(month).padStart(2, "0")}` : String(year);
  }

  function monthsSince(value) {
    if (!value || !value.year) return "";
    const start = new Date(value.year, (value.month || 1) - 1, 1);
    const now = new Date();
    const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    return months >= 0 ? months : "";
  }

  /** Pick the largest artifact from a Voyager display-image object. */
  function imageUrl(node) {
    if (!node || typeof node !== "object") return "";
    const rootUrl = str(node.rootUrl) || str(dig(node, "com.linkedin.common.VectorImage.rootUrl"));
    const artifacts = node.artifacts || dig(node, "com.linkedin.common.VectorImage.artifacts");
    if (rootUrl && Array.isArray(artifacts) && artifacts.length) {
      const best = artifacts.reduce((a, b) => ((b.width || 0) > (a.width || 0) ? b : a));
      return rootUrl + str(best.fileIdentifyingUrlPathSegment);
    }
    return str(node.url) || str(node);
  }

  // --------------------------------------------------------- lead detection

  /**
   * A node is a lead if it carries a person's name plus a person-shaped
   * identifier or a career field. Both halves matter: names alone match message
   * previews and "shared connection" stubs, which we don't want as rows.
   */
  function looksLikeLead(node) {
    const named =
      typeof node.fullName === "string" ||
      (typeof node.firstName === "string" && typeof node.lastName === "string");
    if (!named) return false;

    const type = str(node.$type) + str(node._type) + str(node.type);
    if (/salesProfile|Lead|Profile/i.test(type)) return true;

    const urn = str(node.entityUrn || node.objectUrn || node.profileUrn || node.memberUrn);
    if (/salesProfile|fsd_profile|member|lead/i.test(urn)) return true;

    return "currentPositions" in node || "degree" in node || "geoRegion" in node || "headline" in node;
  }

  /** Every lead object in a captured response, in the order the API returned them. */
  function findLeads(body) {
    const leads = collect(body, looksLikeLead);
    const seen = new Set();
    return leads.filter((lead) => {
      const key = str(lead.entityUrn || lead.objectUrn) || str(lead.fullName) + str(lead.headline);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ------------------------------------------------------------- extraction

  function positionRecord(pos) {
    if (!pos || typeof pos !== "object") return null;
    const title = str(digAny(pos, ["title", "role", "positionTitle"]));
    const company = str(digAny(pos, ["companyName", "company.name", "company", "companyUrnResolutionResult.name"]));
    const start = ymd(digAny(pos, ["startedOn", "startDate", "timePeriod.startDate"]));
    const end = ymd(digAny(pos, ["endedOn", "endDate", "timePeriod.endDate"]));
    if (!title && !company) return null;
    // "to" rather than a dash: the dates already contain hyphens, so
    // "2017-01-2021-02" would be unreadable in a spreadsheet cell.
    const span = [start, end || (start ? "present" : "")].filter(Boolean).join(" to ");
    return { title, company, start, end, label: [title, company, span].filter(Boolean).join(" @ ") };
  }

  function normalizeLead(raw, ctx = {}) {
    const entityUrn = str(raw.entityUrn);
    const objectUrn = str(raw.objectUrn || raw.memberUrn || raw.profileUrn);

    const currentPositions = []
      .concat(digAny(raw, ["currentPositions", "positions.current", "currentPosition"]) || [])
      .map(positionRecord)
      .filter(Boolean);
    const pastPositions = []
      .concat(digAny(raw, ["pastPositions", "positions.past"]) || [])
      .map(positionRecord)
      .filter(Boolean);

    const current = currentPositions[0] || {};
    const rawCurrent = [].concat(digAny(raw, ["currentPositions", "currentPosition"]) || [])[0] || {};

    const companyUrn = str(
      digAny(rawCurrent, ["companyUrn", "company.entityUrn", "companyUrnResolutionResult.entityUrn"])
    );
    const companyId = numericUrnId(companyUrn);

    const leadId = urnToken(entityUrn) || urnToken(objectUrn);
    const publicId = str(digAny(raw, ["publicIdentifier", "profile.publicIdentifier", "vanityName"]));
    const flagship = str(digAny(raw, ["flagshipProfileUrl", "profileUrl"]));

    const roleStartRaw = digAny(rawCurrent, ["startedOn", "startDate", "timePeriod.startDate"]);
    const companyStartRaw = digAny(rawCurrent, ["companyStartedOn", "tenureAtCompanyStartedOn"]) || roleStartRaw;

    const spotlights = []
      .concat(digAny(raw, ["spotlightBadges", "spotlights", "decoratedSpotlights"]) || [])
      .map((s) => str(digAny(s, ["text", "type", "spotlightType", "label"])))
      .filter(Boolean);

    // Kept structured, then formatted - reading the school back out of a joined
    // string would break on any school whose own name contains the separator.
    const schooling = []
      .concat(digAny(raw, ["educations", "education", "schools"]) || [])
      .map((e) => ({
        school: str(digAny(e, ["schoolName", "school.name", "school"])),
        field: str(digAny(e, ["fieldOfStudy", "degreeName", "degree"])),
      }))
      .filter((e) => e.school || e.field);

    const education = schooling.map((e) => [e.school, e.field].filter(Boolean).join(", "));

    const geo = digAny(raw, ["geoRegion", "location", "geoRegionName", "locationName"]);

    return {
      fullName: str(raw.fullName) || [str(raw.firstName), str(raw.lastName)].filter(Boolean).join(" "),
      firstName: str(raw.firstName),
      lastName: str(raw.lastName),
      headline: str(digAny(raw, ["headline", "summary", "occupation"])),

      profileUrl: leadId ? `https://www.linkedin.com/sales/lead/${leadId}` : "",
      publicProfileUrl: publicId ? `https://www.linkedin.com/in/${publicId}` : flagship,
      leadId,
      memberUrn: objectUrn || entityUrn,
      photoUrl: imageUrl(digAny(raw, ["profilePictureDisplayImage", "picture", "profilePicture", "image"])),

      title: current.title || str(digAny(raw, ["title", "currentTitle"])),
      company: current.company || str(digAny(raw, ["companyName", "currentCompanyName"])),
      companyId,
      companyUrl: companyId ? `https://www.linkedin.com/sales/company/${companyId}` : "",
      companyIndustry: str(digAny(rawCurrent, ["companyIndustry", "company.industry", "industry"])),
      companySize: str(digAny(rawCurrent, ["companyEmployeeCountRange", "company.employeeCountRange", "employeeCountRange"])),
      companyLocation: str(digAny(rawCurrent, ["companyLocation", "company.location", "location"])),
      roleStart: ymd(roleStartRaw),
      roleMonths: monthsSince(roleStartRaw),
      companyStart: ymd(companyStartRaw),
      companyMonths: monthsSince(companyStartRaw),
      roleDescription: str(digAny(rawCurrent, ["description", "summary"])),

      pastTitle: pastPositions[0] ? pastPositions[0].title : "",
      pastCompany: pastPositions[0] ? pastPositions[0].company : "",
      pastPositions: pastPositions.map((p) => p.label),
      yearsExperience: str(digAny(raw, ["yearsOfExperience", "numOfYearsExperience", "experienceYears"])),
      school: schooling[0] ? schooling[0].school : "",
      education,

      location: isUrn(geo) ? str(digAny(raw, ["geoRegionName", "locationName"])) : str(geo),
      country: str(digAny(raw, ["countryCode", "country", "geoCountryName"])),
      industry: str(digAny(raw, ["industry", "industryName", "industryV2"])),
      summary: str(digAny(raw, ["about", "profileSummary", "summary"])),
      degree: str(digAny(raw, ["degree", "networkDistance", "distance"])),
      sharedConnections: str(digAny(raw, ["sharedConnectionsCount", "numOfSharedConnections", "sharedConnections"])),
      connectionsCount: str(digAny(raw, ["numOfConnections", "connectionsCount"])),

      spotlights,
      openLink: Boolean(digAny(raw, ["openLink", "isOpenLink"])),
      premium: Boolean(digAny(raw, ["premium", "isPremium"])),
      openToWork: Boolean(digAny(raw, ["openToWork", "isOpenToWork", "jobSeeker"])),
      saved: Boolean(digAny(raw, ["saved", "isSaved", "savedToList"])),
      viewed: Boolean(digAny(raw, ["viewed", "isViewed", "recentlyViewed"])),
      lastActivity: str(digAny(raw, ["lastActivityAt", "latestActivity", "lastTimeContacted"])),

      source: "api",
      page: ctx.page || "",
      rank: ctx.rank || "",
      searchUrl: ctx.searchUrl || "",
      scrapedAt: new Date().toISOString(),
    };
  }

  /** Parse every lead out of one captured response. */
  function leadsFromPayload(body, ctx = {}) {
    return findLeads(body).map((raw, i) => normalizeLead(raw, { ...ctx, rank: (ctx.rankOffset || 0) + i + 1 }));
  }

  /**
   * Merge two views of the same person. API values win where present; DOM fills
   * the gaps, which matters when LinkedIn moves a field we haven't remapped yet.
   */
  function merge(primary, secondary) {
    if (!primary) return secondary;
    if (!secondary) return primary;

    const out = { ...secondary };
    for (const [key, value] of Object.entries(primary)) {
      if (!isEmpty(value)) out[key] = value;
    }
    out.source = primary.source === secondary.source ? primary.source : "api+dom";
    return out;
  }

  /** Stable identity for deduplication across pages and searches. */
  function identity(lead) {
    return (
      lead.leadId ||
      urnToken(lead.memberUrn) ||
      lead.publicProfileUrl ||
      lead.profileUrl ||
      `${lead.fullName}|${lead.company}`.toLowerCase()
    );
  }

  Object.assign(SNS, { findLeads, normalizeLead, leadsFromPayload, merge, identity, urnToken });
})(typeof window !== "undefined" ? window : globalThis);
