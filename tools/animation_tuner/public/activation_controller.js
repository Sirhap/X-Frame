(function attachXFrameActivation(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameActivation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the email account and Pro entitlement controller.
   * @param {{documentRef?:Document,windowRef?:Window,fetchImpl?:typeof fetch,getLanguage?:()=>string,premiumFeatures?:object}} dependencies Runtime dependencies.
   * @returns {object} Account authorization controller.
   */
  function createController(dependencies = {}) {
    const documentRef = dependencies.documentRef || root?.document;
    const windowRef = dependencies.windowRef || root?.window || root;
    const fetchImpl = dependencies.fetchImpl || root?.fetch;
    const premiumFeatures = dependencies.premiumFeatures || root?.XFramePremiumFeatures;
    const getLanguage = dependencies.getLanguage || (() => "zh");
    const elements = {
      panel: documentRef?.querySelector?.("#activationPanel"),
      title: documentRef?.querySelector?.("#activationTitle"),
      message: documentRef?.querySelector?.("#activationMessage"),
      overview: documentRef?.querySelector?.("#activationOverview"),
      planBadge: documentRef?.querySelector?.("#activationPlanBadge"),
      remaining: documentRef?.querySelector?.("#activationRemaining"),
      progress: documentRef?.querySelector?.("#activationProgress"),
      current: documentRef?.querySelector?.("#activationCurrent"),
      features: documentRef?.querySelector?.("#activationFeatures"),
      loginForm: documentRef?.querySelector?.("#accountLoginForm"),
      email: documentRef?.querySelector?.("#accountEmail"),
      password: documentRef?.querySelector?.("#accountPassword"),
      credentialStep: documentRef?.querySelector?.("#accountCredentialStep"),
      challengeStep: documentRef?.querySelector?.("#accountChallengeStep"),
      verificationCode: documentRef?.querySelector?.("#accountVerificationCode"),
      login: documentRef?.querySelector?.("#accountLogin"),
      verify: documentRef?.querySelector?.("#accountVerify"),
      challengeBack: documentRef?.querySelector?.("#accountChallengeBack"),
      activationForm: documentRef?.querySelector?.("#activationForm"),
      activationCode: documentRef?.querySelector?.("#activationCode"),
      activationSubmit: documentRef?.querySelector?.("#activationSubmit"),
      trial: documentRef?.querySelector?.("#activationTrial"),
      logout: documentRef?.querySelector?.("#accountLogout"),
      status: documentRef?.querySelector?.("#activationStatus"),
      cancel: documentRef?.querySelector?.("#activationCancel"),
      manage: documentRef?.querySelector?.("#activationManage"),
      manageLabel: documentRef?.querySelector?.("#activationManageLabel"),
      manageStatus: documentRef?.querySelector?.("#activationManageStatus"),
      administratorConsoleLink: documentRef?.querySelector?.("#administratorConsoleLink"),
    };
    if (
      !documentRef?.createElement ||
      typeof fetchImpl !== "function" ||
      !premiumFeatures?.describeFeatures
    ) {
      throw new TypeError("XSXB account authorization dependencies are required.");
    }
    if (Object.entries(elements).some(([name, element]) => name !== "trial" && !element)) {
      throw new TypeError("XSXB account authorization elements are required.");
    }

    let accountStatus = { authenticated: false, configured: false, proEnabled: false };
    let pendingResolver = null;
    let returnFocus = null;
    let challengeToken = "";
    let challengeType = "";

    /** @returns {boolean} Whether English is active. */
    function isEnglish() {
      return getLanguage() === "en";
    }

    /** @param {string} message Status message. @param {string} [tone] Tone. @returns {void} */
    function setStatus(message, tone = "") {
      elements.status.textContent = message;
      if (tone) elements.status.dataset.tone = tone;
      else delete elements.status.dataset.tone;
    }

    /** @param {string} path API path. @param {RequestInit} [options] Request options. @returns {Promise<object>} JSON. */
    async function requestJson(path, options = {}) {
      let response;
      try {
        response = await fetchImpl(path, { credentials: "same-origin", ...options });
      } catch (error) {
        throw new Error(isEnglish() ? "Network connection failed." : "网络连接失败。", { cause: error });
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw Object.assign(new Error(String(payload.error || "请求失败。")), { status: response.status });
      return payload;
    }

    /** @returns {void} */
    function renderStatus() {
      const english = isEnglish();
      const authenticated = Boolean(accountStatus.authenticated);
      const proEnabled = authenticated && Boolean(accountStatus.proEnabled);
      elements.overview.dataset.state = proEnabled ? "licensed" : authenticated ? "inactive" : "signed-out";
      elements.planBadge.textContent = proEnabled
        ? english
          ? "PRO ENABLED"
          : "PRO 已开启"
        : authenticated
          ? english
            ? "BASIC ACCOUNT"
            : "基础账户"
          : english
            ? "EMAIL SIGN-IN"
            : "邮箱登录";
      elements.remaining.textContent = proEnabled
        ? english
          ? "Access available"
          : "授权可用"
        : english
          ? "Verification required"
          : "需要验证";
      elements.progress.style.width = proEnabled ? "100%" : "0%";
      const identityLabel = accountStatus.identityLabel || accountStatus.email || "";
      elements.current.textContent = authenticated
        ? `${identityLabel} · ${proEnabled ? (english ? "Pro access active" : "Pro 权限有效") : english ? "Pro access disabled" : "Pro 权限未开启"}`
        : english
          ? "Sign in with a verification code. This browser will be remembered for 7 days."
          : "使用邮箱验证码登录；当前浏览器将保持登录 7 天。";
      elements.loginForm.hidden = authenticated;
      elements.activationForm.hidden = !authenticated || Boolean(accountStatus.administrator);
      if (elements.trial)
        elements.trial.hidden = !authenticated || Boolean(accountStatus.administrator) || proEnabled;
      elements.logout.hidden = !authenticated;
      elements.administratorConsoleLink.hidden = !Boolean(accountStatus.administrator);
      for (const launcher of [
        { button: elements.manage, label: elements.manageLabel, status: elements.manageStatus },
      ]) {
        if (!launcher.button || !launcher.label || !launcher.status) continue;
        launcher.label.textContent = authenticated
          ? english
            ? "Account"
            : "账户与授权"
          : english
            ? "Sign in"
            : "邮箱登录";
        launcher.status.textContent = proEnabled
          ? english
            ? "Pro enabled"
            : "Pro 已开启"
          : authenticated
            ? identityLabel
            : english
              ? "7-day session"
              : "7 天会话";
      }
    }

    /** @returns {Promise<object>} Current session. */
    async function refreshStatus() {
      try {
        accountStatus = await requestJson("/api/auth/session");
      } catch (_error) {
        accountStatus = { authenticated: false, configured: false, proEnabled: false };
      }
      renderStatus();
      return accountStatus;
    }

    /** @param {string[]} featureIds Pro feature IDs. @returns {Promise<boolean>} Whether authorized. */
    async function ensureActivated(featureIds) {
      const requestedFeatureIds =
        premiumFeatures.normalizeFeatureIds?.(featureIds || []) || Array.from(featureIds || []);
      if (!requestedFeatureIds.length) return true;
      await refreshStatus();
      if (accountStatus.authenticated && accountStatus.proEnabled) return true;
      elements.features.replaceChildren();
      for (const feature of premiumFeatures.describeFeatures(requestedFeatureIds, getLanguage())) {
        const item = documentRef.createElement("li");
        item.textContent = feature.label || String(feature);
        elements.features.append(item);
      }
      elements.title.textContent = isEnglish() ? "Sign in to continue" : "登录后继续导出";
      elements.message.textContent = isEnglish()
        ? "Your edit is safe. Verify your email to continue."
        : "当前编辑不会丢失，请验证邮箱后继续。";
      openManager();
      return new Promise((resolve) => {
        pendingResolver = resolve;
      });
    }

    /** @returns {void} */
    function openManager() {
      returnFocus = documentRef.activeElement;
      elements.panel.hidden = false;
      renderStatus();
      windowRef.setTimeout?.(
        () => (accountStatus.authenticated ? elements.activationCode : elements.email).focus(),
        0,
      );
    }

    /** @param {boolean} result Pending authorization result. @returns {void} */
    function close(result) {
      elements.panel.hidden = true;
      const resolver = pendingResolver;
      pendingResolver = null;
      resolver?.(result);
      returnFocus?.focus?.();
    }

    elements.loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const verifying = Boolean(challengeToken);
      const activeButton = verifying ? elements.verify : elements.login;
      activeButton.disabled = true;
      try {
        if (!verifying) {
          const challenge = await requestJson("/api/auth/password/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier: elements.email.value, password: elements.password.value }),
          });
          challengeToken = challenge.challengeToken;
          challengeType = challenge.challengeType;
          elements.credentialStep.hidden = true;
          elements.challengeStep.hidden = false;
          elements.verificationCode.required = true;
          setStatus(
            challengeType === "admin_totp"
              ? "管理员密码正确，请输入动态验证码。"
              : challenge.registration
                ? "请查收验证码，验证后完成注册。"
                : challenge.passwordSetup
                  ? "请查收验证码，验证后设置账户密码。"
                  : "密码正确，请输入邮箱验证码。",
            "success",
          );
          elements.verificationCode.focus();
          return;
        }
        accountStatus = await requestJson("/api/auth/challenge/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ challengeToken, challengeType, code: elements.verificationCode.value }),
        });
        elements.verificationCode.value = "";
        elements.password.value = "";
        challengeToken = "";
        challengeType = "";
        renderStatus();
        setStatus(isEnglish() ? "Signed in successfully." : "邮箱登录成功。", "success");
        if (accountStatus.proEnabled && pendingResolver) close(true);
      } catch (error) {
        setStatus(error.message, "error");
      } finally {
        activeButton.disabled = false;
      }
    });

    elements.challengeBack.addEventListener("click", () => {
      challengeToken = "";
      challengeType = "";
      elements.verificationCode.value = "";
      elements.verificationCode.required = false;
      elements.challengeStep.hidden = true;
      elements.credentialStep.hidden = false;
      elements.password.value = "";
      elements.email.focus();
      setStatus("");
    });

    elements.activationForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      elements.activationSubmit.disabled = true;
      try {
        accountStatus = await requestJson("/api/entitlements/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: elements.activationCode.value }),
        });
        elements.activationCode.value = "";
        renderStatus();
        setStatus(isEnglish() ? "Activation code bound to this email." : "激活码已绑定当前邮箱。", "success");
        if (accountStatus.proEnabled && pendingResolver) close(true);
      } catch (error) {
        setStatus(error.message, "error");
      } finally {
        elements.activationSubmit.disabled = false;
      }
    });

    elements.trial?.addEventListener("click", async () => {
      elements.trial.disabled = true;
      try {
        accountStatus = await requestJson("/api/entitlements/trial", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        renderStatus();
        setStatus(isEnglish() ? "Your 3-day email trial is active." : "3 天邮箱试用已开启。", "success");
        if (pendingResolver) close(true);
      } catch (error) {
        setStatus(error.message, "error");
      } finally {
        elements.trial.disabled = false;
      }
    });

    elements.logout.addEventListener("click", async () => {
      try {
        await requestJson("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
      } finally {
        accountStatus = { authenticated: false, configured: true, proEnabled: false };
        renderStatus();
      }
    });
    elements.cancel.addEventListener("click", () => close(false));
    elements.manage.addEventListener("click", openManager);
    elements.administratorConsoleLink.addEventListener("click", () => {
      windowRef.location.assign("/admin/licenses");
    });

    return Object.freeze({
      ensureActivated,
      openManager,
      refreshStatus,
      renderStatus,
      isActivated: () => Boolean(accountStatus.authenticated && accountStatus.proEnabled),
    });
  }

  return Object.freeze({ createController });
});
