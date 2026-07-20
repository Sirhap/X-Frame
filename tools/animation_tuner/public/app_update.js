(function attachXsxbAppUpdate(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppUpdate = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the safe local update-check and installation controller.
   * @param {{
   *   elements?:{updatePanel?:object,updateMessage?:object,updateButton?:object,updateVersion?:object},
   *   getDirty?:()=>boolean,
   *   translate?:(key:string,variables?:object)=>string,
   *   fetchImpl?:typeof fetch,
   *   windowRef?:Window,
   *   now?:()=>number,
   *   sleep?:(milliseconds:number)=>Promise<void>,
   *   reload?:()=>void,
   *   warn?:(...values:unknown[])=>void,
   *   restartTimeoutMs?:number,
   *   restartPollIntervalMs?:number,
   * }} dependencies Controller dependencies.
   * @returns {{
   *   render:()=>void,
   *   check:()=>Promise<boolean>,
   *   install:()=>Promise<boolean>,
   *   waitForRestart:(expectedCommit:string)=>Promise<boolean>,
   *   getState:()=>{status:object|null,token:string,phase:string},
   * }} Update operations.
   */
  function createController(dependencies = {}) {
    const {
      elements = {},
      getDirty = () => false,
      translate = (key) => key,
      fetchImpl = root.fetch,
      windowRef = root,
      now = () => Date.now(),
      sleep = (milliseconds) => new Promise((resolve) => windowRef.setTimeout(resolve, milliseconds)),
      reload = () => windowRef.location?.reload?.(),
      warn = (...values) => console.warn(...values),
      restartTimeoutMs = 60000,
      restartPollIntervalMs = 700,
    } = dependencies;
    let updateStatus = null;
    let updateToken = "";
    let updatePhase = "";

    /**
     * Converts a commit value to a compact display label.
     * @param {unknown} value Commit value.
     * @returns {string} Short commit label.
     */
    function shortCommit(value) {
      return String(value || "").slice(0, 7) || "-";
    }

    /**
     * Maps an update block reason to a translated message.
     * @param {string} reason Update block reason.
     * @returns {string} Translation key.
     */
    function tunerUpdateBlockMessage(reason) {
      const messages = {
        not_git_clone: "updateBlockedNotGit",
        no_remote: "updateBlockedNoRemote",
        untrusted_remote: "updateBlockedRemote",
        wrong_branch: "updateBlockedBranch",
        tracked_changes: "updateBlockedChanges",
      };
      return translate(messages[reason] || "updateReady");
    }

    /**
     * Renders update availability, blocking reasons, and installation state.
     * @returns {void}
     */
    function render() {
      if (
        !elements.updatePanel ||
        !elements.updateMessage ||
        !elements.updateButton ||
        !elements.updateVersion
      )
        return;
      const available = Boolean(updateStatus?.updateAvailable);
      elements.updatePanel.hidden = !available || updateStatus?.blockReason === "no_remote";
      if (!available) return;

      elements.updateVersion.textContent = `${shortCommit(updateStatus.currentCommit)} → ${shortCommit(updateStatus.latestCommit)}`;
      let message = tunerUpdateBlockMessage(updateStatus.blockReason);
      if (updatePhase === "installing") message = translate("updateInstalling");
      else if (updatePhase === "restarting") message = translate("updateRestarting");
      else if (updatePhase === "reconnect_failed") message = translate("updateReconnectFailed");
      else if (updatePhase.startsWith("failed:")) {
        message = translate("updateFailed", { message: updatePhase.slice(7) });
      } else if (getDirty()) {
        message = translate("updateSaveFirst");
      }

      const busy = updatePhase === "installing" || updatePhase === "restarting";
      elements.updateMessage.textContent = message;
      elements.updatePanel.classList.toggle("isUpdating", busy);
      elements.updateButton.disabled = busy || getDirty() || !updateStatus.canUpdate;
    }

    /**
     * Polls until the local server is back on the expected commit.
     * @param {string} expectedCommit Expected commit after installation.
     * @returns {Promise<boolean>} Whether the server reconnected.
     */
    async function waitForRestart(expectedCommit) {
      const deadline = now() + restartTimeoutMs;
      while (now() < deadline) {
        await sleep(restartPollIntervalMs);
        try {
          const response = await fetchImpl(`/api/update-status?reconnect=${now()}`, { cache: "no-store" });
          if (!response.ok) continue;
          const payload = await response.json();
          if (!payload.restarting && payload.currentCommit === expectedCommit) {
            reload();
            return true;
          }
        } catch {
          // A short connection failure is expected while the local server restarts.
        }
      }
      updatePhase = "reconnect_failed";
      render();
      return false;
    }

    /**
     * Checks whether a newer local update is available.
     * @returns {Promise<boolean>} Whether the check completed successfully.
     */
    async function check() {
      try {
        if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
        const response = await fetchImpl(`/api/update-status?opened=${now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        updateStatus = payload;
        updateToken = String(payload.token || "");
        updatePhase = "";
        render();
        return true;
      } catch (error) {
        warn("XSXB update check failed", error);
        return false;
      }
    }

    /**
     * Installs the available update after the editor is clean.
     * @returns {Promise<boolean>} Whether installation and reconnect succeeded.
     */
    async function install() {
      if (!updateStatus?.canUpdate || !updateToken) return false;
      if (getDirty()) {
        render();
        return false;
      }
      updatePhase = "installing";
      render();
      try {
        if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
        const response = await fetchImpl("/api/update", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-xsxb-update-token": updateToken,
          },
          body: "{}",
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        updatePhase = "restarting";
        render();
        return await waitForRestart(payload.update?.currentCommit || updateStatus.latestCommit);
      } catch (error) {
        updatePhase = `failed:${error.message}`;
        render();
        return false;
      }
    }

    /**
     * Exposes immutable update state for tests and integration diagnostics.
     * @returns {{status:object|null,token:string,phase:string}} Current state.
     */
    function getState() {
      return { status: updateStatus, token: updateToken, phase: updatePhase };
    }

    return { check, getState, install, render, waitForRestart };
  }

  return { createController };
});
