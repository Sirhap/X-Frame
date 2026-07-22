(function attachXsxbDeviceFingerprint(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBDeviceFingerprint = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /** @param {unknown} value Raw text. @param {number} limit Maximum characters. @returns {string} Bounded text. */
  function boundedText(value, limit) {
    return String(value || "")
      .trim()
      .slice(0, limit);
  }

  /** @param {Navigator} navigatorRef Browser navigator. @returns {Promise<object>} High-entropy UA signals. */
  async function collectUserAgentData(navigatorRef) {
    const userAgentData = navigatorRef?.userAgentData;
    if (!userAgentData?.getHighEntropyValues) return {};
    try {
      const values = await userAgentData.getHighEntropyValues([
        "architecture",
        "bitness",
        "model",
        "platformVersion",
        "wow64",
      ]);
      return {
        architecture: boundedText(values.architecture, 32),
        bitness: boundedText(values.bitness, 16),
        model: boundedText(values.model, 80),
        platformVersion: boundedText(values.platformVersion, 80),
        wow64: values.wow64 === true,
        brands: Array.isArray(userAgentData.brands)
          ? userAgentData.brands.slice(0, 12).map((brand) => ({
              brand: boundedText(brand?.brand, 80),
              version: boundedText(brand?.version, 32),
            }))
          : [],
      };
    } catch (_error) {
      return {};
    }
  }

  /** @param {Document|null} documentRef Browser document. @returns {{vendor:string,renderer:string}} WebGL signals. */
  function collectWebGl(documentRef) {
    try {
      const canvas = documentRef?.createElement?.("canvas");
      const context = canvas?.getContext?.("webgl", { powerPreference: "low-power" });
      const extension = context?.getExtension?.("WEBGL_debug_renderer_info");
      if (!context || !extension) return { vendor: "", renderer: "" };
      return {
        vendor: boundedText(context.getParameter(extension.UNMASKED_VENDOR_WEBGL), 120),
        renderer: boundedText(context.getParameter(extension.UNMASKED_RENDERER_WEBGL), 160),
      };
    } catch (_error) {
      return { vendor: "", renderer: "" };
    }
  }

  /**
   * Collects bounded browser signals that the server immediately hashes.
   * @param {{navigatorRef?:Navigator,screenRef?:Screen,documentRef?:Document,devicePixelRatio?:number}} [dependencies] Browser adapters.
   * @returns {Promise<object>} Device fingerprint payload.
   */
  async function collect(dependencies = {}) {
    const navigatorRef = dependencies.navigatorRef || root?.navigator;
    const screenRef = dependencies.screenRef || root?.screen;
    const documentRef = dependencies.documentRef || root?.document;
    let timeZone = "";
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (_error) {
      timeZone = "";
    }
    return {
      version: 1,
      platform: boundedText(navigatorRef?.userAgentData?.platform || navigatorRef?.platform, 80),
      userAgent: boundedText(navigatorRef?.userAgent, 240),
      language: boundedText(navigatorRef?.language, 32),
      languages: Array.isArray(navigatorRef?.languages)
        ? navigatorRef.languages.slice(0, 8).map((language) => boundedText(language, 32))
        : [],
      timeZone: boundedText(timeZone, 80),
      hardwareConcurrency: Number(navigatorRef?.hardwareConcurrency || 0),
      deviceMemory: Number(navigatorRef?.deviceMemory || 0),
      maxTouchPoints: Number(navigatorRef?.maxTouchPoints || 0),
      screen: {
        width: Number(screenRef?.width || 0),
        height: Number(screenRef?.height || 0),
        colorDepth: Number(screenRef?.colorDepth || 0),
        pixelRatio: Number(dependencies.devicePixelRatio || root?.devicePixelRatio || 0),
      },
      userAgentData: await collectUserAgentData(navigatorRef),
      webgl: collectWebGl(documentRef),
    };
  }

  return Object.freeze({ collect });
});
