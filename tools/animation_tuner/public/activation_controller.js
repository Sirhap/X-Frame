(function attachXsxbActivation(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBActivation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /**
   * Creates the shared premium activation flow.
   * @param {{documentRef?:Document,windowRef?:Window,fetchImpl?:typeof fetch,getLanguage?:()=>string,premiumFeatures?:object,deviceIdentity?:object}} dependencies Runtime dependencies.
   * @returns {{ensureActivated:(featureIds:string[])=>Promise<boolean>,refreshStatus:()=>Promise<object>,isActivated:()=>boolean}}
   */
  function createController(dependencies = {}) {
    const documentRef = dependencies.documentRef || root?.document;
    const windowRef = dependencies.windowRef || root?.window || root;
    const fetchImpl = dependencies.fetchImpl || root?.fetch;
    const premiumFeatures = dependencies.premiumFeatures || root?.XSXBPremiumFeatures;
    const deviceIdentity = dependencies.deviceIdentity || null;
    const getLanguage = dependencies.getLanguage || (() => "zh");
    const elements = {
      panel: documentRef?.querySelector?.("#activationPanel"),
      card: documentRef?.querySelector?.("#activationCard"),
      title: documentRef?.querySelector?.("#activationTitle"),
      message: documentRef?.querySelector?.("#activationMessage"),
      features: documentRef?.querySelector?.("#activationFeatures"),
      form: documentRef?.querySelector?.("#activationForm"),
      code: documentRef?.querySelector?.("#activationCode"),
      status: documentRef?.querySelector?.("#activationStatus"),
      cancel: documentRef?.querySelector?.("#activationCancel"),
      submit: documentRef?.querySelector?.("#activationSubmit"),
    };
    if (
      !documentRef?.createElement ||
      typeof fetchImpl !== "function" ||
      !premiumFeatures?.describeFeatures ||
      Object.values(elements).some((element) => !element)
    ) {
      throw new TypeError("XSXB activation dependencies are required.");
    }

    let activationStatus = { activated: false, configured: false };
    let statusLoaded = false;
    let pendingResolver = null;
    let returnFocus = null;
    let previousAppInert = false;

    /** @returns {boolean} Whether the current language is English. */
    function isEnglish() {
      return getLanguage() === "en";
    }

    /** @param {string} message Status text. @param {"idle"|"error"|"success"} tone Tone. */
    function setStatus(message, tone = "idle") {
      elements.status.textContent = String(message || "");
      elements.status.dataset.tone = tone;
    }

    /** @returns {HTMLElement[]} Visible focusable activation controls. */
    function focusableElements() {
      return Array.from(elements.panel.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        (element) => element.offsetParent !== null,
      );
    }

    /** @param {boolean} activated Resolution value. @returns {boolean} Whether a prompt closed. */
    function resolvePrompt(activated) {
      if (!pendingResolver) return false;
      const resolve = pendingResolver;
      pendingResolver = null;
      elements.panel.hidden = true;
      elements.submit.disabled = false;
      elements.code.disabled = false;
      const app = documentRef.querySelector(".app");
      if (app) app.inert = previousAppInert;
      returnFocus?.focus?.();
      returnFocus = null;
      resolve(Boolean(activated));
      return true;
    }

    /** @returns {Promise<object>} Latest activation status. */
    async function refreshStatus() {
      try {
        const response = await fetchImpl("/api/activation", { headers: { accept: "application/json" } });
        const result = await response.json().catch(() => ({}));
        activationStatus = {
          activated: Boolean(response.ok && result.activated),
          configured: Boolean(result.configured),
          expiresAt: String(result.expiresAt || ""),
        };
        if (!activationStatus.activated && activationStatus.configured && deviceIdentity?.renew) {
          try {
            const renewal = await deviceIdentity.renew();
            if (renewal?.activated) {
              activationStatus = {
                activated: true,
                configured: true,
                expiresAt: String(renewal.expiresAt || ""),
              };
            }
          } catch (_error) {
            activationStatus.activated = false;
          }
        }
        if (!activationStatus.activated && activationStatus.configured && deviceIdentity?.startTrial) {
          try {
            const trial = await deviceIdentity.startTrial();
            if (trial?.activated) {
              activationStatus = {
                activated: true,
                configured: true,
                expiresAt: String(trial.expiresAt || ""),
                plan: "trial",
              };
            }
          } catch (_error) {
            activationStatus.activated = false;
          }
        }
      } catch (_error) {
        activationStatus = { activated: false, configured: false };
      }
      statusLoaded = true;
      return activationStatus;
    }

    /** @param {string[]} featureIds Used premium feature identifiers. */
    function renderPrompt(featureIds) {
      const english = isEnglish();
      const features = premiumFeatures.describeFeatures(featureIds, english ? "en" : "zh");
      elements.title.textContent = english ? "Activate to export" : "激活后完成导出";
      elements.message.textContent = english
        ? "Your work is still here. This output uses premium capabilities; enter an activation code to continue."
        : "当前编辑不会丢失。本次产出使用了以下高级能力，输入激活码后即可继续。";
      elements.code.placeholder = english ? "Enter activation code" : "输入激活码";
      elements.cancel.textContent = english ? "Not now" : "暂不激活";
      elements.submit.textContent = english ? "Activate and continue" : "激活并继续";
      elements.features.replaceChildren();
      for (const feature of features) {
        const item = documentRef.createElement("li");
        const category = documentRef.createElement("span");
        const label = documentRef.createElement("strong");
        category.textContent = feature.category.toUpperCase();
        label.textContent = feature.label;
        item.append(category, label);
        elements.features.append(item);
      }
      setStatus(
        activationStatus.configured
          ? english
            ? "Activation is verified securely by this service."
            : "激活码将由当前服务安全校验。"
          : english
            ? "Activation verification has not been configured on this service."
            : "当前服务尚未配置激活码校验，请联系管理员。",
        activationStatus.configured ? "idle" : "error",
      );
    }

    /** @param {string[]} featureIds Used premium feature identifiers. @returns {Promise<boolean>} */
    async function ensureActivated(featureIds) {
      const normalized = premiumFeatures.normalizeFeatureIds(featureIds);
      if (!normalized.length) return true;
      if (!statusLoaded) await refreshStatus();
      if (activationStatus.activated) return true;
      if (pendingResolver) resolvePrompt(false);
      renderPrompt(normalized);
      returnFocus = documentRef.activeElement;
      const app = documentRef.querySelector(".app");
      previousAppInert = Boolean(app?.inert);
      if (app) app.inert = true;
      elements.panel.hidden = false;
      elements.code.value = "";
      windowRef.setTimeout(() => elements.code.focus(), 0);
      return new Promise((resolve) => {
        pendingResolver = resolve;
      });
    }

    elements.form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const code = elements.code.value.trim();
      if (!code) {
        setStatus(isEnglish() ? "Enter an activation code." : "请输入激活码。", "error");
        elements.code.focus();
        return;
      }
      elements.submit.disabled = true;
      elements.code.disabled = true;
      setStatus(isEnglish() ? "Verifying…" : "正在校验…");
      try {
        let result;
        if (deviceIdentity?.activate) {
          result = await deviceIdentity.activate(code);
        } else {
          const response = await fetchImpl("/api/activation", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ code }),
          });
          result = await response.json().catch(() => ({}));
          if (!response.ok || !result.activated) {
            throw new Error(result.error || (isEnglish() ? "Invalid activation code." : "激活码无效。"));
          }
        }
        if (!result?.activated) throw new Error(isEnglish() ? "Activation failed." : "激活失败。");
        activationStatus = { activated: true, configured: true, expiresAt: result.expiresAt || "" };
        statusLoaded = true;
        setStatus(isEnglish() ? "Activated. Continuing…" : "激活成功，正在继续…", "success");
        windowRef.setTimeout(() => resolvePrompt(true), 260);
      } catch (error) {
        elements.submit.disabled = false;
        elements.code.disabled = false;
        setStatus(error.message, "error");
        elements.code.focus();
      }
    });
    elements.cancel.addEventListener("click", () => resolvePrompt(false));
    elements.panel.addEventListener("click", (event) => {
      if (event.target === elements.panel) resolvePrompt(false);
    });
    documentRef.addEventListener("keydown", (event) => {
      if (elements.panel.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        resolvePrompt(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements();
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && documentRef.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && documentRef.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    return Object.freeze({
      ensureActivated,
      isActivated: () => activationStatus.activated,
      refreshStatus,
    });
  }

  return Object.freeze({ createController });
});
