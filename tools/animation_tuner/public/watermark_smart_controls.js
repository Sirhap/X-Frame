/**
 * Owns the smart-repair form while keeping export orchestration in app.js.
 */
export class SmartControls {
  /**
   * @param {{root: HTMLElement, getCurrentTime: () => number, onChange: () => void, notify: (message: string) => void}} options Controller dependencies.
   */
  constructor(options) {
    this.root = options.root;
    this.getCurrentTime = options.getCurrentTime;
    this.onChange = options.onChange;
    this.notify = options.notify;
    this.duration = 0;
    this.elements = {
      selection: this.root.querySelector("#smartSelection"),
      referenceTime: this.root.querySelector("#referenceTime"),
      setReferenceTime: this.root.querySelector("#setReferenceTime"),
      titleEnabled: this.root.querySelector("#titleEnabled"),
      titleFields: this.root.querySelector("#titleFields"),
      titleText: this.root.querySelector("#titleText"),
      titleStart: this.root.querySelector("#titleStart"),
      setTitleStart: this.root.querySelector("#setTitleStart"),
      titleSize: this.root.querySelector("#titleSize"),
      titleBorder: this.root.querySelector("#titleBorder"),
      titleX: this.root.querySelector("#titleX"),
      titleY: this.root.querySelector("#titleY"),
      titleColor: this.root.querySelector("#titleColor"),
      colorCode: this.root.querySelector(".color-field code"),
    };
    this.bindEvents();
  }

  /** Registers form, toggle, and current-time interactions. */
  bindEvents() {
    this.root.addEventListener("input", () => this.onChange());
    this.elements.titleEnabled.addEventListener("change", () => {
      this.elements.titleFields.hidden = !this.elements.titleEnabled.checked;
      this.onChange();
    });
    this.elements.titleColor.addEventListener("input", () => {
      this.elements.colorCode.textContent = this.elements.titleColor.value;
    });
    this.elements.setReferenceTime.addEventListener("click", () => {
      this.setTimeValue(this.elements.referenceTime, "参考帧");
    });
    this.elements.setTitleStart.addEventListener("click", () => {
      this.setTimeValue(this.elements.titleStart, "标题起点");
    });
  }

  /** Resets duration-dependent values for a newly loaded source. */
  reset(metadata) {
    this.duration = Math.max(0, Number(metadata.duration) || 0);
    for (const input of [this.elements.referenceTime, this.elements.titleStart]) {
      input.max = String(this.duration);
    }
    this.elements.referenceTime.value = String(Math.min(5, this.duration));
    this.elements.titleStart.value = String(Math.min(28.43, this.duration));
    this.elements.titleX.max = String(metadata.width);
    this.elements.titleY.max = String(metadata.height);
    this.setSelectedRegion(null, -1);
    this.onChange();
  }

  /** Locks configuration while an export owns the current source and parameters. */
  setDisabled(disabled) {
    this.root.querySelectorAll("input, button").forEach((control) => {
      control.disabled = disabled;
    });
  }

  /** Shows the selected template bounds used by the smart pipeline. */
  setSelectedRegion(region, index) {
    if (!region) {
      this.elements.selection.textContent = "尚未选择模板区域";
      this.elements.selection.classList.remove("ready");
      return;
    }
    this.elements.selection.textContent = `使用区域 ${String(index + 1).padStart(2, "0")} · ${region.width} × ${region.height}px`;
    this.elements.selection.classList.add("ready");
  }

  /** Returns whether the currently visible smart form can be submitted. */
  isValid(region) {
    if (!region || !this.elements.referenceTime.checkValidity()) return false;
    if (!this.elements.titleEnabled.checked) return true;
    return [
      this.elements.titleText,
      this.elements.titleStart,
      this.elements.titleSize,
      this.elements.titleBorder,
      this.elements.titleX,
      this.elements.titleY,
    ].every((input) => input.checkValidity() && String(input.value).trim() !== "");
  }

  /** Builds the JSON contract expected by the smart export endpoint. */
  getOptions(region) {
    if (!this.isValid(region)) throw new Error("请完整填写智能修复参数");
    const title = this.elements.titleEnabled.checked
      ? {
          text: this.elements.titleText.value.trim(),
          startTime: Number(this.elements.titleStart.value),
          fontSize: Number(this.elements.titleSize.value),
          borderWidth: Number(this.elements.titleBorder.value),
          x: Number(this.elements.titleX.value),
          y: Number(this.elements.titleY.value),
          fontColor: this.elements.titleColor.value,
        }
      : null;
    return {
      referenceTime: Number(this.elements.referenceTime.value),
      region: {
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
      },
      title,
    };
  }

  /** Writes the current playback time to an input with user feedback. */
  setTimeValue(input, label) {
    input.value = Math.min(this.duration, Math.max(0, this.getCurrentTime())).toFixed(2);
    this.notify(`${label}已设为 ${input.value} 秒`);
    this.onChange();
  }
}
