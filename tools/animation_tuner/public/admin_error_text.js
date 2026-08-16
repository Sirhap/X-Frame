(function attachXsxbAdminErrorText(root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAdminErrorText = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const MESSAGES = Object.freeze({
    "Administrator authentication is not configured.": "管理员验证尚未配置，请先设置服务端环境变量。",
    "Too many attempts. Try again later.": "尝试次数过多，请稍后再试。",
    "The username or verification code is invalid.": "用户名或动态验证码无效。",
    "This verification code has already been used.": "该动态验证码已使用，请等待下一组验证码。",
    "Administrator session is required.": "管理会话已过期，请重新验证。",
    "Cross-origin administrator access is not allowed.": "不允许跨站访问管理员接口。",
  });

  /**
   * Converts stable administrator API errors into the console's Chinese interface language.
   * @param {unknown} message Server error message.
   * @param {unknown} status HTTP status code.
   * @returns {string} Localized user-facing error text.
   */
  function localize(message, status) {
    const source = String(message || "").trim();
    if (MESSAGES[source]) return MESSAGES[source];
    if (Number(status) === 401) return "管理员身份验证失败，请重新验证。";
    if (Number(status) === 429) return "请求过于频繁，请稍后再试。";
    return source || "请求失败，请稍后重试。";
  }

  return Object.freeze({ localize });
});
