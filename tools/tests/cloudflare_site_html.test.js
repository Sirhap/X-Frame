"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { prepareCloudflareLanding } = require("../cloudflare/site_html");

test("Cloudflare HTML stripper removes local-only blocks without requiring landing markers", () => {
  const { stripCloudflareLocalOnly } = require("../cloudflare/site_html");
  const output = stripCloudflareLocalOnly(
    [
      '<a class="quickToolCard" href="/tools/cutout">Cutout</a>',
      "<!-- cloudflare-local-only:start -->",
      '<a class="quickToolCard" href="/tools/watermark">Watermark</a>',
      "<!-- cloudflare-local-only:end -->",
      '<a class="quickToolCard" href="/tools/export">Export</a>',
    ].join("\n"),
  );
  assert.doesNotMatch(output, /tools\/watermark/u);
  assert.match(output, /tools\/cutout/u);
  assert.match(output, /tools\/export/u);
});

test("Cloudflare landing removes local-server-only tool cards", () => {
  const source = [
    "<main>",
    "<p><span data-workstation-count>SIX</span> WORKSTATIONS</p>",
    "<!-- cloudflare-local-only:start -->",
    '<a class="tool-card" href="/tools/watermark">Watermark</a>',
    "<!-- cloudflare-local-only:end -->",
    '<a class="tool-card" href="/tools/scatter-slice">Scatter slice</a>',
    "</main>",
  ].join("\n");

  const output = prepareCloudflareLanding(source);

  assert.doesNotMatch(output, /tools\/watermark/u);
  assert.doesNotMatch(output, /cloudflare-local-only/u);
  assert.match(output, /tools\/scatter-slice/u);
  assert.match(output, /data-workstation-count>ONE</u);
});

test("factory copy counts remaining workstation cards instead of advertising SIX", () => {
  const html = fs.readFileSync(
    new URL("../animation_tuner/public/animation_factory.html", `file://${__dirname}/`),
    "utf8",
  );
  assert.doesNotMatch(
    html,
    /workstationCount\.textContent = language === "en" \? "SIX" : "六个"/u,
    "NAV-005: cloud landing strips the watermark station; do not keep advertising SIX",
  );
  assert.match(html, /querySelectorAll\([^)]*tool-card/u);

  const cloud = prepareCloudflareLanding(html);
  assert.doesNotMatch(cloud, /tools\/watermark/u);
  assert.match(cloud, /data-workstation-count>FIVE</u);
  assert.doesNotMatch(cloud, /data-workstation-count>SIX</u);
});

test("Cloudflare landing rejects an unclosed local-only marker", () => {
  assert.throws(
    () =>
      prepareCloudflareLanding(
        "<span data-workstation-count>ONE</span><!-- cloudflare-local-only:start --><a>broken</a>",
      ),
    /marker/u,
  );
});

test("Cloudflare landing requires the workstation-count marker", () => {
  assert.throws(() => prepareCloudflareLanding('<a class="tool-card">Tool</a>'), /workstation-count/u);
});

test("workbench marks watermark as local-only and reveals hubs before app boot", () => {
  const html = fs.readFileSync(
    new URL("../animation_tuner/public/index.html", `file://${__dirname}/`),
    "utf8",
  );
  assert.match(html, /cloudflare-local-only:start[\s\S]*tools\/watermark[\s\S]*cloudflare-local-only:end/u);
  assert.match(html, /function revealXsxbSurface\(\)/u);
  assert.match(html, /src="\/app_surface\.js"/u);
  assert.match(html, /XSXBAppSurface\?\.applyAppSurface/u);
  assert.match(html, /src="\/organizer_progress_overlay\.js"/u);
  assert.match(html, /XSXBOrganizerProgressOverlay\?\.scheduleAttach/u);
  assert.match(html, /DOMContentLoaded/u);
  assert.match(html, /data-theme="dark"[\s\S]*aria-pressed="true"/u);
  assert.match(html, /data-theme="light"[\s\S]*aria-pressed="false"/u);
});

test("landing localizes visible copy only after an explicit language choice", () => {
  const html = fs.readFileSync(
    new URL("../animation_tuner/public/landing.html", `file://${__dirname}/`),
    "utf8",
  );
  assert.match(html, /data-landing-copy="heroLede"/u);
  assert.match(html, /explicitKey\) === "true"/u);
  assert.match(html, /Tune every frame until it feels right/u);
  assert.match(html, /id="adminOpenButton"[^>]+href="\/admin\/licenses"/u);
});

test("factory account entry opens an inline email dialog", () => {
  const html = fs.readFileSync(
    new URL("../animation_tuner/public/animation_factory.html", `file://${__dirname}/`),
    "utf8",
  );

  assert.match(html, /data-account-open/u);
  assert.match(html, />邮箱\/用户名</u);
  assert.match(html, /type="text"\s+autocomplete="username"/u);
  assert.match(html, /id="factoryAccountDialog"/u);
  assert.match(html, /src="\/factory_account\.js"/u);
  assert.match(html, /data-factory-copy="localConsole"/u);
  assert.match(html, /const copy = \{/u);
  assert.match(html, /id="factoryNotice"/u);
  assert.match(html, /get\("notice"\) === "local-watermark"/u);
  assert.match(html, /explicitKey\) === "true"/u);
  assert.doesNotMatch(html, /projects\?account=login/u);
});
