(function initCommunityModule(scope) {
  scope.ADM_MODULES = scope.ADM_MODULES || {};

  /** Curated external links; name opens URL in a new tab. */
  const COMMUNITY_LINKS = [
    {
      section: "games",
      name: "arcadedarts",
      author: "@alexgplays",
      url: "https://arcadedarts.vercel.app/"
    },
    {
      section: "games",
      name: "open-darts",
      author: "@_superhands_",
      url: "https://open-darts.vercel.app/"
    },
    {
      section: "games",
      name: "Dartfortress",
      author: "@Darts Gondel",
      url: "https://dartfortress.com/dartfortress"
    },
    {
      section: "tools",
      name: "Gimmicks",
      author: "Fanki [AD]",
      url: "https://greasyfork.org/de/scripts/573373-autodarts-lobby-filter-and-other-stuff"
    },
    {
      section: "tools",
      name: "Followdarts",
      author: "@Lobiix",
      url: "https://followdarts.com/"
    },
    {
      section: "tools",
      name: "ThrowSense",
      author: "ThrowSense",
      url: "https://throwsense.com/"
    }
  ];

  function escAttr(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escText(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderSectionItems(section) {
    return COMMUNITY_LINKS.filter((x) => x.section === section)
      .map(
        (item) => `
      <li class="communityProjectRow">
        <a class="communityProjectName" href="${escAttr(item.url)}" target="_blank" rel="noopener noreferrer">${escText(
          item.name
        )}</a>
        <div class="liSub communityProjectMeta"><span data-i18n="community_by_label">by</span> ${escText(item.author)}</div>
      </li>
    `
      )
      .join("");
  }

  scope.ADM_MODULES.community = {
    id: "community",
    icon: "C",
    navLabelKey: "nav_community",
    needs: { streamerbot: false, obs: false },
    render() {
      return `
        <h2 class="title"><span data-i18n="title_community">Community</span><span class="titleMeta">Links</span></h2>
        <div class="card">
          <p class="hint" data-i18n="community_page_hint">Externe Community-Projekte; Klick auf den Namen öffnet die Seite.</p>

          <div class="formRow" style="margin-top:16px;">
            <div class="sectionTitle" style="margin:0;" data-i18n="community_section_games">Games</div>
            <ul class="communityProjectList">${renderSectionItems("games")}</ul>
          </div>

          <div class="formRow" style="margin-top:18px;">
            <div class="sectionTitle" style="margin:0;" data-i18n="community_section_tools">Tools</div>
            <ul class="communityProjectList">${renderSectionItems("tools")}</ul>
          </div>
        </div>
        <style>
          .communityProjectList { list-style: none; margin: 8px 0 0; padding: 0; }
          .communityProjectRow { margin: 12px 0 0; padding: 0; }
          .communityProjectName {
            font-weight: 600;
            color: var(--accent, #19c7ff);
            text-decoration: none;
            font-size: 15px;
          }
          .communityProjectName:hover { text-decoration: underline; }
          .communityProjectMeta { margin-top: 4px; }
        </style>
        <div class="spacer"></div>
      `;
    },
    bind() {},
    sync() {}
  };
})(window);
