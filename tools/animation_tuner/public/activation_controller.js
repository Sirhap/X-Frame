(function attachXsxbActivation(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBActivation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000;

  /**
   * Creates the shared premium activation flow.
   * @param {{documentRef?:Document,windowRef?:Window,fetchImpl?:typeof fetch,getLanguage?:()=>string,premiumFeatures?:object,deviceIdentity?:object,now?:()=>number}} dependencies Runtime dependencies.
   * @returns {{ensureActivated:(featureIds:string[])=>Promise<boolean>,openManager:()=>Promise<void>,refreshStatus:()=>Promise<object>,renderStatus:()=>void,isActivated:()=>boolean}}
   */
  function createController(dependencies = {}) {
    const documentRef = dependencies.documentRef || root?.document;
    const windowRef = dependencies.windowRef || root?.window || root;
    const fetchImpl = dependencies.fetchImpl || root?.fetch;
    const premiumFeatures = dependencies.premiumFeatures || root?.XSXBPremiumFeatures;
    const deviceIdentity = dependencies.deviceIdentity || null;
    const getLanguage = dependencies.getLanguage || (() => "zh");
    const now = dependencies.now || Date.now;
    const elements = {
      panel: documentRef?.querySelector?.("#activationPanel"),
      card: documentRef?.querySelector?.("#activationCard"),
      title: documentRef?.querySelector?.("#activationTitle"),
      message: documentRef?.querySelector?.("#activationMessage"),
      overview: documentRef?.querySelector?.("#activationOverview"),
      planBadge: documentRef?.querySelector?.("#activationPlanBadge"),
      remaining: documentRef?.querySelector?.("#activationRemaining"),
      progress: documentRef?.querySelector?.("#activationProgress"),
      current: documentRef?.querySelector?.("#activationCurrent"),
      features: documentRef?.querySelector?.("#activationFeatures"),
      form: documentRef?.querySelector?.("#activationForm"),
      code: documentRef?.querySelector?.("#activationCode"),
      status: documentRef?.querySelector?.("#activationStatus"),
      cancel: documentRef?.querySelector?.("#activationCancel"),
      submit: documentRef?.querySelector?.("#activationSubmit"),
      transfer: documentRef?.querySelector?.("#activationTransfer"),
      transferSummary: documentRef?.querySelector?.("#activationTransferSummary"),
      transferList: documentRef?.querySelector?.("#activationTransferList"),
      transferPrevious: documentRef?.querySelector?.("#activationTransferPrevious"),
      transferNext: documentRef?.querySelector?.("#activationTransferNext"),
      transferBack: documentRef?.querySelector?.("#activationTransferBack"),
      deviceActions: documentRef?.querySelector?.("#activationDeviceActions"),
      deviceActionsMessage: documentRef?.querySelector?.("#activationDeviceActionsMessage"),
      unbind: documentRef?.querySelector?.("#activationUnbind"),
      unbindConfirm: documentRef?.querySelector?.("#activationUnbindConfirm"),
      unbindTitle: documentRef?.querySelector?.("#activationUnbindTitle"),
      unbindMessage: documentRef?.querySelector?.("#activationUnbindMessage"),
      unbindCancel: documentRef?.querySelector?.("#activationUnbindCancel"),
      unbindAccept: documentRef?.querySelector?.("#activationUnbindAccept"),
      manage: documentRef?.querySelector?.("#activationManage"),
      manageLabel: documentRef?.querySelector?.("#activationManageLabel"),
      manageStatus: documentRef?.querySelector?.("#activationManageStatus"),
    };
    const organizerLauncher = {
      button: documentRef?.querySelector?.("#organizerActivationManage"),
      label: documentRef?.querySelector?.("#organizerActivationManageLabel"),
      status: documentRef?.querySelector?.("#organizerActivationManageStatus"),
    };
    if (
      !documentRef?.createElement ||
      typeof fetchImpl !== "function" ||
      !premiumFeatures?.describeFeatures ||
      Object.values(elements).some((element) => !element)
    ) {
      throw new TypeError("XSXB activation dependencies are required.");
    }

    let activationStatus = { activated: false, configured: false, deviceId: "" };
    let statusLoaded = false;
    let pendingResolver = null;
    let returnFocus = null;
    let previousAppInert = false;
    let panelMode = "prompt";
    let replacementState = null;
    let replacementChoiceButtons = [];

    /** @returns {Array<{button:HTMLElement,label:HTMLElement,status:HTMLElement}>} Available status launchers. */
    function statusLaunchers() {
      return [
        { button: elements.manage, label: elements.manageLabel, status: elements.manageStatus },
        organizerLauncher,
      ].filter((launcher) => launcher.button && launcher.label && launcher.status);
    }

    /** @returns {boolean} Whether the current language is English. */
    function isEnglish() {
      return getLanguage() === "en";
    }

    /** @param {string} message Status text. @param {"idle"|"error"|"success"} tone Tone. */
    function setStatus(message, tone = "idle") {
      elements.status.textContent = String(message || "");
      elements.status.dataset.tone = tone;
    }

    /** @param {unknown} value ISO expiry. @returns {string} Localized expiry. */
    function formatExpiry(value) {
      const timestamp = Date.parse(String(value || ""));
      if (!Number.isFinite(timestamp)) return isEnglish() ? "Unknown" : "未知";
      if (new Date(timestamp).getUTCFullYear() >= 9999) return isEnglish() ? "Never" : "永久";
      return new Intl.DateTimeFormat(isEnglish() ? "en" : "zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
        hour12: false,
      }).format(timestamp);
    }

    /** @param {unknown} value ISO device timestamp. @returns {string} Localized timestamp. */
    function formatDeviceTime(value) {
      const timestamp = Date.parse(String(value || ""));
      if (!Number.isFinite(timestamp)) return isEnglish() ? "Unknown" : "未知";
      return new Intl.DateTimeFormat(isEnglish() ? "en" : "zh-CN", {
        dateStyle: "short",
        timeStyle: "short",
        hour12: false,
      }).format(timestamp);
    }

    /** @param {unknown} value Opaque device ID. @returns {string} Stable display-safe suffix. */
    function shortDeviceId(value) {
      const deviceId = String(value || "").trim();
      return deviceId ? deviceId.slice(-8).toUpperCase() : isEnglish() ? "UNKNOWN" : "未知";
    }

    /**
     * Calculates the visible countdown state for a finite license.
     * @returns {{remainingMs:number,progress:number,urgency:"none"|"soon"|"critical",permanent:boolean}}
     */
    function expiryMetrics() {
      const timestamp = Date.parse(String(activationStatus.expiresAt || ""));
      const permanent = Number.isFinite(timestamp) && new Date(timestamp).getUTCFullYear() >= 9999;
      if (!Number.isFinite(timestamp) || permanent) {
        return { remainingMs: 0, progress: permanent ? 100 : 0, urgency: "none", permanent };
      }
      const remainingMs = Math.max(0, timestamp - now());
      const urgency =
        remainingMs <= 6 * 60 * 60 * 1000 ? "critical" : remainingMs <= 24 * 60 * 60 * 1000 ? "soon" : "none";
      return {
        remainingMs,
        progress: Math.min(100, Math.max(0, (remainingMs / TRIAL_DURATION_MS) * 100)),
        urgency,
        permanent: false,
      };
    }

    /** @param {{remainingMs:number,permanent:boolean}} metrics Countdown data. @returns {string} Localized remaining time. */
    function formatRemaining(metrics) {
      const english = isEnglish();
      if (metrics.permanent) return english ? "Never expires" : "永久有效";
      if (metrics.remainingMs <= 0) return english ? "Expired" : "已到期";
      const totalMinutes = Math.max(1, Math.ceil(metrics.remainingMs / 60000));
      const days = Math.floor(totalMinutes / 1440);
      const hours = Math.floor((totalMinutes % 1440) / 60);
      const minutes = totalMinutes % 60;
      if (days > 0) {
        return english
          ? `${days}d${hours ? ` ${hours}h` : ""} left`
          : `剩余 ${days}天${hours ? `${hours}小时` : ""}`;
      }
      if (hours > 0) return english ? `${hours}h left` : `剩余 ${hours}小时`;
      return english ? `${minutes}m left` : `剩余 ${minutes}分钟`;
    }

    /** @returns {void} */
    function renderCurrentStatus() {
      const english = isEnglish();
      const active = activationStatus.activated;
      const trial = active && activationStatus.source === "automatic_trial";
      const metrics = expiryMetrics();
      const remaining = formatRemaining(metrics);
      const state = trial ? "trial" : active ? "licensed" : "inactive";

      elements.overview.dataset.state = state;
      elements.overview.dataset.urgency = active ? metrics.urgency : "none";
      elements.planBadge.textContent = trial
        ? english
          ? "3-DAY FREE TRIAL"
          : "3 天免费试用"
        : active
          ? english
            ? "ACTIVATED"
            : "已激活"
          : english
            ? "NOT ACTIVATED"
            : "未激活";
      elements.remaining.textContent = active
        ? remaining
        : activationStatus.configured
          ? english
            ? "Activation required"
            : "需要激活"
          : english
            ? "Service unavailable"
            : "服务未配置";
      elements.progress.style.width = `${trial ? metrics.progress : 0}%`;
      elements.current.textContent = trial
        ? english
          ? `Trial ends ${formatExpiry(activationStatus.expiresAt)}. Editing remains available afterwards; exporting requires activation.`
          : `试用将在 ${formatExpiry(activationStatus.expiresAt)} 到期；到期后仍可编辑，导出需要激活码。`
        : active
          ? english
            ? `Current license is valid until ${formatExpiry(activationStatus.expiresAt)}.`
            : `当前授权有效期至 ${formatExpiry(activationStatus.expiresAt)}。`
          : english
            ? "No active license on this browser. Editing remains available; exporting requires activation."
            : "当前浏览器没有有效授权；仍可继续编辑，导出时需要激活。";
      elements.deviceActionsMessage.textContent = english
        ? `Current device ${shortDeviceId(activationStatus.deviceId)}. Unbind only this browser; other devices using the same code remain active.`
        : `当前设备 ${shortDeviceId(activationStatus.deviceId)}；仅解绑本机，其他已绑定设备不会受到影响。`;
      elements.deviceActions.hidden = !(
        active &&
        activationStatus.source === "code" &&
        panelMode === "manage" &&
        !replacementState
      );
      const launcherLabel = trial ? (english ? "3-day trial" : "3 天试用") : english ? "License" : "授权管理";
      const launcherStatus = active
        ? `${activationStatus.justStarted ? (english ? "Started · " : "已开启 · ") : ""}${remaining}`
        : activationStatus.configured
          ? english
            ? "Activate to export"
            : "激活后可导出"
          : english
            ? "Service not configured"
            : "服务未配置";
      for (const launcher of statusLaunchers()) {
        launcher.button.dataset.active = String(active);
        launcher.button.dataset.urgency = active ? metrics.urgency : "none";
        launcher.button.dataset.newTrial = String(Boolean(activationStatus.justStarted));
        launcher.label.textContent = launcherLabel;
        launcher.status.textContent = launcherStatus;
        launcher.button.title = elements.current.textContent;
        launcher.button.setAttribute("aria-label", `${launcherLabel}，${launcherStatus}`);
      }
    }

    /** @returns {HTMLElement[]} Visible focusable activation controls. */
    function focusableElements() {
      return Array.from(elements.panel.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        (element) => element.offsetParent !== null,
      );
    }

    /** @param {boolean} [focusCode] Whether to return focus to the activation-code input. */
    function resetReplacement(focusCode = false) {
      replacementState = null;
      replacementChoiceButtons = [];
      elements.transfer.hidden = true;
      elements.transferList.replaceChildren();
      elements.form.dataset.mode = "code";
      elements.code.disabled = false;
      elements.submit.disabled = false;
      elements.submit.textContent =
        panelMode === "manage"
          ? activationStatus.activated
            ? isEnglish()
              ? "Replace license"
              : "更换激活码"
            : isEnglish()
              ? "Activate"
              : "立即激活"
          : isEnglish()
            ? "Activate and continue"
            : "激活并继续";
      renderCurrentStatus();
      if (focusCode) elements.code.focus();
    }

    /** @returns {void} */
    function resetUnbindConfirmation() {
      elements.unbind.hidden = false;
      elements.unbindConfirm.hidden = true;
      elements.unbindAccept.disabled = false;
    }

    /**
     * Shows one page of user-selectable active devices.
     * @param {object} details Structured device-limit details.
     * @param {string} code Activation code retained for the confirmed retry.
     */
    function renderReplacement(details, code) {
      const devices = Array.isArray(details?.devices) ? details.devices : [];
      const total = Math.max(devices.length, Number(details?.total || 0));
      replacementState = {
        code,
        details: {
          ...details,
          offset: Math.max(0, Number(details?.offset || 0)),
          pageSize: Math.max(1, Number(details?.pageSize || devices.length || 1)),
        },
        selectedDeviceId: "",
      };
      replacementChoiceButtons = devices.map((device) => {
        const button = documentRef.createElement("button");
        const name = documentRef.createElement("strong");
        const metadata = documentRef.createElement("span");
        button.type = "button";
        button.className = "activationDeviceChoice";
        button.dataset.deviceId = String(device.id || "");
        button.dataset.selected = "false";
        button.setAttribute("role", "radio");
        button.setAttribute("aria-checked", "false");
        name.textContent = String(device.name || (isEnglish() ? "Browser device" : "浏览器设备"));
        metadata.textContent = isEnglish()
          ? `ID ${shortDeviceId(device.id)} · First bound ${formatDeviceTime(device.createdAt)} · Last used ${formatDeviceTime(device.lastSeenAt)}`
          : `设备 ${shortDeviceId(device.id)} · 首次绑定 ${formatDeviceTime(device.createdAt)} · 最后使用 ${formatDeviceTime(device.lastSeenAt)}`;
        button.append(name, metadata);
        button.addEventListener("click", () => {
          replacementState.selectedDeviceId = button.dataset.deviceId;
          for (const choice of replacementChoiceButtons) {
            const selected = choice === button;
            choice.dataset.selected = String(selected);
            choice.setAttribute("aria-checked", String(selected));
          }
          setStatus(
            isEnglish()
              ? "Confirm to unbind the selected device and bind this browser."
              : "确认后将解绑所选设备，并绑定当前浏览器。",
          );
        });
        return button;
      });
      elements.transferList.replaceChildren(...replacementChoiceButtons);
      elements.transferSummary.textContent = isEnglish()
        ? `${total} active device${total === 1 ? "" : "s"}. Select exactly one to replace.`
        : `当前共绑定 ${total} 台设备，请明确选择其中一台进行替换。`;
      elements.transferPrevious.disabled = !details?.hasPrevious;
      elements.transferNext.disabled = !details?.hasMore;
      elements.transferPrevious.textContent = isEnglish() ? "Previous" : "上一页";
      elements.transferNext.textContent = isEnglish() ? "Next" : "下一页";
      elements.transferBack.textContent = isEnglish() ? "Use another code" : "返回输入激活码";
      elements.transfer.hidden = false;
      elements.form.dataset.mode = "transfer";
      elements.code.disabled = true;
      elements.submit.disabled = false;
      elements.submit.textContent = isEnglish()
        ? "Unbind selected and use this device"
        : "解绑所选设备并绑定本机";
      elements.deviceActions.hidden = true;
      setStatus(
        devices.length
          ? isEnglish()
            ? "This code is fully used. Other devices will remain unchanged."
            : "该激活码设备名额已满；未选中的设备不会受到影响。"
          : isEnglish()
            ? "No replaceable device is available. Return and try again."
            : "当前没有可替换设备，请返回后重试。",
        devices.length ? "idle" : "error",
      );
      windowRef.setTimeout(() => replacementChoiceButtons[0]?.focus?.(), 0);
    }

    /** @param {boolean} activated Resolution value. @returns {boolean} Whether a prompt closed. */
    function resolvePrompt(activated) {
      const resolve = pendingResolver;
      pendingResolver = null;
      elements.panel.hidden = true;
      elements.submit.disabled = false;
      elements.code.disabled = false;
      resetReplacement();
      resetUnbindConfirmation();
      const app = documentRef.querySelector(".app");
      if (app) app.inert = previousAppInert;
      returnFocus?.focus?.();
      returnFocus = null;
      resolve?.(Boolean(activated));
      return true;
    }

    /** @returns {void} */
    function showPanel() {
      returnFocus = documentRef.activeElement;
      const app = documentRef.querySelector(".app");
      previousAppInert = Boolean(app?.inert);
      if (app) app.inert = true;
      resetReplacement();
      resetUnbindConfirmation();
      elements.panel.hidden = false;
      elements.code.value = "";
      windowRef.setTimeout(() => elements.code.focus(), 0);
    }

    /** @returns {Promise<object>} Latest activation status. */
    async function refreshStatus() {
      try {
        const response = await fetchImpl("/api/activation", { headers: { accept: "application/json" } });
        const result = await response.json().catch(() => ({}));
        activationStatus = {
          activated: Boolean(response.ok && result.activated),
          configured: Boolean(result.configured),
          deviceId: String(result.deviceId || ""),
          expiresAt: String(result.expiresAt || ""),
          plan: String(result.plan || ""),
          source: String(result.source || ""),
        };
        if (!activationStatus.activated && activationStatus.configured && deviceIdentity?.renew) {
          try {
            const renewal = await deviceIdentity.renew();
            if (renewal?.activated) {
              activationStatus = {
                activated: true,
                configured: true,
                deviceId: String(renewal.deviceId || ""),
                expiresAt: String(renewal.expiresAt || ""),
                plan: String(renewal.plan || ""),
                source: String(renewal.source || ""),
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
                deviceId: String(trial.deviceId || ""),
                expiresAt: String(trial.expiresAt || ""),
                plan: "trial",
                source: "automatic_trial",
                justStarted: true,
              };
            }
          } catch (_error) {
            activationStatus.activated = false;
          }
        }
      } catch (_error) {
        activationStatus = { activated: false, configured: false, deviceId: "" };
      }
      statusLoaded = true;
      renderCurrentStatus();
      return activationStatus;
    }

    /** @param {string[]} featureIds Used premium feature identifiers. */
    function renderPrompt(featureIds) {
      panelMode = "prompt";
      const english = isEnglish();
      const features = premiumFeatures.describeFeatures(featureIds, english ? "en" : "zh");
      elements.title.textContent = english ? "Activate to export" : "激活后完成导出";
      elements.message.textContent = english
        ? "Your work is still here. This output uses premium capabilities; enter an activation code to continue."
        : "当前编辑不会丢失。本次产出使用了以下高级能力，输入激活码后即可继续。";
      elements.code.placeholder = english ? "Enter activation code" : "输入激活码";
      elements.cancel.textContent = english ? "Not now" : "暂不激活";
      elements.submit.textContent = english ? "Activate and continue" : "激活并继续";
      elements.features.hidden = false;
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
      renderCurrentStatus();
    }

    /** @returns {void} Updates the license-manager explanation for the current authorization source. */
    function renderManagerMessage() {
      const english = isEnglish();
      elements.message.textContent =
        activationStatus.activated && activationStatus.source === "automatic_trial"
          ? english
            ? "Export normally during the 3-day trial. Enter an activation code at any time to switch to a full license."
            : "3 天试用期间可正常导出；随时填写激活码即可更换为正式授权。"
          : english
            ? "Enter a new activation code at any time to replace the license used by this browser."
            : "可随时输入新的激活码，更换当前浏览器正在使用的授权。";
    }

    /** @returns {Promise<void>} Opens the user-controlled license manager. */
    async function openManager() {
      if (pendingResolver) resolvePrompt(false);
      if (!statusLoaded) await refreshStatus();
      panelMode = "manage";
      const english = isEnglish();
      elements.title.textContent = english ? "License management" : "授权管理";
      renderManagerMessage();
      elements.code.placeholder = english ? "Enter a new activation code" : "输入新的激活码";
      elements.cancel.textContent = english ? "Close" : "关闭";
      elements.submit.textContent = activationStatus.activated
        ? english
          ? "Replace license"
          : "更换激活码"
        : english
          ? "Activate"
          : "立即激活";
      elements.features.replaceChildren();
      elements.features.hidden = true;
      elements.unbind.textContent = english ? "Unbind this device" : "解绑此设备";
      elements.unbindTitle.textContent = english ? "Unbind the current device?" : "确认解绑当前设备？";
      elements.unbindMessage.textContent = english
        ? "This browser loses access immediately. You can enter the code again later and select an available device slot."
        : "解绑后本机授权立即失效；之后可重新输入激活码并选择设备名额。";
      elements.unbindCancel.textContent = english ? "Cancel" : "取消";
      elements.unbindAccept.textContent = english ? "Confirm unbind" : "确认解绑";
      renderCurrentStatus();
      setStatus(
        activationStatus.configured
          ? english
            ? "Activation codes are verified securely by this service."
            : "激活码将由当前服务安全校验。"
          : english
            ? "Activation verification is not configured."
            : "当前服务尚未配置激活码校验，请联系管理员。",
        activationStatus.configured ? "idle" : "error",
      );
      showPanel();
    }

    /** @param {string[]} featureIds Used premium feature identifiers. @returns {Promise<boolean>} */
    async function ensureActivated(featureIds) {
      const normalized = premiumFeatures.normalizeFeatureIds(featureIds);
      if (!normalized.length) return true;
      if (!statusLoaded) await refreshStatus();
      if (activationStatus.activated) return true;
      if (pendingResolver) resolvePrompt(false);
      renderPrompt(normalized);
      showPanel();
      return new Promise((resolve) => {
        pendingResolver = resolve;
      });
    }

    /**
     * Activates a code through the device protocol or the bounded legacy fallback.
     * @param {string} code Activation code.
     * @param {{replaceDeviceId?:string,deviceOffset?:number}} [options] Replacement selection.
     * @returns {Promise<object>} Activation result.
     */
    async function activateCode(code, options = {}) {
      if (deviceIdentity?.activate) return deviceIdentity.activate(code, options);
      const response = await fetchImpl("/api/activation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, ...options }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.activated) {
        throw Object.assign(
          new Error(result.error || (isEnglish() ? "Invalid activation code." : "激活码无效。")),
          {
            status: response.status,
            code: String(result.code || ""),
            details: result.details && typeof result.details === "object" ? result.details : null,
          },
        );
      }
      return result;
    }

    /** @param {object} result Successful activation result. */
    function applyActivation(result) {
      const replacedDevice = Boolean(replacementState);
      activationStatus = {
        activated: true,
        configured: true,
        deviceId: String(result.deviceId || ""),
        expiresAt: String(result.expiresAt || ""),
        plan: String(result.plan || ""),
        source: String(result.source || "code"),
      };
      statusLoaded = true;
      resetReplacement();
      renderCurrentStatus();
      if (panelMode === "manage") renderManagerMessage();
      if (panelMode === "prompt") {
        setStatus(
          replacedDevice
            ? isEnglish()
              ? "Device transferred. Continuing…"
              : "设备换绑成功，正在继续…"
            : isEnglish()
              ? "Activated. Continuing…"
              : "激活成功，正在继续…",
          "success",
        );
        windowRef.setTimeout(() => resolvePrompt(true), 260);
      } else {
        setStatus(
          replacedDevice
            ? isEnglish()
              ? "Selected device unbound. This browser is now activated."
              : "所选设备已解绑，当前浏览器已激活。"
            : isEnglish()
              ? "License replaced successfully."
              : "激活码更换成功。",
          "success",
        );
        elements.code.value = "";
      }
    }

    /** @param {unknown} error Activation error. @param {string} code Submitted code. @returns {boolean} Whether a replacement prompt was rendered. */
    function renderDeviceLimit(error, code) {
      if (error?.code !== "DEVICE_LIMIT_REACHED" || !error.details) return false;
      renderReplacement(error.details, code);
      return true;
    }

    /** @param {number} offset Requested replacement page offset. @returns {Promise<void>} */
    async function loadReplacementPage(offset) {
      if (!replacementState) return;
      const code = replacementState.code;
      elements.transferPrevious.disabled = true;
      elements.transferNext.disabled = true;
      elements.submit.disabled = true;
      setStatus(isEnglish() ? "Loading devices…" : "正在读取设备列表…");
      try {
        const result = await activateCode(code, { deviceOffset: Math.max(0, offset) });
        if (!result?.activated) throw new Error(isEnglish() ? "Activation failed." : "激活失败。");
        applyActivation(result);
      } catch (error) {
        if (!renderDeviceLimit(error, code)) {
          elements.submit.disabled = false;
          setStatus(error.message, "error");
        }
      }
    }

    elements.form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const code = replacementState?.code || elements.code.value.trim();
      if (!code) {
        setStatus(isEnglish() ? "Enter an activation code." : "请输入激活码。", "error");
        elements.code.focus();
        return;
      }
      if (replacementState && !replacementState.selectedDeviceId) {
        setStatus(isEnglish() ? "Select the device to unbind first." : "请先选择要解绑的设备。", "error");
        replacementChoiceButtons[0]?.focus?.();
        return;
      }
      elements.submit.disabled = true;
      elements.code.disabled = true;
      setStatus(
        replacementState
          ? isEnglish()
            ? "Transferring device…"
            : "正在换绑设备…"
          : isEnglish()
            ? "Verifying…"
            : "正在校验…",
      );
      try {
        const result = await activateCode(
          code,
          replacementState ? { replaceDeviceId: replacementState.selectedDeviceId } : {},
        );
        if (!result?.activated) throw new Error(isEnglish() ? "Activation failed." : "激活失败。");
        applyActivation(result);
      } catch (error) {
        if (!renderDeviceLimit(error, code)) {
          elements.submit.disabled = false;
          elements.code.disabled = false;
          setStatus(error.message, "error");
          elements.code.focus();
        }
      }
    });
    elements.transferBack.addEventListener("click", () => {
      resetReplacement(true);
      setStatus(isEnglish() ? "Enter another activation code." : "可输入其他激活码。");
    });
    elements.transferPrevious.addEventListener("click", () => {
      const details = replacementState?.details;
      if (!details) return;
      void loadReplacementPage(Math.max(0, details.offset - details.pageSize));
    });
    elements.transferNext.addEventListener("click", () => {
      const details = replacementState?.details;
      if (!details) return;
      void loadReplacementPage(details.offset + details.pageSize);
    });
    elements.unbind.addEventListener("click", () => {
      elements.unbind.hidden = true;
      elements.unbindConfirm.hidden = false;
      setStatus(
        isEnglish()
          ? "Unbinding immediately invalidates this browser's current license."
          : "解绑后，当前浏览器的现有授权将立即失效。",
        "error",
      );
      windowRef.setTimeout(() => elements.unbindCancel.focus(), 0);
    });
    elements.unbindCancel.addEventListener("click", () => {
      resetUnbindConfirmation();
      setStatus(isEnglish() ? "Device unbind cancelled." : "已取消解绑设备。");
      elements.unbind.focus();
    });
    elements.unbindAccept.addEventListener("click", async () => {
      elements.unbindAccept.disabled = true;
      setStatus(isEnglish() ? "Unbinding this device…" : "正在解绑当前设备…");
      try {
        let result;
        if (deviceIdentity?.unbind) {
          result = await deviceIdentity.unbind();
        } else {
          const response = await fetchImpl("/api/activation/unbind", {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: "{}",
          });
          result = await response.json().catch(() => ({}));
          if (!response.ok || !result.unbound) {
            throw new Error(
              result.error || (isEnglish() ? "Unable to unbind this device." : "无法解绑当前设备。"),
            );
          }
        }
        if (!result?.unbound) {
          throw new Error(isEnglish() ? "Unable to unbind this device." : "无法解绑当前设备。");
        }
        activationStatus = {
          activated: false,
          configured: true,
          deviceId: "",
          expiresAt: "",
          plan: "",
          source: "",
        };
        statusLoaded = true;
        resetUnbindConfirmation();
        renderCurrentStatus();
        renderManagerMessage();
        setStatus(
          isEnglish()
            ? "This device is unbound. Other devices remain active."
            : "当前设备已解绑，其他设备不受影响。",
          "success",
        );
      } catch (error) {
        elements.unbindAccept.disabled = false;
        setStatus(error.message, "error");
      }
    });
    for (const launcher of statusLaunchers()) {
      launcher.button.addEventListener("click", () => void openManager());
    }
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
      openManager,
      refreshStatus,
      renderStatus: renderCurrentStatus,
    });
  }

  return Object.freeze({ createController });
});
