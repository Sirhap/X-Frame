"use strict";

(function attachXFrameFactoryAccount(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameFactoryAccount = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the landing-page account controller.
   * @param {{documentRef?:Document,windowRef?:Window,fetchImpl?:typeof fetch}} [dependencies] Runtime dependencies.
   * @returns {{bind:()=>void,openDialog:()=>Promise<void>,refreshSession:()=>Promise<object>,render:(session:object)=>void}|null} Account controller.
   */
  const ACCOUNT_COPY = {
    zh: {
      signIn: "登录 / 注册",
      signInAria: "登录或注册",
      account: "账户与授权",
      signedInFallback: "已登录账户",
      entitlementOn: "Pro 权限已开启",
      entitlementOff: "当前为基础账户",
      networkError: "网络连接失败，请稍后重试。",
      serviceUnavailable: "账户服务暂时不可用。",
      checkingSession: "正在检查登录状态…",
      checkingCredentials: "正在检查账号和密码…",
      verifying: "正在验证…",
      adminCode: "管理员动态验证码",
      emailCode: "邮箱验证码",
      adminCodeHint: "管理员密码正确，请输入动态验证码。",
      registerHint: "请查收邮箱验证码，验证后完成注册。",
      passwordSetupHint: "请查收邮箱验证码，验证后设置账户密码。",
      emailCodeHint: "密码正确，请输入邮箱验证码。",
      signedIn: "登录成功。",
      signedOut: "已退出登录。",
    },
    en: {
      signIn: "Sign in / Register",
      signInAria: "Sign in or register",
      account: "Account and license",
      signedInFallback: "Signed-in account",
      entitlementOn: "Pro access is on",
      entitlementOff: "This is a basic account",
      networkError: "Network connection failed. Try again later.",
      serviceUnavailable: "The account service is temporarily unavailable.",
      checkingSession: "Checking sign-in status…",
      checkingCredentials: "Checking account and password…",
      verifying: "Verifying…",
      adminCode: "Administrator authenticator code",
      emailCode: "Email verification code",
      adminCodeHint: "Administrator password accepted. Enter the authenticator code.",
      registerHint: "Check your email for the code, then finish registration.",
      passwordSetupHint: "Check your email for the code, then set your password.",
      emailCodeHint: "Password accepted. Enter the email verification code.",
      signedIn: "Signed in.",
      signedOut: "Signed out.",
    },
  };

  function createController(dependencies = {}) {
    const documentRef = dependencies.documentRef || root?.document;
    const windowRef = dependencies.windowRef || root?.window || root;
    const fetchImpl = dependencies.fetchImpl || root?.fetch;
    const storage = dependencies.storage || windowRef?.localStorage;

    /** @returns {"zh"|"en"} Active factory language. */
    function readLanguage() {
      try {
        return storage?.getItem("xsxbFrameTuner.languageExplicit") === "true" &&
          storage?.getItem("xsxbFrameTuner.language") === "en"
          ? "en"
          : "zh";
      } catch (_error) {
        return "zh";
      }
    }

    /** @param {string} key Copy key. @returns {string} Localized copy. */
    function text(key) {
      const language = readLanguage();
      return ACCOUNT_COPY[language]?.[key] || ACCOUNT_COPY.zh[key] || key;
    }
    const elements = {
      dialog: documentRef?.querySelector?.("#factoryAccountDialog"),
      closeButton: documentRef?.querySelector?.("#factoryAccountClose"),
      form: documentRef?.querySelector?.("#factoryAccountForm"),
      email: documentRef?.querySelector?.("#factoryAccountEmail"),
      password: documentRef?.querySelector?.("#factoryAccountPassword"),
      code: documentRef?.querySelector?.("#factoryAccountCode"),
      credentials: documentRef?.querySelector?.("#factoryAccountCredentials"),
      challenge: documentRef?.querySelector?.("#factoryAccountChallenge"),
      continueButton: documentRef?.querySelector?.("#factoryAccountContinue"),
      backButton: documentRef?.querySelector?.("#factoryAccountBack"),
      verifyButton: documentRef?.querySelector?.("#factoryAccountVerify"),
      summary: documentRef?.querySelector?.("#factoryAccountSummary"),
      identity: documentRef?.querySelector?.("#factoryAccountIdentity"),
      entitlement: documentRef?.querySelector?.("#factoryAccountEntitlement"),
      plan: documentRef?.querySelector?.("#factoryAccountPlan"),
      actions: documentRef?.querySelector?.("#factoryAccountActions"),
      logoutButton: documentRef?.querySelector?.("#factoryAccountLogout"),
      status: documentRef?.querySelector?.("#factoryAccountStatus"),
      codeLabel: documentRef?.querySelector?.("#factoryAccountCodeLabel"),
      openButtons: Array.from(documentRef?.querySelectorAll?.("[data-account-open]") || []),
      accountLabels: Array.from(documentRef?.querySelectorAll?.("[data-account-label]") || []),
      administratorLinks: Array.from(
        documentRef?.querySelectorAll?.("[data-administrator-console-link]") || [],
      ),
    };
    if (
      !documentRef?.addEventListener ||
      typeof fetchImpl !== "function" ||
      !elements.dialog ||
      !elements.form ||
      !elements.openButtons.length
    ) {
      return null;
    }

    let bound = false;
    let returnFocus = null;
    let challengeToken = "";
    let challengeType = "";

    /** @param {string} message Status message. @param {string} [tone] Status tone. @returns {void} */
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
        throw new Error(text("networkError"), { cause: error });
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload.error || text("serviceUnavailable")));
      return payload;
    }

    /** @param {object} session Current account session. @returns {void} */
    function render(session) {
      const authenticated = Boolean(session?.authenticated);
      const accountLabel = authenticated ? text("account") : text("signIn");
      const accountAriaLabel = authenticated ? text("account") : text("signInAria");
      for (const label of elements.accountLabels) label.textContent = accountLabel;
      for (const button of elements.openButtons) button.setAttribute("aria-label", accountAriaLabel);
      for (const link of elements.administratorLinks) link.hidden = !Boolean(session?.administrator);

      elements.form.hidden = authenticated;
      elements.summary.hidden = !authenticated;
      elements.actions.hidden = !authenticated;
      if (!authenticated) return;
      elements.identity.textContent = session.identityLabel || session.email || text("signedInFallback");
      elements.plan.textContent = session.administrator
        ? "ADMINISTRATOR / PRO"
        : session.proEnabled
          ? "PRO ACCOUNT"
          : "ACCOUNT";
      elements.entitlement.textContent = session.proEnabled ? text("entitlementOn") : text("entitlementOff");
    }

    /**
     * Refreshes the browser session and every account entry point.
     * @param {{silent?:boolean}} [options] Whether to suppress a refresh failure in the dialog status.
     * @returns {Promise<object>} Current or signed-out session.
     */
    async function refreshSession(options = {}) {
      try {
        const session = await requestJson("/api/auth/session");
        render(session);
        return session;
      } catch (_error) {
        const signedOut = { authenticated: false };
        render(signedOut);
        if (!options.silent) setStatus(text("networkError"), "error");
        return signedOut;
      }
    }

    /** @returns {Promise<void>} Opens and refreshes the account dialog. */
    async function openDialog() {
      returnFocus = documentRef.activeElement;
      elements.dialog.hidden = false;
      documentRef.body.style.overflow = "hidden";
      setStatus(text("checkingSession"));
      const session = await refreshSession();
      if (session.authenticated) {
        setStatus("");
        windowRef.setTimeout?.(() => elements.closeButton.focus(), 0);
        return;
      }
      if (elements.status.dataset.tone !== "error") setStatus("");
      windowRef.setTimeout?.(() => elements.email.focus(), 0);
    }

    /** @returns {void} Closes the account dialog. */
    function closeDialog() {
      elements.dialog.hidden = true;
      documentRef.body.style.overflow = "";
      returnFocus?.focus?.();
    }

    /** @param {SubmitEvent} event Account form event. @returns {Promise<void>} */
    async function submitAccountForm(event) {
      event.preventDefault();
      const verifying = Boolean(challengeToken);
      const activeButton = verifying ? elements.verifyButton : elements.continueButton;
      activeButton.disabled = true;
      setStatus(verifying ? text("verifying") : text("checkingCredentials"));
      try {
        if (!verifying) {
          const result = await requestJson("/api/auth/password/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifier: elements.email.value, password: elements.password.value }),
          });
          challengeToken = result.challengeToken;
          challengeType = result.challengeType;
          elements.credentials.hidden = true;
          elements.challenge.hidden = false;
          elements.code.required = true;
          elements.codeLabel.textContent =
            challengeType === "admin_totp" ? text("adminCode") : text("emailCode");
          setStatus(
            challengeType === "admin_totp"
              ? text("adminCodeHint")
              : result.registration
                ? text("registerHint")
                : result.passwordSetup
                  ? text("passwordSetupHint")
                  : text("emailCodeHint"),
            "success",
          );
          elements.code.focus();
          return;
        }
        const session = await requestJson("/api/auth/challenge/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ challengeToken, challengeType, code: elements.code.value }),
        });
        elements.code.value = "";
        elements.password.value = "";
        challengeToken = "";
        challengeType = "";
        render(session);
        setStatus(text("signedIn"), "success");
      } catch (error) {
        setStatus(error.message, "error");
        elements.code.select();
      } finally {
        activeButton.disabled = false;
      }
    }

    /** @returns {void} Returns from verification to the credential step. */
    function returnToCredentials() {
      challengeToken = "";
      challengeType = "";
      elements.code.value = "";
      elements.code.required = false;
      elements.challenge.hidden = true;
      elements.credentials.hidden = false;
      elements.password.value = "";
      elements.email.focus();
      setStatus("");
    }

    /** @returns {Promise<void>} Clears the session and synchronizes the landing page. */
    async function logout() {
      elements.logoutButton.disabled = true;
      try {
        await requestJson("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        render({ authenticated: false });
        setStatus(text("signedOut"), "success");
        elements.email.focus();
      } catch (error) {
        setStatus(error.message, "error");
      } finally {
        elements.logoutButton.disabled = false;
      }
    }

    /** @returns {void} Binds page controls and checks the persisted session once. */
    function bind() {
      if (bound) return;
      bound = true;
      for (const button of elements.openButtons) button.addEventListener("click", () => void openDialog());
      elements.closeButton.addEventListener("click", closeDialog);
      elements.dialog.addEventListener("click", (event) => {
        if (event.target === elements.dialog) closeDialog();
      });
      documentRef.addEventListener("keydown", (event) => {
        if (!elements.dialog.hidden && event.key === "Escape") closeDialog();
      });
      elements.form.addEventListener("submit", (event) => void submitAccountForm(event));
      elements.backButton.addEventListener("click", returnToCredentials);
      elements.logoutButton.addEventListener("click", () => void logout());
      void refreshSession({ silent: true });
    }

    return Object.freeze({ bind, openDialog, refreshSession, render });
  }

  return Object.freeze({ createController });
});

const factoryAccountController = globalThis.XFrameFactoryAccount?.createController();
factoryAccountController?.bind();
