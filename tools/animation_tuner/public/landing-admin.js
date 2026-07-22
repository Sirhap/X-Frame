"use strict";

(function initializeAdminConsole() {
  const PERMANENT_LOCAL_DATE = "9999-12-31T23:59";
  const MILLISECONDS_PER_DAY = 86_400_000;
  const elements = {
    console: document.querySelector("#adminConsole"),
    loginView: document.querySelector("#adminLoginView"),
    loginForm: document.querySelector("#adminLoginForm"),
    loginButton: document.querySelector("#adminLoginButton"),
    loginStatus: document.querySelector("#adminLoginStatus"),
    username: document.querySelector("#adminUsername"),
    totpCode: document.querySelector("#adminTotpCode"),
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
    refreshButton: document.querySelector("#adminRefreshButton"),
    selectAll: document.querySelector("#adminSelectAll"),
    selectedCount: document.querySelector("#adminSelectedCount"),
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

  const selectedLicenseIds = new Set();
  let countdownTimer = 0;
  let licenses = [];
  let periodSeconds = 30;

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
      const error = new Error(payload.error || "请求失败，请稍后重试。");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  /** @param {unknown} value Date-like value. @returns {string} Local display text. */
  function formatDate(value) {
    const timestamp = Date.parse(String(value || ""));
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
    else elements.username.focus();
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
      elements.expiryPreview.textContent = "激活后永久有效，不会生成到期时间。";
      return;
    }
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) {
      elements.expiryPreview.textContent = "请输入 1–3650 之间的有效天数。";
      return;
    }
    const expectedExpiry = new Date(Date.now() + durationDays * MILLISECONDS_PER_DAY).toISOString();
    elements.expiryPreview.textContent = `若现在激活，预计到期：${formatDate(expectedExpiry)}；实际从首次激活时开始计算。`;
  }

  /** @returns {void} */
  function updateSelectionState() {
    const visibleIds = licenses.map((license) => license.id);
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
  }

  /** @param {object[]} nextLicenses License records. @returns {void} */
  function renderLicenses(nextLicenses) {
    licenses = nextLicenses;
    const visibleIds = new Set(licenses.map((license) => license.id));
    for (const id of selectedLicenseIds) {
      if (!visibleIds.has(id)) selectedLicenseIds.delete(id);
    }
    elements.licenseItems.replaceChildren();
    if (!licenses.length) {
      const empty = document.createElement("p");
      empty.className = "admin-license-empty";
      empty.textContent = "还没有激活码";
      elements.licenseItems.append(empty);
      updateSelectionState();
      return;
    }
    const statusLabels = { active: "使用中", expired: "已过期", revoked: "已撤销", unused: "未使用" };
    for (const license of licenses) {
      const item = document.createElement("article");
      item.className = "admin-license-item";

      const selection = document.createElement("input");
      selection.className = "admin-license-select";
      selection.type = "checkbox";
      selection.checked = selectedLicenseIds.has(license.id);
      selection.setAttribute("aria-label", `选择激活码 ${license.codeHashPrefix}`);
      selection.addEventListener("change", () => {
        if (selection.checked) selectedLicenseIds.add(license.id);
        else selectedLicenseIds.delete(license.id);
        updateSelectionState();
      });

      const header = document.createElement("header");
      const code = document.createElement("strong");
      code.textContent = license.code || `旧码不可恢复 · ${license.codeHashPrefix}…`;
      code.title = license.code || "该激活码创建于加密存储上线之前，无法从哈希恢复原文。";
      const identity = document.createElement("small");
      identity.textContent = license.id;
      header.append(code, identity);

      const state = document.createElement("span");
      state.className = "admin-license-state";
      state.dataset.state = license.status;
      state.textContent = statusLabels[license.status] || license.status;

      const copyButton = document.createElement("button");
      copyButton.className = "admin-license-copy";
      copyButton.type = "button";
      copyButton.textContent = "复制";
      copyButton.disabled = !license.code;
      copyButton.title = license.code ? "复制完整激活码" : "旧激活码没有可恢复的原文";
      copyButton.addEventListener("click", () => void copyText(license.code, elements.bulkStatus));

      const meta = document.createElement("div");
      meta.className = "admin-license-meta";
      const duration = document.createElement("span");
      duration.textContent = license.permanent ? "激活后 永久" : `激活后 ${license.durationDays} 天`;
      const redeemBy = document.createElement("span");
      redeemBy.textContent = `兑换截止 ${formatRedeemBy(license.redeemBy)}`;
      const expiry = document.createElement("span");
      expiry.textContent = license.permanent
        ? "实际到期 永久"
        : license.expiresAt
          ? `实际到期 ${formatDate(license.expiresAt)}`
          : "实际到期 激活后计算";
      const device = document.createElement("span");
      device.textContent = license.deviceName ? `设备 ${license.deviceName}` : "设备 未绑定";
      meta.append(duration, redeemBy, expiry, device);
      const actions = document.createElement("div");
      actions.className = "admin-license-actions";
      actions.append(state, copyButton);
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
        await loadLicenses();
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
      await loadLicenses();
    } catch (error) {
      if (error.status === 401) showAuthenticatedView(false);
      setStatus(elements.bulkStatus, error.message, "error");
    }
  }

  elements.redeemBy.value ||= PERMANENT_LOCAL_DATE;
  elements.bulkRedeemBy.value ||= PERMANENT_LOCAL_DATE;
  updateCreationPreview();
  startCountdown();
  void loadSession();

  elements.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = elements.username.value.trim();
    const code = elements.totpCode.value.replace(/\D/gu, "");
    if (!/^[A-Za-z0-9._-]{1,64}$/u.test(username)) {
      setStatus(elements.loginStatus, "请输入有效的用户名。", "error");
      elements.username.focus();
      return;
    }
    if (code.length !== 6) {
      setStatus(elements.loginStatus, "请输入 6 位数字验证码。", "error");
      return;
    }
    setBusy(elements.loginButton, true);
    setStatus(elements.loginStatus, "正在验证…");
    try {
      const result = await requestJson("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, code }),
      });
      elements.totpCode.value = "";
      elements.sessionExpiry.textContent = `${result.username} · 会话有效至 ${formatDate(result.expiresAt)}`;
      showAuthenticatedView(true);
      await loadLicenses();
    } catch (error) {
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
    for (const license of licenses) {
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
    const codes = licenses.filter((license) => license.code).map((license) => license.code);
    void copyText(codes.join("\n"), elements.bulkStatus);
  });
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
  elements.logoutButton.addEventListener("click", async () => {
    setBusy(elements.logoutButton, true);
    try {
      await requestJson("/api/admin/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } catch (error) {
      setStatus(elements.licenseStatus, error.message, "error");
    } finally {
      selectedLicenseIds.clear();
      showAuthenticatedView(false);
      setBusy(elements.logoutButton, false);
      setStatus(elements.loginStatus, "已退出管理会话。");
    }
  });

  updateCreationPreview();
  updateSelectionState();
})();
