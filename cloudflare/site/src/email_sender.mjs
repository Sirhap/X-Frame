/**
 * Creates a Resend-backed verification email sender.
 * @param {{RESEND_API_KEY?:string,XSXB_EMAIL_FROM?:string}} env Worker environment.
 * @param {{fetchImpl?:typeof fetch}} [options] Runtime adapters.
 * @returns {{configured:boolean,sendVerificationCode:(email:string,code:string)=>Promise<void>}} Sender.
 */
export function createEmailSender(env, options = {}) {
  const apiKey = String(env?.RESEND_API_KEY || "");
  const from = String(env?.XSXB_EMAIL_FROM || "");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const configured = Boolean(apiKey && from && typeof fetchImpl === "function");

  return {
    configured,
    async sendVerificationCode(email, code) {
      if (!configured) throw Object.assign(new Error("Email delivery is not configured."), { status: 503 });
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [email],
          subject: "X-Frame 登录验证码",
          text: `你的验证码是 ${code}，10 分钟内有效。请勿将验证码告诉他人。`,
          html: `<p>你的 X-Frame 验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>验证码 10 分钟内有效，请勿将其告诉他人。</p>`,
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw Object.assign(
          new Error(`Email delivery failed (${response.status}): ${detail.slice(0, 160)}`),
          {
            status: 502,
          },
        );
      }
    },
  };
}
