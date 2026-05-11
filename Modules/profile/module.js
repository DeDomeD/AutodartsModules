(function initProfileModule(scope) {
  scope.ADM_MODULES = scope.ADM_MODULES || {};

  function parseAccountUser(settings) {
    const raw = String(settings?.accountUserJson || "").trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function accountDisplayName(user) {
    if (!user || typeof user !== "object") return "";
    return String(
      user.global_name ||
        user.displayName ||
        user.name ||
        user.username ||
        user.userName ||
        user.nick ||
        user.email ||
        ""
    ).trim();
  }

  function accountAvatarSrc(user) {
    if (!user || typeof user !== "object") return "";
    const direct = String(
      user.avatarUrl ||
        user.avatar_url ||
        user.avatarURL ||
        user.picture ||
        user.image ||
        user.photo ||
        user.discordAvatarUrl ||
        user.discord_avatar_url ||
        ""
    ).trim();
    if (direct) return direct;
    const id = String(user.id || user.discordId || user.discord_id || "").trim();
    const avatar = String(user.avatar || user.avatarHash || user.avatar_hash || "").trim();
    if (id && avatar && !/^https?:\/\//i.test(avatar) && !avatar.startsWith("data:image/")) {
      const ext = avatar.startsWith("a_") ? "gif" : "png";
      return `https://cdn.discordapp.com/avatars/${encodeURIComponent(id)}/${encodeURIComponent(avatar)}.${ext}?size=128`;
    }
    if (/^https?:\/\//i.test(avatar) || avatar.startsWith("data:image/")) return avatar;
    return "";
  }

  function profileAvatarSrc(settings, remote = null) {
    const accountAvatar = accountAvatarSrc(parseAccountUser(settings));
    if (accountAvatar) return accountAvatar;
    const rp = remote?.profile && typeof remote.profile === "object" ? remote.profile : remote;
    const remoteAvatar = String(rp?.avatarUrl || rp?.avatar_url || rp?.discordAvatarUrl || rp?.discord_avatar_url || "").trim();
    if (remoteAvatar) return remoteAvatar;
    return "";
  }

  function serverProfilePayload(remote) {
    return remote?.profile && typeof remote.profile === "object" ? remote.profile : (remote || {});
  }

  async function fetchMeProfile(api) {
    const token = String(api.getSettings?.()?.accountToken || "").trim();
    if (!token) return { ok: false, skipped: true };
    try {
      return await api.callWebsiteApi("/api/me/profile", { method: "GET", token });
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  async function putMeProfile(api, body) {
    const token = String(api.getSettings?.()?.accountToken || "").trim();
    if (!token) return { ok: false, error: "no_token" };
    try {
      return await api.callWebsiteApi("/api/me/profile", { method: "PUT", token, body });
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  scope.ADM_MODULES.profile = {
    id: "profile",
    icon: "P",
    navLabelKey: "nav_profile",
    needs: { streamerbot: false, obs: false },
    render() {
      return `
        <h2 class="title"><span data-i18n="title_profile">Profil</span><span class="titleMeta">ADM</span></h2>
        <div class="card">
          <p class="hint" data-i18n="profile_page_intro">
            Verknüpfe deinen Account und pflege dein öffentliches Profil. Für Rankings und die spätere Profilseite anderer Spieler ist ein Login nötig.
          </p>

          <div class="formRow" style="margin-top:14px;">
            <div class="sectionTitle" style="margin:0;" data-i18n="profile_section_login">Anmeldung</div>
            <div class="profileAccountCard">
              <img id="profileAccountAvatar" class="profileAccountAvatar isEmpty" alt="" width="52" height="52" decoding="async" />
              <div class="profileAccountMain">
                <div id="profileLoginStatus" class="profileLoginStatus"></div>
                <div class="profileLoginActions">
                  <button type="button" class="profileDiscordBtn" id="profileBtnDiscord">
                    <span class="profileDiscordIcon" aria-hidden="true">D</span>
                    <span data-i18n="profile_discord_login">Mit Discord anmelden</span>
                  </button>
                  <button type="button" class="btnMini profileLogoutBtn" id="profileBtnLogout" data-i18n="profile_logout">Abmelden</button>
                </div>
              </div>
            </div>
            <div class="hint profileServerHint" data-i18n="profile_discord_server_hint">
              Der Website-Server muss den Discord-Login unter /api/auth/discord/ bereitstellen (wie bei Google). Sonst siehst du nach dem Redirect eine Fehlermeldung.
            </div>
          </div>

          <div class="divider"></div>

          <div class="formRow">
            <div class="sectionTitle" style="margin:0;" data-i18n="profile_section_public">Öffentliches Profil</div>
            <div class="profileOptInRow">
              <label class="switch switchCompact" aria-label="Öffentliches Profil">
                <input type="checkbox" id="profilePublicOptIn" />
                <span class="slider"></span>
              </label>
              <span class="profileOptInText" data-i18n="profile_public_optin">Profil & Ranking später für andere sichtbar (wenn der Server es unterstützt)</span>
            </div>
          </div>

          <div class="formRow" style="margin-top:12px;">
            <label class="label" for="profileDisplayName" data-i18n="profile_display_name">Anzeigename</label>
            <input class="input" id="profileDisplayName" type="text" maxlength="80" data-i18n-placeholder="profile_display_name_ph" placeholder="" />
          </div>
          <div class="formRow">
            <label class="label" for="profileRegion" data-i18n="profile_region">Region / Land (kurz)</label>
            <input class="input" id="profileRegion" type="text" maxlength="40" data-i18n-placeholder="profile_region_ph" placeholder="" />
          </div>
          <div class="formRow">
            <label class="label" for="profileBio" data-i18n="profile_bio">Über mich</label>
            <textarea class="input" id="profileBio" rows="4" maxlength="600" data-i18n-placeholder="profile_bio_ph" placeholder=""></textarea>
          </div>

          <div class="rowSplit" style="margin-top:14px; flex-wrap:wrap;">
            <button type="button" class="btnPrimary" id="profileSaveLocal" data-i18n="profile_save_local">Lokal speichern</button>
            <button type="button" class="btn" id="profileSyncServer" data-i18n="profile_sync_server">Mit Server synchronisieren</button>
            <button type="button" class="btnMini" id="profilePullServer" data-i18n="profile_pull_server">Vom Server laden</button>
          </div>
          <div id="profileStatusLine" class="hint" style="margin-top:10px;"></div>

          <div class="divider"></div>
          <div class="formRow">
            <div class="sectionTitle" style="margin:0;" data-i18n="profile_section_ranking">Ranking</div>
            <div id="profileRankingBox" class="hint" data-i18n="profile_ranking_placeholder">
              Sobald der Server Punkte liefert, erscheinen sie hier. Bis dahin hilft das ausgefüllte Profil als Grundlage.
            </div>
          </div>
        </div>
        <style>
          .profileAccountCard{
            display:flex;
            align-items:center;
            gap:12px;
            margin-top:10px;
            padding:12px;
            border:1px solid rgba(88,101,242,.28);
            border-radius:16px;
            background:
              radial-gradient(90% 130% at 0% 0%, rgba(88,101,242,.20), transparent 58%),
              rgba(255,255,255,.035);
          }
          .profileAccountAvatar{
            width:52px;
            height:52px;
            border-radius:50%;
            border:1px solid rgba(255,255,255,.16);
            object-fit:cover;
            background:rgba(255,255,255,.05);
            flex:0 0 auto;
          }
          .profileAccountAvatar.isEmpty{
            opacity:.42;
          }
          .profileAccountMain{
            min-width:0;
            flex:1 1 auto;
          }
          .profileLoginStatus{
            min-height:18px;
            color:var(--text);
            font-size:12px;
            font-weight:650;
            overflow:hidden;
            text-overflow:ellipsis;
            white-space:nowrap;
          }
          .profileLoginActions{
            display:flex;
            flex-wrap:wrap;
            gap:8px;
            margin-top:8px;
          }
          .profileDiscordBtn{
            display:inline-flex;
            align-items:center;
            justify-content:center;
            gap:8px;
            min-height:34px;
            border:1px solid rgba(88,101,242,.52);
            border-radius:999px;
            padding:7px 12px;
            color:#fff;
            background:linear-gradient(135deg,#5865f2,#4752c4);
            box-shadow:0 8px 20px rgba(88,101,242,.22);
            font-weight:750;
            cursor:pointer;
          }
          .profileDiscordBtn:hover{
            filter:brightness(1.08);
          }
          .profileDiscordIcon{
            display:inline-flex;
            align-items:center;
            justify-content:center;
            width:20px;
            height:20px;
            border-radius:50%;
            background:rgba(255,255,255,.18);
            font-size:12px;
            font-weight:900;
          }
          .profileLogoutBtn{
            min-height:34px;
            border-radius:999px;
          }
          .profileServerHint{
            margin-top:8px;
            line-height:1.35;
          }
          .profileOptInRow{
            display:flex;
            align-items:flex-start;
            gap:10px;
            margin-top:10px;
            padding:10px;
            border:1px solid var(--stroke);
            border-radius:12px;
            background:rgba(255,255,255,.03);
          }
          .profileOptInRow .switch{
            margin-top:1px;
          }
          .profileOptInText{
            min-width:0;
            color:var(--muted);
            font-size:12px;
            line-height:1.35;
          }
        </style>
        <div class="spacer"></div>
      `;
    },
    bind(api) {
      const root = api.root;
      const statusEl = root.querySelector("#profileStatusLine");
      const loginStatusEl = root.querySelector("#profileLoginStatus");
      const rankingBox = root.querySelector("#profileRankingBox");
      const accountAvatar = root.querySelector("#profileAccountAvatar");
      const serverHint = root.querySelector(".profileServerHint");

      function setStatus(text) {
        if (statusEl) statusEl.textContent = text || "";
      }

      function setImageSrc(img, src) {
        if (!img) return;
        const d = String(src || "").trim();
        if (!d) {
          img.classList.add("isEmpty");
          img.removeAttribute("src");
          return;
        }
        img.classList.remove("isEmpty");
        img.src = d;
      }

      function applyAccountAvatar(settings, remote = null) {
        const token = String(settings?.accountToken || "").trim();
        setImageSrc(accountAvatar, token ? profileAvatarSrc(settings, remote) : "");
      }

      function refreshLoginStatus(settings) {
        if (!loginStatusEl) return;
        const token = String(settings?.accountToken || "").trim();
        const user = parseAccountUser(settings);
        if (!token) {
          loginStatusEl.textContent = api.t("profile_status_logged_out");
          if (serverHint) serverHint.hidden = false;
          applyAccountAvatar(settings);
          return;
        }
        const name = accountDisplayName(user) || api.t("profile_status_logged_in_unknown");
        loginStatusEl.textContent = api.t("profile_status_logged_in", { name });
        if (serverHint) serverHint.hidden = true;
        applyAccountAvatar(settings);
      }

      function fillFormFromSettings(settings) {
        api.setValue(root, "profileDisplayName", settings?.profileDisplayName || "");
        api.setValue(root, "profileRegion", settings?.profileRegion || "");
        api.setValue(root, "profileBio", settings?.profileBio || "");
        const opt = root.querySelector("#profilePublicOptIn");
        if (opt) opt.checked = settings?.profilePublicOptIn === true;
        applyAccountAvatar(settings);
      }

      async function mergeServerProfile(settings) {
        const remote = await fetchMeProfile(api);
        if (remote?.skipped) {
          setStatus(api.t("profile_sync_need_login"));
          return settings;
        }
        if (!remote || remote.ok === false) {
          setStatus(api.t("profile_pull_failed", { error: remote?.error || "?" }));
          return settings;
        }
        const patch = {};
        const profile = serverProfilePayload(remote);
        if (typeof profile.displayName === "string") patch.profileDisplayName = profile.displayName;
        if (typeof profile.bio === "string") patch.profileBio = profile.bio;
        if (typeof profile.region === "string") patch.profileRegion = profile.region;
        if (typeof profile.publicOptIn === "boolean") patch.profilePublicOptIn = profile.publicOptIn;
        if (Object.keys(patch).length) {
          patch.profileLastSyncedAt = new Date().toISOString();
          await api.savePartial(patch);
          setStatus(api.t("profile_pull_ok"));
          return { ...settings, ...patch };
        }
        setStatus(api.t("profile_pull_empty"));
        return settings;
      }

      function applyRankingUi(remote) {
        if (!rankingBox) return;
        const profile = serverProfilePayload(remote);
        const pts = profile?.rankingPoints ?? profile?.rankPoints ?? profile?.score ?? remote?.rankingPoints ?? remote?.rankPoints ?? remote?.score;
        const rank = profile?.rankingRank ?? profile?.rank ?? remote?.rankingRank ?? remote?.rank;
        if (pts != null && String(pts).trim() !== "") {
          rankingBox.textContent = api.t("profile_ranking_stats", {
            points: String(pts),
            rank: rank != null && String(rank).trim() !== "" ? String(rank) : "—"
          });
          return;
        }
        rankingBox.textContent = api.t("profile_ranking_placeholder");
      }

      root.querySelector("#profileBtnDiscord")?.addEventListener("click", async () => {
        setStatus("");
        try {
          const baseUrl = api.normalizeWebsiteApiUrl(api.getSettings?.()?.websiteApiUrl);
          const res = await api.send({ type: "START_DISCORD_AUTH", baseUrl });
          if (!res?.ok) throw new Error(String(res?.error || "discord_failed"));
          await api.reloadSettingsFromStorage?.();
          setStatus(api.t("profile_discord_ok"));
          fillFormFromSettings(api.getSettings?.() || {});
          refreshLoginStatus(api.getSettings?.() || {});
          const r = await fetchMeProfile(api);
          if (r && r.ok !== false && !r.skipped) {
            applyRankingUi(r);
            applyAccountAvatar(api.getSettings?.() || {}, r);
          }
        } catch (e) {
          setStatus(api.t("profile_discord_err", { error: String(e?.message || e) }));
        }
      });

      root.querySelector("#profileBtnLogout")?.addEventListener("click", async () => {
        await api.savePartial({ accountToken: "", accountUserJson: "" });
        setStatus(api.t("profile_logout_ok"));
        refreshLoginStatus(api.getSettings?.() || {});
      });

      root.querySelector("#profileSaveLocal")?.addEventListener("click", async () => {
        const displayName = String(root.querySelector("#profileDisplayName")?.value || "").trim();
        const region = String(root.querySelector("#profileRegion")?.value || "").trim();
        const bio = String(root.querySelector("#profileBio")?.value || "").trim();
        const publicOptIn = !!root.querySelector("#profilePublicOptIn")?.checked;
        await api.savePartial({
          profileDisplayName: displayName,
          profileRegion: region,
          profileBio: bio,
          profilePublicOptIn: publicOptIn
        });
        setStatus(api.t("profile_saved_local"));
      });

      api.bindAuto(root, "profilePublicOptIn", "profilePublicOptIn", "checkbox");

      root.querySelector("#profileSyncServer")?.addEventListener("click", async () => {
        setStatus("");
        const settings = api.getSettings?.() || {};
        const token = String(settings.accountToken || "").trim();
        if (!token) {
          setStatus(api.t("profile_sync_need_login"));
          return;
        }
        const avatar = profileAvatarSrc(settings);
        const body = {
          displayName: String(settings.profileDisplayName || "").trim(),
          region: String(settings.profileRegion || "").trim(),
          bio: String(settings.profileBio || "").trim(),
          publicOptIn: settings.profilePublicOptIn === true,
          avatarUrl: avatar && /^https?:\/\//i.test(avatar) ? avatar : undefined
        };
        const res = await putMeProfile(api, body);
        if (!res?.ok) {
          setStatus(api.t("profile_sync_failed", { error: res?.error || "?" }));
          return;
        }
        await api.savePartial({ profileLastSyncedAt: new Date().toISOString() });
        setStatus(api.t("profile_sync_ok"));
        applyRankingUi(res);
      });

      root.querySelector("#profilePullServer")?.addEventListener("click", async () => {
        setStatus(api.t("profile_pull_loading"));
        const next = await mergeServerProfile(api.getSettings?.() || {});
        fillFormFromSettings(next);
        const r = await fetchMeProfile(api);
        if (r && r.ok !== false && !r.skipped) applyRankingUi(r);
      });
    },
    sync(api, settings) {
      const root = api.root;
      if (!root) return;
      api.setValue(root, "profileDisplayName", settings?.profileDisplayName || "");
      api.setValue(root, "profileRegion", settings?.profileRegion || "");
      api.setValue(root, "profileBio", settings?.profileBio || "");
      const accountAvatar = root.querySelector("#profileAccountAvatar");
      const d = profileAvatarSrc(settings);
      const token = String(settings?.accountToken || "").trim();
      if (accountAvatar) {
        if (!token || !d) {
          accountAvatar.classList.add("isEmpty");
          accountAvatar.removeAttribute("src");
        } else {
          accountAvatar.classList.remove("isEmpty");
          accountAvatar.src = d;
        }
      }
      api.setChecked?.(root, "profilePublicOptIn", settings?.profilePublicOptIn === true);
      const loginStatusEl = root.querySelector("#profileLoginStatus");
      if (loginStatusEl) {
        const token = String(settings?.accountToken || "").trim();
        const user = parseAccountUser(settings);
        if (!token) loginStatusEl.textContent = api.t("profile_status_logged_out");
        else {
          const name = accountDisplayName(user) || api.t("profile_status_logged_in_unknown");
          loginStatusEl.textContent = api.t("profile_status_logged_in", { name });
        }
      }
      const serverHint = root.querySelector(".profileServerHint");
      if (serverHint) serverHint.hidden = !!token;
      void (async () => {
        const r = await fetchMeProfile(api);
        if (r && r.ok !== false && !r.skipped) {
          const box = root.querySelector("#profileRankingBox");
          const remoteAvatar = profileAvatarSrc(settings, r);
          if (remoteAvatar && token) {
            if (accountAvatar) {
              accountAvatar.classList.remove("isEmpty");
              accountAvatar.src = remoteAvatar;
            }
          }
          if (!box) return;
          const profile = serverProfilePayload(r);
          const pts = profile?.rankingPoints ?? profile?.rankPoints ?? profile?.score ?? r?.rankingPoints ?? r?.rankPoints ?? r?.score;
          const rank = profile?.rankingRank ?? profile?.rank ?? r?.rankingRank ?? r?.rank;
          if (pts != null && String(pts).trim() !== "") {
            box.textContent = api.t("profile_ranking_stats", {
              points: String(pts),
              rank: rank != null && String(rank).trim() !== "" ? String(rank) : "—"
            });
          }
        }
      })();
    }
  };
})(window);
