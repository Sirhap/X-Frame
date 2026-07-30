(function attachAttackTrailGuide(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AttackTrailGuide = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const STEPS = Object.freeze([
    Object.freeze({
      id: "enable",
      title: "开启拖尾模式",
      description: "先选中要制作的攻击动画和起始帧，再开启攻击拖尾模式。默认拖尾方案会自动载入。",
      targetSelector: "#attackTrailMode",
      checklist: Object.freeze([
        "确认当前动画是攻击动作，而不是 idle 或 run。",
        "从挥刀刚开始移动的帧开始制作。",
        "开启后仍可随时关闭，不会删除已有拖尾数据。",
      ]),
    }),
    Object.freeze({
      id: "sticks",
      title: "放置关键棍子",
      description: "棍子代表武器刀刃的上下边界。至少在挥刀开始帧和结束帧各放一根，系统会连接成拖尾。",
      targetSelector: "#attackTrailAddStick",
      checklist: Object.freeze([
        "切到挥刀开始帧，点击“当前帧加棍子”。",
        "切到挥刀结束帧，再添加一根棍子。",
        "动作弯曲明显时，可在中间帧补一根棍子。",
      ]),
    }),
    Object.freeze({
      id: "align",
      title: "把棍子贴住武器",
      description:
        "顶部工具栏的“棍”按钮控制辅助线。显示后，在画布上拖动棍子的两端，让它沿着刀刃或攻击方向摆放。",
      targetSelector: "#attackTrailGuideToggle",
      checklist: Object.freeze([
        "拖动上下端点，确定拖尾的宽度和方向。",
        "拖动中点可整体移动，不必分别调整两端。",
        "贴图方向相反时，使用“翻转贴图方向”。",
      ]),
    }),
    Object.freeze({
      id: "appearance",
      title: "设置形状和颜色",
      description: "默认 PNG 已经可以使用。先调整头部弧度，再选择单色、渐变或贴图原色。",
      targetSelector: "#attackTrailTextureBrowse",
      checklist: Object.freeze([
        "没有特殊需求时保留默认 PNG。",
        "头部弧度控制拖尾前端是内凹还是外凸。",
        "新手先用单色；需要多色过渡时再选择渐变。",
      ]),
    }),
    Object.freeze({
      id: "preview",
      title: "播放检查并保存",
      description:
        "播放动画观察拖尾是否跟手。默认时间与质量参数通常够用，只有收尾太慢或边缘不顺时才打开高级设置。",
      targetSelector: "#playPause",
      checklist: Object.freeze([
        "检查拖尾是否从正确帧出现并在结束后收拢。",
        "确认拖尾层级位于角色前方或后方。",
        "满意后点击工作台底部的保存。",
      ]),
    }),
  ]);

  /**
   * Clamps a requested guide index to the available step range.
   * @param {unknown} value Requested index.
   * @returns {number} Safe zero-based step index.
   */
  function normalizeStepIndex(value) {
    const index = Number(value);
    if (!Number.isInteger(index)) return 0;
    return Math.min(STEPS.length - 1, Math.max(0, index));
  }

  /**
   * Creates the attack-trail onboarding controller.
   * @param {{documentRef?:Document,onLocate?:(selector:string)=>void}} [dependencies] Browser adapters.
   * @returns {{open:(step?:number)=>void,close:()=>void,render:()=>void,currentStep:()=>number}} Guide API.
   */
  function createController(dependencies = {}) {
    const documentRef = dependencies.documentRef || root?.document;
    if (!documentRef?.querySelector || !documentRef?.createElement) {
      throw new TypeError("Attack trail guide requires a document-like interface.");
    }
    const elements = {
      trigger: documentRef.querySelector("#attackTrailHelpOpen"),
      dialog: documentRef.querySelector("#attackTrailGuide"),
      close: documentRef.querySelector("#attackTrailGuideClose"),
      steps: documentRef.querySelector("#attackTrailGuideSteps"),
      index: documentRef.querySelector("#attackTrailGuideIndex"),
      title: documentRef.querySelector("#attackTrailGuideStepTitle"),
      description: documentRef.querySelector("#attackTrailGuideDescription"),
      checklist: documentRef.querySelector("#attackTrailGuideChecklist"),
      locate: documentRef.querySelector("#attackTrailGuideLocate"),
      previous: documentRef.querySelector("#attackTrailGuidePrevious"),
      next: documentRef.querySelector("#attackTrailGuideNext"),
    };
    if (Object.values(elements).some((element) => !element)) {
      throw new Error("Attack trail guide markup is incomplete.");
    }
    let stepIndex = 0;
    let returnFocus = null;

    /** Renders step navigation and the current instruction. */
    function render() {
      const step = STEPS[stepIndex];
      elements.steps.replaceChildren(
        ...STEPS.map((entry, index) => {
          const item = documentRef.createElement("li");
          const button = documentRef.createElement("button");
          const number = documentRef.createElement("b");
          const label = documentRef.createElement("span");
          button.type = "button";
          button.className = index === stepIndex ? "active" : "";
          button.setAttribute("aria-current", index === stepIndex ? "step" : "false");
          number.textContent = String(index + 1).padStart(2, "0");
          label.textContent = entry.title;
          button.append(number, label);
          button.addEventListener("click", () => {
            stepIndex = index;
            render();
            button.focus();
          });
          item.append(button);
          return item;
        }),
      );
      elements.index.textContent = `STEP ${String(stepIndex + 1).padStart(2, "0")} / ${String(
        STEPS.length,
      ).padStart(2, "0")}`;
      elements.title.textContent = step.title;
      elements.description.textContent = step.description;
      elements.checklist.replaceChildren(
        ...step.checklist.map((text) => {
          const item = documentRef.createElement("li");
          item.textContent = text;
          return item;
        }),
      );
      elements.previous.disabled = stepIndex === 0;
      elements.next.textContent = stepIndex === STEPS.length - 1 ? "完成" : "下一步";
    }

    /** @param {number} [requestedStep] Initial step index. */
    function open(requestedStep = 0) {
      stepIndex = normalizeStepIndex(requestedStep);
      returnFocus = documentRef.activeElement;
      render();
      elements.dialog.hidden = false;
      documentRef.body?.classList.add("attackTrailGuideOpen");
      elements.steps.querySelector(".active")?.focus();
    }

    /** Closes the guide and restores focus to its launcher. */
    function close() {
      elements.dialog.hidden = true;
      documentRef.body?.classList.remove("attackTrailGuideOpen");
      returnFocus?.focus?.();
    }

    /** Moves focus to the control described by the current step. */
    function locateCurrentStep() {
      const selector = STEPS[stepIndex].targetSelector;
      close();
      if (dependencies.onLocate) {
        dependencies.onLocate(selector);
        return;
      }
      const panel = documentRef.querySelector("#attackTrailPanel");
      if (panel) panel.open = true;
      let target = documentRef.querySelector(selector);
      if (target?.closest?.("[hidden]")) target = documentRef.querySelector("#attackTrailMode");
      target?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      target?.focus?.();
    }

    /** Keeps focus in the modal and supports Escape. @param {KeyboardEvent} event */
    function handleKeydown(event) {
      if (elements.dialog.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        elements.dialog.querySelectorAll("button:not([disabled]), [tabindex]:not([tabindex='-1'])"),
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

    elements.trigger.addEventListener("click", () => open());
    elements.close.addEventListener("click", close);
    elements.dialog.addEventListener("click", (event) => {
      if (event.target === elements.dialog) close();
    });
    elements.previous.addEventListener("click", () => {
      stepIndex = normalizeStepIndex(stepIndex - 1);
      render();
    });
    elements.next.addEventListener("click", () => {
      if (stepIndex === STEPS.length - 1) {
        close();
        return;
      }
      stepIndex = normalizeStepIndex(stepIndex + 1);
      render();
    });
    elements.locate.addEventListener("click", locateCurrentStep);
    documentRef.addEventListener("keydown", handleKeydown);
    render();

    return Object.freeze({ open, close, render, currentStep: () => stepIndex });
  }

  return Object.freeze({ STEPS, normalizeStepIndex, createController });
});
