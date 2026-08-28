"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { requestedGroup } = require("../animation_tuner/public/app_project_lifecycle");

test("stable animation deep links resolve independently of generated UI ids", () => {
  const groups = [
    { uiId: "actor:idle:0", profileId: "hero", animationId: "idle" },
    { uiId: "actor:run:1", profileId: "hero", animationId: "run" },
  ];
  const urlState = new URLSearchParams("animation=hero%2Frun&group=actor%3Aidle%3A0");
  assert.equal(requestedGroup(groups, urlState), groups[1]);
});

test("generated group ids remain a compatible fallback", () => {
  const groups = [{ uiId: "actor:idle:0", profileId: "hero", animationId: "idle" }];
  assert.equal(requestedGroup(groups, new URLSearchParams(), "actor:idle:0"), groups[0]);
});

test("index-suffixed group uiIds still resolve the same animation after an insert", () => {
  // syncUrlState writes group=<uiId> and deletes animation=. uiId includes the
  // groups-array index, so an import that lands earlier in the list rewrites
  // every later id. The URL from the previous session must still select run.
  const afterInsert = [
    { uiId: "player:animation:intro:0", profileId: "hero", animationId: "intro", name: "intro", type: "animation", tuningTarget: "player" },
    { uiId: "player:animation:idle:1", profileId: "hero", animationId: "idle", name: "idle", type: "animation", tuningTarget: "player" },
    { uiId: "player:animation:run:2", profileId: "hero", animationId: "run", name: "run", type: "animation", tuningTarget: "player" },
  ];
  const staleUrl = new URLSearchParams("group=player%3Aanimation%3Arun%3A1");
  assert.equal(requestedGroup(afterInsert, staleUrl)?.animationId, "run");
});

test("stale idle group after an insert resolves to sidekick not the first idle", () => {
  const afterInsert = [
    {
      uiId: "player:animation:idle:0",
      profileId: "hero",
      animationId: "idle",
      name: "idle",
      type: "animation",
      tuningTarget: "player",
    },
    {
      uiId: "player:animation:run:1",
      profileId: "hero",
      animationId: "run",
      name: "run",
      type: "animation",
      tuningTarget: "player",
    },
    {
      uiId: "player:animation:idle:2",
      profileId: "sidekick",
      animationId: "idle",
      name: "idle",
      type: "animation",
      tuningTarget: "player",
    },
  ];
  const staleSidekick = new URLSearchParams("group=player%3Aanimation%3Aidle%3A1");
  const resolved = requestedGroup(afterInsert, staleSidekick);
  assert.equal(resolved?.profileId, "sidekick", "stale idle:1 was sidekick before the insert");
  assert.equal(resolved?.animationId, "idle");
  assert.notEqual(resolved?.profileId, "hero");

  const withAnimation = new URLSearchParams(
    "group=player%3Aanimation%3Aidle%3A0&animation=sidekick%2Fidle",
  );
  assert.equal(requestedGroup(afterInsert, withAnimation)?.profileId, "sidekick");

  const exactHero = new URLSearchParams("group=player%3Aanimation%3Aidle%3A0");
  assert.equal(requestedGroup(afterInsert, exactHero)?.profileId, "hero");
});

test("stale actor idle:3 after insert resolves to sidekick not the hero who now owns that uiId", () => {
  const afterInsert = [
    {
      uiId: "player:actor:cutout-animation:0",
      profileId: "character",
      animationId: "cutout-animation",
      name: "cutout-animation",
      type: "actor",
      tuningTarget: "player",
    },
    {
      uiId: "player:actor:idle:1",
      profileId: "character",
      animationId: "idle",
      name: "idle",
      type: "actor",
      tuningTarget: "player",
    },
    {
      uiId: "player:actor:00:2",
      profileId: "character",
      animationId: "00",
      name: "00",
      type: "actor",
      tuningTarget: "player",
    },
    {
      uiId: "player:actor:idle:3",
      profileId: "hero",
      animationId: "idle",
      name: "idle",
      type: "actor",
      tuningTarget: "player",
    },
    {
      uiId: "player:actor:idle:4",
      profileId: "sidekick",
      animationId: "idle",
      name: "idle",
      type: "actor",
      tuningTarget: "player",
    },
  ];
  const staleSidekick = new URLSearchParams("group=player%3Aactor%3Aidle%3A3");
  const resolved = requestedGroup(afterInsert, staleSidekick);
  assert.equal(resolved?.profileId, "sidekick", "stale idle:3 was sidekick; hero now occupies that exact uiId");
  assert.equal(resolved?.uiId, "player:actor:idle:4");
  assert.notEqual(resolved?.profileId, "hero");

  const withAnimation = new URLSearchParams(
    "group=player%3Aactor%3Aidle%3A3&animation=sidekick%2Fidle",
  );
  assert.equal(requestedGroup(afterInsert, withAnimation)?.profileId, "sidekick");

  const uniqueExact = new URLSearchParams("group=player%3Aactor%3A00%3A2");
  assert.equal(requestedGroup(afterInsert, uniqueExact)?.animationId, "00");
});
