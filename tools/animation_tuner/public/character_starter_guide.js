(function attachCharacterStarterGuide(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CharacterStarterGuide = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const MODES = Object.freeze([
    Object.freeze({
      id: "s",
      inputZh: "1 张角色图",
      inputEn: "1 character image",
      titleZh: "三档简化",
      titleEn: "Simplify",
      outputZh: "轻度、中度、重度三张可游玩角色图",
      outputEn: "Light, medium, and heavy playable-character variants",
    }),
    Object.freeze({
      id: "ct",
      inputZh: "角色图 + 画风参考",
      inputEn: "Character + style reference",
      titleZh: "转换画风",
      titleEn: "Target style",
      outputZh: "保留角色身份并应用目标绘制方式",
      outputEn: "Preserve identity while applying the target rendering style",
    }),
    Object.freeze({
      id: "p",
      inputZh: "角色图 + 1 张或多张姿势图",
      inputEn: "Character + one or more pose references",
      titleZh: "姿势迁移",
      titleEn: "Pose transfer",
      outputZh: "每张姿势参考生成一张精修角色图",
      outputEn: "One refined character image per pose reference",
    }),
    Object.freeze({
      id: "sq",
      inputZh: "1 张孤立角色图",
      inputEn: "1 isolated character image",
      titleZh: "动作探索",
      titleEn: "Action exploration",
      outputZh: "走、跑、跳、攻击、冲刺五张单帧",
      outputEn: "Walk, run, jump, attack, and dash single frames",
    }),
    Object.freeze({
      id: "cs",
      inputZh: "1 张角色设定图",
      inputEn: "1 character concept image",
      titleZh: "待机起稿",
      titleEn: "Idle starter",
      outputZh: "低、中、高复杂度三张右朝向待机角色",
      outputEn: "Low, medium, and high-complexity right-facing idle characters",
    }),
  ]);

  /** Returns the normalized Codex invocation for a starter mode. @param {string} mode Mode id. */
  function commandForMode(mode) {
    const resolved = MODES.some((entry) => entry.id === mode) ? mode : MODES[0].id;
    return `$2DCS ${resolved}`;
  }

  /**
   * Creates the 2D character starter guide controller.
   * @param {{document?:Document,navigator?:Navigator,onImport?:()=>void,onStatus?:(message:string)=>void}} dependencies Browser adapters.
   */
  function createController(dependencies = {}) {
    const documentRef = dependencies.document || root.document;
    if (!documentRef?.querySelector) throw new TypeError("Character starter guide requires a document.");
    const elements = {
      trigger: documentRef.querySelector("#characterStarterOpen"),
      dialog: documentRef.querySelector("#characterStarterGuide"),
      close: documentRef.querySelector("#characterStarterClose"),
      modes: documentRef.querySelector("#characterStarterModes"),
      title: documentRef.querySelector("#characterStarterModeTitle"),
      input: documentRef.querySelector("#characterStarterModeInput"),
      output: documentRef.querySelector("#characterStarterModeOutput"),
      command: documentRef.querySelector("#characterStarterCommand"),
      copy: documentRef.querySelector("#characterStarterCopy"),
      import: documentRef.querySelector("#characterStarterImport"),
    };
    if (!elements.dialog || !elements.modes) {
      throw new Error("Character starter guide markup is incomplete.");
    }
    let selectedMode = MODES[0].id;
    let returnFocus = null;

    /** Returns true when the current document language is English. */
    const isEnglish = () =>
      String(documentRef.documentElement?.lang || "")
        .toLowerCase()
        .startsWith("en");

    /** Renders mode navigation and the selected mode details. */
    function render() {
      const english = isEnglish();
      const selected = MODES.find((entry) => entry.id === selectedMode) || MODES[0];
      elements.modes.replaceChildren(
        ...MODES.map((mode) => {
          const button = documentRef.createElement("button");
          button.type = "button";
          button.dataset.characterMode = mode.id;
          button.className = mode.id === selected.id ? "active" : "";
          button.setAttribute("aria-pressed", String(mode.id === selected.id));
          button.innerHTML = `<b>${mode.id.toUpperCase()}</b><span>${english ? mode.titleEn : mode.titleZh}</span>`;
          button.addEventListener("click", () => {
            selectedMode = mode.id;
            render();
          });
          return button;
        }),
      );
      elements.title.textContent = english ? selected.titleEn : selected.titleZh;
      elements.input.textContent = english ? selected.inputEn : selected.inputZh;
      elements.output.textContent = english ? selected.outputEn : selected.outputZh;
      elements.command.textContent = commandForMode(selected.id);
    }

    /** Opens the modal and moves focus to the active mode. */
    function open() {
      returnFocus = documentRef.activeElement;
      render();
      elements.dialog.hidden = false;
      documentRef.body.classList.add("characterStarterGuideOpen");
      elements.modes.querySelector(".active")?.focus();
    }

    /** Closes the modal and restores focus to its launcher. */
    function close() {
      elements.dialog.hidden = true;
      documentRef.body.classList.remove("characterStarterGuideOpen");
      returnFocus?.focus?.();
    }

    /** Copies the selected command with a deterministic text fallback. */
    async function copyCommand() {
      const command = commandForMode(selectedMode);
      try {
        const clipboard = dependencies.navigator?.clipboard || root.navigator?.clipboard;
        if (typeof clipboard?.writeText !== "function") throw new Error("Clipboard unavailable");
        await clipboard.writeText(command);
        dependencies.onStatus?.(isEnglish() ? `${command} copied` : `已复制 ${command}`);
        elements.copy.dataset.copied = "true";
        root.setTimeout?.(() => delete elements.copy.dataset.copied, 1200);
      } catch (_error) {
        dependencies.onStatus?.(
          isEnglish() ? `Copy unavailable. Select: ${command}` : `无法自动复制，请手动选择：${command}`,
        );
      }
    }

    /** Keeps keyboard focus inside the dialog and supports Escape. @param {KeyboardEvent} event */
    function handleKeydown(event) {
      if (elements.dialog.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        elements.dialog.querySelectorAll("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"),
      ).filter((element) => !element.hidden);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && documentRef.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && documentRef.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    elements.trigger?.addEventListener("click", open);
    elements.close?.addEventListener("click", close);
    elements.dialog.addEventListener("click", (event) => {
      if (event.target === elements.dialog) close();
    });
    elements.copy?.addEventListener("click", () => void copyCommand());
    elements.import?.addEventListener("click", () => {
      close();
      dependencies.onImport?.();
    });
    documentRef.addEventListener("keydown", handleKeydown);
    render();
    return Object.freeze({ open, close, render, commandForMode: () => commandForMode(selectedMode) });
  }

  return Object.freeze({ MODES, commandForMode, createController });
});
