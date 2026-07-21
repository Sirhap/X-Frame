"use strict";

process.stderr.write(
  "Publishing this package is disabled because it contains private algorithm source and tests.\n",
);
process.exitCode = 1;
