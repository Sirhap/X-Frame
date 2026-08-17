"use strict";

const { resetFixtureRoot, resolveE2ERoot } = require("./e2e_fixture");

const fixtureRoot = resolveE2ERoot();
resetFixtureRoot(fixtureRoot);
process.env.XSXB_ROOT = fixtureRoot;

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

require("../../animation_tuner/server");
