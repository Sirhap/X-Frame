"use strict";

(function initializeAdminConsole() {
  const PERMANENT_LOCAL_DATE = "9999-12-31T23:59";
  const PERMANENT_EXPIRY_MS = Date.parse("9999-12-31T23:59:59.999Z");
  const MILLISECONDS_PER_DAY = 86_400_000;
  const elements = {
    console: document.querySelector("#adminConsole"),
    loginView: document.querySelector("#adminLoginView"),
    loginForm: document.querySelector("#adminLoginForm"),
    loginButton: document.querySelector("#adminLoginButton"),
    loginStatus: document.querySelector("#adminLoginStatus"),
    username: document.querySelector("#adminUsername"),
    password: document.querySelector("#adminPassword"),
    totpCode: document.querySelector("#adminTotpCode"),
    totpStep: document.querySelector("#adminTotpStep"),
    countdown: document.querySelector("#adminCodeCountdown"),
    progress: document.querySelector("#adminCodeProgress"),
    dashboardView: document.querySelector("#adminDashboardView"),
    sessionExpiry: document.querySelector("#adminSessionExpiry"),
    logoutButton: document.querySelector("#adminLogoutButton"),
    licenseForm: document.querySelector("#adminLicenseForm"),
    activationCode: document.querySelector("#adminActivationCode"),
    batchCount: document.querySelector("#adminBatchCount"),
    durationDays: document.querySelector("#adminDurationDays"),
    permanentDurationButton: document.querySelector("#adminPermanentDurationButton"),
    redeemBy: document.querySelector("#adminRedeemBy"),
    permanentRedeemButton: document.querySelector("#adminPermanentRedeemButton"),
    expiryPreview: document.querySelector("#adminExpiryPreview"),
    generateButton: document.querySelector("#adminGenerateCodeButton"),
    createButton: document.querySelector("#adminCreateLicenseButton"),
    licenseStatus: document.querySelector("#adminLicenseStatus"),
    createdCodes: document.querySelector("#adminCreatedCodes"),
    createdCodesText: document.querySelector("#adminCreatedCodesText"),
    copyCodesButton: document.querySelector("#adminCopyCodesButton"),
    copySelectedButton: document.querySelector("#adminCopySelectedButton"),
    copyAllButton: document.querySelector("#adminCopyAllButton"),
    licenseItems: document.querySelector("#adminLicenseItems"),
    licenseSearch: document.querySelector("#adminLicenseSearch"),
    licenseSort: document.querySelector("#adminLicenseSort"),
    licensePageSize: document.querySelector("#adminLicensePageSize"),
    licensePreviousPage: document.querySelector("#adminLicensePreviousPage"),
    licenseNextPage: document.querySelector("#adminLicenseNextPage"),
    licensePageStatus: document.querySelector("#adminLicensePageStatus"),
    refreshButton: document.querySelector("#adminRefreshButton"),
    selectAll: document.querySelector("#adminSelectAll"),
    selectedCount: document.querySelector("#adminSelectedCount"),
    selectionBar: document.querySelector(".admin-selection-bar"),
    bulkEditor: document.querySelector(".admin-bulk-editor"),
    sourceTabs: [...document.querySelectorAll("[data-source-filter]")],
    codeCount: document.querySelector("#adminCodeCount"),
    trialCount: document.querySelector("#adminTrialCount"),
    activeCount: document.querySelector("#adminActiveCount"),
    accountCount: document.querySelector("#adminAccountCount"),
    codeTabCount: document.querySelector("#adminCodeTabCount"),
    trialTabCount: document.querySelector("#adminTrialTabCount"),
    grantTabCount: document.querySelector("#adminGrantTabCount"),
    accountSearch: document.querySelector("#adminAccountSearch"),
    accountRefresh: document.querySelector("#adminAccountRefresh"),
    accountStatus: document.querySelector("#adminAccountStatus"),
    accountItems: document.querySelector("#adminAccountItems"),
    defaultProEnabled: document.querySelector("#adminDefaultProEnabled"),
    bulkDurationDays: document.querySelector("#adminBulkDurationDays"),
    bulkPermanentButton: document.querySelector("#adminBulkPermanentButton"),
    bulkRedeemBy: document.querySelector("#adminBulkRedeemBy"),
    bulkApplyButton: document.querySelector("#adminBulkApplyButton"),
    bulkRevokeButton: document.querySelector("#adminBulkRevokeButton"),
    bulkRestoreButton: document.querySelector("#adminBulkRestoreButton"),
    bulkDeleteButton: document.querySelector("#adminBulkDeleteButton"),
    bulkStatus: document.querySelector("#adminBulkStatus"),
  };
  if (!elements.console || !elements.loginForm) return;
  const adminErrorText = globalThis.XSXBAdminErrorText;
  if (typeof adminErrorText?.localize !== "function") {
    throw new Error("Administrator error localization is required.");
  }

  const selectedLicenseIds = new Set();
  let countdownTimer = 0;
  let licenses = [];
  let periodSeconds = 30;
  let activeSourceFilter = "code";
  let licensePage = 1;

  /** @param {HTMLElement|null} element Status element. @param {string} message Message. @param {string} [tone] Visual tone. @returns {void} */
  function setStatus(element, message, tone = "") {
    if (!element) return;
    element.textContent = message;
    if (tone) element.dataset.tone = tone;
    else delete element.dataset.tone;
  }

  /** @param {HTMLButtonElement|null} button Target button. @param {boolean} busy Busy state. @returns {void} */
  function setBusy(button, busy) {
    if (!button) return;
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
  }

  /** @param {string} path API path. @param {RequestInit} [options] Fetch options. @returns {Promise<object>} Parsed JSON. */
  async function requestJson(path, options = {}) {
    let response;
    try {
      response = await fetch(path, { credentials: "same-origin", ...options });
    } catch (_error) {
      throw new Error("网络连接失败，请检查服务状态后重试。");
    }
    let payload = {};
    try {
      payload = await response.json();
    } catch (_error) {
      throw new Error("服务返回了无法识别的响应。");
    }
    if (!response.ok) {
      const error = new Error(adminErrorText.localize(payload.error, response.status));
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  /** @param {unknown} value Date-like value. @returns {string} Local display text. */
  function formatDate(value) {
    const timestamp = typeof value === "number" ? value : Date.parse(String(value || ""));
    if (!Number.isFinite(timestamp)) return "—";
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short",
      hour12: false,
    }).format(timestamp);
  }

  /** @param {unknown} value Redeem deadline. @returns {string} Deadline display. */
  function formatRedeemBy(value) {
    const timestamp = Date.parse(String(value || ""));
    if (!Number.isFinite(timestamp) || new Date(timestamp).getUTCFullYear() >= 9999) return "永久";
    return formatDate(value);
  }

  /** @param {string} value datetime-local value. @returns {string} ISO date or empty. */
  function localDateToIso(value) {
    if (!value) return "";
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
  }

  /** @param {string} value Clipboard text. @param {HTMLElement} statusElement Status target. @returns {Promise<void>} */
  async function copyText(value, statusElement) {
    if (!value) {
      setStatus(statusElement, "选中的旧激活码没有可恢复的原文。", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setStatus(statusElement, "激活码已复制到剪贴板。", "success");
    } catch (_error) {
      setStatus(statusElement, "无法自动复制，请手动选择激活码后按 ⌘C。", "error");
    }
  }

  /** @param {boolean} authenticated Authentication state. @returns {void} */
  function showAuthenticatedView(authenticated) {
    elements.loginView.hidden = authenticated;
    elements.dashboardView.hidden = !authenticated;
    if (authenticated) elements.activationCode.focus();
    else {
      clearSensitiveAdminState();
      elements.username.focus();
    }
  }

  /**
   * Removes decrypted activation data whenever the local administrator view is locked.
   * @returns {void}
   */
  function clearSensitiveAdminState() {
    licenses = [];
    selectedLicenseIds.clear();
    elements.licenseItems.replaceChildren();
    elements.createdCodesText.value = "";
    elements.createdCodes.hidden = true;
    elements.activationCode.value = "";
    elements.selectedCount.textContent = "已选择 0 个";
    elements.selectAll.checked = false;
    elements.selectAll.indeterminate = false;
    elements.copySelectedButton.disabled = true;
    elements.copyAllButton.disabled = true;
    elements.bulkEditor.hidden = true;
    elements.selectionBar.hidden = true;
    elements.codeCount.textContent = "—";
    elements.trialCount.textContent = "—";
    elements.activeCount.textContent = "—";
    elements.accountCount.textContent = "—";
    elements.codeTabCount.textContent = "0";
    if (elements.trialTabCount) elements.trialTabCount.textContent = "0";
    if (elements.grantTabCount) elements.grantTabCount.textContent = "0";
  }

  /** @returns {void} */
  function updateCountdown() {
    const periodMs = periodSeconds * 1000;
    const remainingMs = periodMs - (Date.now() % periodMs);
    elements.countdown.textContent = `${Math.ceil(remainingMs / 1000)} 秒后更新`;
    elements.progress.style.setProperty("--admin-code-progress", String(remainingMs / periodMs));
  }

  /** @returns {void} */
  function startCountdown() {
    window.clearInterval(countdownTimer);
    updateCountdown();
    countdownTimer = window.setInterval(updateCountdown, 250);
  }

  /** @returns {string} Cryptographically random activation code. */
  function generateActivationCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(9));
    const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    return `XSXB-${token.slice(0, 6)}-${token.slice(6, 12)}-${token.slice(12, 18)}`;
  }

  /** @param {HTMLButtonElement} button Permanent toggle. @returns {boolean} Whether permanent duration is selected. */
  function isPermanentDuration(button) {
    return button.getAttribute("aria-pressed") === "true";
  }

  /** @param {HTMLInputElement} input Duration input. @param {HTMLButtonElement} button Permanent toggle. @param {boolean} permanent Next state. @returns {void} */
  function setPermanentDuration(input, button, permanent) {
    input.disabled = permanent;
    button.setAttribute("aria-pressed", String(permanent));
    button.textContent = permanent ? "永久有效" : "设为永久";
  }

  /** @returns {void} */
  function updateCreationPreview() {
    const durationDays = Number(elements.durationDays.value);
    const batchCount = Math.min(100, Math.max(1, Number(elements.batchCount.value) || 1));
    elements.createButton.firstChild.textContent = `创建 ${batchCount} 个激活码 `;
    if (isPermanentDuration(elements.permanentDurationButton)) {
      elements.expiryPreview.textContent = "激活后永久有效。";
      return;
    }
    const expectedExpiry = Date.now() + durationDays * MILLISECONDS_PER_DAY;
    if (
      !Number.isSafeInteger(durationDays) ||
      durationDays < 1 ||
      !Number.isFinite(expectedExpiry) ||
      expectedExpiry >= PERMANENT_EXPIRY_MS
    ) {
      elements.expiryPreview.textContent = "请输入有效的正整数天数；超长期授权请设为永久。";
      return;
    }
    elements.expiryPreview.textContent = `若现在首次激活，预计到期：${formatDate(expectedExpiry)}。`;
  }

  /** @returns {object[]} Licenses matching the current source and text filters. */
  function matchingLicenses() {
    const query = elements.licenseSearch.value.trim().toLocaleLowerCase("zh-CN");
    return licenses.filter((license) => {
      if (license.source !== activeSourceFilter) return false;
      if (!query) return true;
      return `${license.code || ""} ${license.codeHashPrefix || ""} ${license.id} ${license.accountEmail || ""}`
        .toLocaleLowerCase("zh-CN")
        .includes(query);
    });
  }

  /** @param {object} license License record. @returns {number} Sortable expiry timestamp. */
  function sortableExpiry(license) {
    const timestamp = Date.parse(String(license.expiresAt || ""));
    return Number.isFinite(timestamp) && new Date(timestamp).getUTCFullYear() < 9999
      ? timestamp
      : Number.POSITIVE_INFINITY;
  }

  /** @returns {object[]} Sorted licenses matching current filters. */
  function sortedLicenses() {
    const rows = matchingLicenses();
    const statusWeight = { active: 0, unused: 1, expired: 2, revoked: 3 };
    return rows.sort((left, right) => {
      if (elements.licenseSort.value === "expires-asc") {
        return (
          sortableExpiry(left) - sortableExpiry(right) || String(right.id).localeCompare(String(left.id))
        );
      }
      if (elements.licenseSort.value === "expires-desc") {
        return (
          sortableExpiry(right) - sortableExpiry(left) || String(right.id).localeCompare(String(left.id))
        );
      }
      if (elements.licenseSort.value === "status") {
        return (
          (statusWeight[left.status] ?? 99) - (statusWeight[right.status] ?? 99) ||
          sortableExpiry(left) - sortableExpiry(right) ||
          String(right.id).localeCompare(String(left.id))
        );
      }
      return String(right.id).localeCompare(String(left.id));
    });
  }

  /** @returns {{items:object[],pageCount:number,total:number}} Current display page. */
  function visibleLicenses() {
    const rows = sortedLicenses();
    const pageSize = Number(elements.licensePageSize.value) || 20;
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    licensePage = Math.min(Math.max(licensePage, 1), pageCount);
    const start = (licensePage - 1) * pageSize;
    return { items: rows.slice(start, start + pageSize), pageCount, total: rows.length };
  }

  /** @returns {void} Updates the pagination controls from current filters. */
  function updatePagination() {
    const { pageCount, total } = visibleLicenses();
    elements.licensePageStatus.textContent = `第 ${licensePage} / ${pageCount} 页 · 共 ${total} 条`;
    elements.licensePreviousPage.disabled = licensePage <= 1;
    elements.licenseNextPage.disabled = licensePage >= pageCount;
  }

  /** @returns {void} Updates summary metrics from the loaded administrator records. */
  function updateOverview() {
    const codeLicenses = licenses.filter((license) => license.source === "code");
    const trialLicenses = licenses.filter((license) => license.source === "email_trial");
    const grantLicenses = licenses.filter((license) => license.source === "admin_grant");
    const activeLicenses = licenses.filter((license) => license.status === "active");
    elements.codeCount.textContent = String(codeLicenses.length);
    elements.activeCount.textContent = String(activeLicenses.length);
    elements.codeTabCount.textContent = String(codeLicenses.length);
    if (elements.trialTabCount) elements.trialTabCount.textContent = String(trialLicenses.length);
    if (elements.grantTabCount) elements.grantTabCount.textContent = String(grantLicenses.length);
  }

  /** @returns {void} Persists the current list view in the address bar. */
  function syncListUrl() {
    const url = new URL(window.location.href);
    if (activeSourceFilter === "code") url.searchParams.delete("source");
    else url.searchParams.set("source", activeSourceFilter);
    const query = elements.licenseSearch.value.trim();
    if (query) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url);
  }

  /** @returns {void} */
  function updateSelectionState() {
    const { items: visibleRows } = visibleLicenses();
    const visibleIds = visibleRows.map((license) => license.id);
    const selectedVisibleCount = visibleIds.filter((id) => selectedLicenseIds.has(id)).length;
    elements.selectedCount.textContent = `已选择 ${selectedLicenseIds.size} 个`;
    elements.selectAll.checked = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
    elements.selectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length;
    const selectedCodes = licenses.filter((license) => selectedLicenseIds.has(license.id) && license.code);
    elements.copySelectedButton.disabled = selectedCodes.length === 0;
    elements.copyAllButton.disabled = !licenses.some((license) => license.code);
    for (const button of [
      elements.bulkApplyButton,
      elements.bulkRevokeButton,
      elements.bulkRestoreButton,
      elements.bulkDeleteButton,
    ]) {
      button.disabled = selectedLicenseIds.size === 0;
    }
    const managesCodes = activeSourceFilter === "code";
    elements.selectionBar.hidden = !managesCodes;
    elements.bulkEditor.hidden = !managesCodes || selectedLicenseIds.size === 0;
    updatePagination();
  }

  /** @param {object[]} nextLicenses License records. @returns {void} */
  function renderLicenses(nextLicenses) {
    licenses = nextLicenses;
    const visibleIds = new Set(licenses.map((license) => license.id));
    for (const id of selectedLicenseIds) {
      if (!visibleIds.has(id)) selectedLicenseIds.delete(id);
    }
    elements.licenseItems.replaceChildren();
    updateOverview();
    for (const tab of elements.sourceTabs) {
      tab.setAttribute("aria-pressed", String(tab.dataset.sourceFilter === activeSourceFilter));
    }
    const { items: filteredLicenses } = visibleLicenses();
    if (!filteredLicenses.length) {
      const empty = document.createElement("p");
      empty.className = "admin-license-empty";
      const hasSearch = Boolean(elements.licenseSearch.value.trim());
      empty.textContent = hasSearch
        ? "没有匹配的邮箱授权，请调整搜索关键词。"
        : activeSourceFilter === "email_trial"
          ? "还没有邮箱领取试用。"
          : activeSourceFilter === "admin_grant"
            ? "还没有管理员直接授权。"
            : "还没有创建激活码。";
      elements.licenseItems.append(empty);
      updateSelectionState();
      return;
    }
    const statusLabels = { active: "使用中", expired: "已过期", revoked: "已撤销", unused: "未使用" };
    for (const license of filteredLicenses) {
      const isTrial = license.source === "email_trial";
      const isEmailLicense = isTrial || license.source === "admin_grant";
      const item = document.createElement("article");
      item.className = "admin-license-item";
      item.dataset.source = license.source;

      let selection;
      if (isEmailLicense) {
        selection = document.createElement("span");
        selection.className = "admin-trial-marker";
        selection.setAttribute("aria-hidden", "true");
        selection.textContent = "T";
      } else {
        selection = document.createElement("input");
        selection.className = "admin-license-select";
        selection.type = "checkbox";
        selection.checked = selectedLicenseIds.has(license.id);
        selection.setAttribute("aria-label", `选择激活码 ${license.codeHashPrefix}`);
        selection.addEventListener("change", () => {
          if (selection.checked) selectedLicenseIds.add(license.id);
          else selectedLicenseIds.delete(license.id);
          updateSelectionState();
        });
      }

      const header = document.createElement("header");
      const code = document.createElement("strong");
      code.textContent = isEmailLicense
        ? license.accountEmail || (isTrial ? "邮箱试用" : "管理员授权")
        : license.code || `旧码不可恢复 · ${license.codeHashPrefix}…`;
      code.title = isEmailLicense
        ? isTrial
          ? "该邮箱已领取试用"
          : "管理员为该邮箱授予的 Pro"
        : license.code || "该激活码创建于加密存储上线之前，无法从哈希恢复原文。";
      const identity = document.createElement("small");
      identity.textContent = isEmailLicense ? `${isTrial ? "TRIAL" : "GRANT"} · ${license.id}` : license.id;
      header.append(code, identity);

      const state = document.createElement("span");
      state.className = "admin-license-state";
      const displayStatus = license.status;
      state.dataset.state = displayStatus;
      state.textContent = statusLabels[displayStatus] || displayStatus;

      const copyButton = document.createElement("button");
      copyButton.className = "admin-license-copy";
      copyButton.type = "button";
      copyButton.textContent = "复制";
      copyButton.disabled = !license.code;
      copyButton.title = license.code ? "复制完整激活码" : "旧激活码没有可恢复的原文";
      copyButton.addEventListener("click", () => void copyText(license.code, elements.bulkStatus));
      const bindButton = document.createElement("button");
      bindButton.className = "admin-license-copy";
      bindButton.type = "button";
      bindButton.textContent = license.accountEmail ? "改绑" : "绑定邮箱";
      bindButton.addEventListener("click", async () => {
        const nextEmail = window.prompt("输入目标邮箱；留空将解除当前绑定。", license.accountEmail || "");
        if (
          nextEmail === null ||
          nextEmail.trim().toLowerCase() === String(license.accountEmail || "").toLowerCase()
        )
          return;
        const action = nextEmail.trim() ? `改绑至 ${nextEmail.trim()}` : "解除邮箱绑定";
        if (!window.confirm(`确定${action}吗？该操作会写入授权审计记录。`)) return;
        try {
          await requestJson("/api/admin/licenses/account", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              licenseId: license.id,
              accountEmail: nextEmail.trim(),
              accountId: nextEmail.trim() ? undefined : null,
              previousAccountId: license.accountId || null,
            }),
          });
          setStatus(elements.bulkStatus, "激活码邮箱绑定已更新。", "success");
          await loadLicenses();
        } catch (error) {
          setStatus(elements.bulkStatus, error.message, "error");
        }
      });

      const meta = document.createElement("div");
      meta.className = "admin-license-meta";
      const duration = document.createElement("span");
      duration.textContent = license.permanent
        ? "授权周期 · 永久"
        : `${isTrial ? "试用周期" : "激活后"} · ${license.durationDays} 天`;
      const redeemBy = document.createElement("span");
      redeemBy.textContent = isEmailLicense
        ? `${isTrial ? "领取时间" : "授予时间"} · ${formatDate(license.activatedAt)}`
        : `兑换截止 · ${formatRedeemBy(license.redeemBy)}`;
      const expiry = document.createElement("span");
      expiry.textContent = license.permanent
        ? "实际到期 · 永久"
        : license.expiresAt
          ? `实际到期 · ${formatDate(license.expiresAt)}`
          : "实际到期 · 激活后计算";
      const account = document.createElement("span");
      account.textContent = license.accountEmail
        ? `绑定邮箱 · ${license.accountEmail}`
        : "绑定邮箱 · 尚未兑换";
      meta.append(duration, redeemBy, expiry, account);
      const actions = document.createElement("div");
      actions.className = "admin-license-actions";
      actions.append(state);
      if (!isEmailLicense) {
        actions.append(copyButton, bindButton);
      }
      item.append(selection, header, actions, meta);
      elements.licenseItems.append(item);
    }
    updateSelectionState();
  }

  /** @returns {Promise<void>} */
  async function loadLicenses() {
    setBusy(elements.refreshButton, true);
    try {
      const payload = await requestJson("/api/admin/licenses");
      renderLicenses(Array.isArray(payload.licenses) ? payload.licenses : []);
    } catch (error) {
      if (error.status === 401) {
        showAuthenticatedView(false);
        setStatus(elements.loginStatus, "管理会话已过期，请重新验证。", "error");
        return;
      }
      elements.licenseItems.replaceChildren();
      const message = document.createElement("p");
      message.className = "admin-license-empty";
      message.textContent = error.message;
      elements.licenseItems.append(message);
    } finally {
      setBusy(elements.refreshButton, false);
    }
  }

  /** @param {object[]} accounts Email account summaries. @returns {void} */
  function renderAccounts(accounts) {
    elements.accountItems.replaceChildren();
    if (!accounts.length) {
      const empty = document.createElement("p");
      empty.className = "admin-license-empty";
      empty.textContent = "暂无匹配的邮箱账户。";
      elements.accountItems.append(empty);
      return;
    }
    for (const account of accounts) {
      const item = document.createElement("article");
      item.className = "admin-account-item";
      const summary = document.createElement("div");
      const email = document.createElement("strong");
      email.textContent = account.email;
      const metadata = document.createElement("small");
      metadata.textContent = `最后登录 ${formatDate(account.last_login_at)} · 激活码 ${Number(account.license_count || 0)} 个`;
      summary.append(email, metadata);
      const actions = document.createElement("div");
      actions.className = "admin-account-actions";
      const override = document.createElement("select");
      for (const [value, label] of [
        ["inherit", "跟随全局"],
        ["enabled", "开启 Pro"],
        ["disabled", "关闭 Pro"],
      ]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = account.pro_override === value;
        override.append(option);
      }
      const save = document.createElement("button");
      save.type = "button";
      save.textContent = "保存";
      save.addEventListener("click", async () => {
        setBusy(save, true);
        try {
          await requestJson("/api/admin/accounts/authorization", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accountId: account.id, proOverride: override.value }),
          });
          setStatus(elements.accountStatus, `${account.email} 的 Pro 权限已更新。`, "success");
          await loadAccounts();
        } catch (error) {
          setStatus(elements.accountStatus, error.message, "error");
        } finally {
          setBusy(save, false);
        }
      });
      const forceLogout = document.createElement("button");
      forceLogout.type = "button";
      forceLogout.textContent = "强制退出";
      forceLogout.addEventListener("click", async () => {
        if (!window.confirm(`确定让 ${account.email} 的所有浏览器退出登录吗？`)) return;
        try {
          await requestJson("/api/admin/accounts/authorization", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accountId: account.id, proOverride: override.value, forceLogout: true }),
          });
          setStatus(elements.accountStatus, "该账户的全部会话已撤销。", "success");
        } catch (error) {
          setStatus(elements.accountStatus, error.message, "error");
        }
      });
      actions.append(override, save, forceLogout);
      item.append(summary, actions);
      elements.accountItems.append(item);
    }
  }

  /** @returns {Promise<void>} */
  async function loadAccounts() {
    setBusy(elements.accountRefresh, true);
    try {
      const query = encodeURIComponent(elements.accountSearch.value.trim());
      const payload = await requestJson(`/api/admin/accounts?q=${query}`);
      elements.defaultProEnabled.checked = Boolean(payload.defaultProEnabled);
      const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
      elements.accountCount.textContent = String(accounts.length);
      elements.trialCount.textContent = payload.defaultProEnabled ? "开启" : "关闭";
      renderAccounts(accounts);
    } catch (error) {
      if (error.status === 401) showAuthenticatedView(false);
      setStatus(elements.accountStatus, error.message, "error");
    } finally {
      setBusy(elements.accountRefresh, false);
    }
  }

  /** @returns {Promise<void>} */
  async function loadSession() {
    setStatus(elements.loginStatus, "正在检查管理会话…");
    try {
      const session = await requestJson("/api/admin/session");
      periodSeconds = Number(session.periodSeconds || 30);
      if (!session.configured) {
        showAuthenticatedView(false);
        elements.loginButton.disabled = true;
        setStatus(elements.loginStatus, "管理员验证尚未配置，请先设置服务端环境变量。", "error");
        return;
      }
      elements.loginButton.disabled = false;
      showAuthenticatedView(Boolean(session.authenticated));
      setStatus(elements.loginStatus, "");
      if (session.authenticated) {
        elements.sessionExpiry.textContent = `${session.username} · 会话有效至 ${formatDate(session.sessionExpiresAt)}`;
        await Promise.all([loadLicenses(), loadAccounts()]);
      }
    } catch (error) {
      showAuthenticatedView(false);
      setStatus(elements.loginStatus, error.message, "error");
    }
  }

  /** @param {string} method Mutation method. @param {string} path API path. @param {object} body JSON payload. @param {string} successMessage Success text. @returns {Promise<void>} */
  async function mutateSelected(method, path, body, successMessage) {
    const ids = [...selectedLicenseIds];
    if (!ids.length) {
      setStatus(elements.bulkStatus, "请先选择至少一个激活码。", "error");
      return;
    }
    setStatus(elements.bulkStatus, "正在处理…");
    try {
      const result = await requestJson(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, ...body }),
      });
      selectedLicenseIds.clear();
      setStatus(elements.bulkStatus, `${successMessage}，共 ${result.count} 个。`, "success");
      await Promise.all([loadLicenses(), loadAccounts()]);
    } catch (error) {
      if (error.status === 401) showAuthenticatedView(false);
      setStatus(elements.bulkStatus, error.message, "error");
    }
  }

  elements.redeemBy.value ||= PERMANENT_LOCAL_DATE;
  elements.bulkRedeemBy.value ||= PERMANENT_LOCAL_DATE;
  elements.licenseSearch.value = new URLSearchParams(window.location.search).get("q") || "";
  updateCreationPreview();
  startCountdown();
  void loadSession();

  let adminChallengeToken = "";

  elements.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = elements.username.value.trim();
    const password = elements.password.value;
    const code = elements.totpCode.value.replace(/\D/gu, "");
    if (!/^[A-Za-z0-9._-]{1,64}$/u.test(username)) {
      setStatus(elements.loginStatus, "请输入有效的用户名。", "error");
      elements.username.focus();
      return;
    }
    if (adminChallengeToken && code.length !== 6) {
      setStatus(elements.loginStatus, "请输入 6 位数字验证码。", "error");
      return;
    }
    if (password.length < 8) {
      setStatus(elements.loginStatus, "请输入管理员密码。", "error");
      elements.password.focus();
      return;
    }
    setBusy(elements.loginButton, true);
    setStatus(elements.loginStatus, "正在验证…");
    try {
      if (!adminChallengeToken) {
        const challenge = await requestJson("/api/admin/login/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        adminChallengeToken = challenge.challengeToken;
        elements.username.disabled = true;
        elements.password.disabled = true;
        elements.totpStep.hidden = false;
        elements.totpCode.required = true;
        elements.loginButton.firstChild.textContent = "验证并进入 ";
        setStatus(elements.loginStatus, "密码正确，请输入管理员动态验证码。", "success");
        elements.totpCode.focus();
        return;
      }
      const result = await requestJson("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeToken: adminChallengeToken, code }),
      });
      adminChallengeToken = "";
      elements.password.value = "";
      elements.totpCode.value = "";
      elements.sessionExpiry.textContent = `${result.username} · 会话有效至 ${formatDate(result.expiresAt)}`;
      showAuthenticatedView(true);
      await loadLicenses();
      if (window.location.pathname === "/admin/login") {
        window.location.replace("/admin/licenses");
      }
    } catch (error) {
      elements.password.value = "";
      setStatus(elements.loginStatus, error.message, "error");
      elements.totpCode.select();
    } finally {
      setBusy(elements.loginButton, false);
    }
  });

  elements.totpCode.addEventListener("input", () => {
    elements.totpCode.value = elements.totpCode.value.replace(/\D/gu, "").slice(0, 6);
  });
  elements.generateButton.addEventListener("click", () => {
    elements.activationCode.value = generateActivationCode();
    elements.activationCode.focus();
    elements.activationCode.select();
  });
  elements.permanentRedeemButton.addEventListener("click", () => {
    elements.redeemBy.value = PERMANENT_LOCAL_DATE;
  });
  elements.permanentDurationButton.addEventListener("click", () => {
    setPermanentDuration(
      elements.durationDays,
      elements.permanentDurationButton,
      !isPermanentDuration(elements.permanentDurationButton),
    );
    updateCreationPreview();
  });
  elements.bulkPermanentButton.addEventListener("click", () => {
    setPermanentDuration(
      elements.bulkDurationDays,
      elements.bulkPermanentButton,
      !isPermanentDuration(elements.bulkPermanentButton),
    );
  });
  elements.durationDays.addEventListener("input", updateCreationPreview);
  elements.batchCount.addEventListener("input", updateCreationPreview);

  elements.licenseForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const batchCount = Number(elements.batchCount.value);
    if (!Number.isInteger(batchCount) || batchCount < 1 || batchCount > 100) {
      setStatus(elements.licenseStatus, "创建数量必须在 1–100 之间。", "error");
      return;
    }
    const codes = Array.from({ length: batchCount }, generateActivationCode);
    if (batchCount === 1 && elements.activationCode.value.trim()) codes[0] = elements.activationCode.value;
    setBusy(elements.createButton, true);
    setStatus(elements.licenseStatus, `正在创建 ${batchCount} 个激活码…`);
    try {
      const result = await requestJson("/api/admin/licenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codes,
          durationDays: Number(elements.durationDays.value),
          permanent: isPermanentDuration(elements.permanentDurationButton),
          redeemBy: localDateToIso(elements.redeemBy.value),
        }),
      });
      elements.createdCodesText.value = result.codes.join("\n");
      elements.createdCodes.hidden = false;
      elements.activationCode.value = "";
      setStatus(elements.licenseStatus, `已创建 ${result.codes.length} 个，并已加密保存。`, "success");
      await loadLicenses();
    } catch (error) {
      if (error.status === 401) showAuthenticatedView(false);
      setStatus(elements.licenseStatus, error.message, "error");
    } finally {
      setBusy(elements.createButton, false);
    }
  });

  elements.copyCodesButton.addEventListener(
    "click",
    () => void copyText(elements.createdCodesText.value, elements.licenseStatus),
  );

  elements.selectAll.addEventListener("change", () => {
    for (const license of visibleLicenses().items) {
      if (elements.selectAll.checked) selectedLicenseIds.add(license.id);
      else selectedLicenseIds.delete(license.id);
    }
    renderLicenses(licenses);
  });
  elements.copySelectedButton.addEventListener("click", () => {
    const codes = licenses
      .filter((license) => selectedLicenseIds.has(license.id) && license.code)
      .map((license) => license.code);
    void copyText(codes.join("\n"), elements.bulkStatus);
  });
  elements.copyAllButton.addEventListener("click", () => {
    const codes = matchingLicenses()
      .filter((license) => license.code)
      .map((license) => license.code);
    void copyText(codes.join("\n"), elements.bulkStatus);
  });
  elements.licenseSearch.addEventListener("input", () => {
    licensePage = 1;
    syncListUrl();
    renderLicenses(licenses);
  });
  elements.licenseSort.addEventListener("change", () => {
    licensePage = 1;
    renderLicenses(licenses);
  });
  elements.licensePageSize.addEventListener("change", () => {
    licensePage = 1;
    renderLicenses(licenses);
  });
  elements.licensePreviousPage.addEventListener("click", () => {
    licensePage -= 1;
    renderLicenses(licenses);
  });
  elements.licenseNextPage.addEventListener("click", () => {
    licensePage += 1;
    renderLicenses(licenses);
  });
  for (const tab of elements.sourceTabs) {
    tab.addEventListener("click", () => {
      activeSourceFilter = tab.dataset.sourceFilter;
      licensePage = 1;
      syncListUrl();
      renderLicenses(licenses);
    });
  }
  elements.bulkApplyButton.addEventListener(
    "click",
    () =>
      void mutateSelected(
        "PATCH",
        "/api/admin/licenses",
        {
          durationDays: Number(elements.bulkDurationDays.value),
          permanent: isPermanentDuration(elements.bulkPermanentButton),
          redeemBy: localDateToIso(elements.bulkRedeemBy.value),
        },
        "设置已更新",
      ),
  );
  elements.bulkRevokeButton.addEventListener(
    "click",
    () => void mutateSelected("PATCH", "/api/admin/licenses/revocation", { revoked: true }, "激活码已撤销"),
  );
  elements.bulkRestoreButton.addEventListener(
    "click",
    () => void mutateSelected("PATCH", "/api/admin/licenses/revocation", { revoked: false }, "激活码已恢复"),
  );
  elements.bulkDeleteButton.addEventListener("click", () => {
    if (!selectedLicenseIds.size) {
      setStatus(elements.bulkStatus, "请先选择至少一个激活码。", "error");
      return;
    }
    if (!window.confirm(`确定永久删除选中的 ${selectedLicenseIds.size} 个激活码吗？此操作不可恢复。`)) return;
    void mutateSelected("DELETE", "/api/admin/licenses", {}, "激活码已删除");
  });

  elements.refreshButton.addEventListener("click", () => void loadLicenses());
  elements.accountRefresh.addEventListener("click", () => void loadAccounts());
  elements.accountSearch.addEventListener("search", () => void loadAccounts());
  elements.defaultProEnabled.addEventListener("change", async () => {
    try {
      const payload = await requestJson("/api/admin/settings/authorization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultProEnabled: elements.defaultProEnabled.checked }),
      });
      elements.defaultProEnabled.checked = Boolean(payload.defaultProEnabled);
      setStatus(elements.accountStatus, "新账户默认 Pro 设置已更新。", "success");
    } catch (error) {
      elements.defaultProEnabled.checked = !elements.defaultProEnabled.checked;
      setStatus(elements.accountStatus, error.message, "error");
    }
  });
  elements.logoutButton.addEventListener("click", async () => {
    setBusy(elements.logoutButton, true);
    let logoutError = null;
    try {
      await requestJson("/api/admin/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } catch (error) {
      logoutError = error;
    } finally {
      showAuthenticatedView(false);
      setBusy(elements.logoutButton, false);
      setStatus(
        elements.loginStatus,
        logoutError ? `本地管理台已锁定，但服务端退出失败：${logoutError.message}` : "已退出管理会话。",
        logoutError ? "error" : "",
      );
    }
  });

  updateCreationPreview();
  updateSelectionState();
})();
