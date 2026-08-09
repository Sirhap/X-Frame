"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { prepareCloudflareLanding } = require("../cloudflare/site_html");

test("Cloudflare landing removes local-server-only tool cards", () => {
  const source = [
    "<main>",
    "<!-- cloudflare-local-only:start -->",
    '<a href="/tools/watermark">Watermark</a>',
    "<!-- cloudflare-local-only:end -->",
    '<a href="/tools/scatter-slice">Scatter slice</a>',
    "</main>",
  ].join("\n");

  const output = prepareCloudflareLanding(source);

  assert.doesNotMatch(output, /tools\/watermark/u);
  assert.doesNotMatch(output, /cloudflare-local-only/u);
  assert.match(output, /tools\/scatter-slice/u);
});

test("Cloudflare landing rejects an unclosed local-only marker", () => {
  assert.throws(
    () => prepareCloudflareLanding("<!-- cloudflare-local-only:start --><a>broken</a>"),
    /marker/u,
  );
});
