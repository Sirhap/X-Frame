"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  deriveWeaponTrailSticks,
  planWeaponTransforms,
  transformAttachmentPoint,
} = require("../xsxb_mcp_attachment_planner");

const WEAPON = Object.freeze({
  grip: { x: -2, y: 0 },
  tip: { x: 8, y: 0 },
});

function close(actual, expected, tolerance = 0.000001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test("weapon planning rotates and scales the grip exactly onto the hand anchor", () => {
  const entries = planWeaponTransforms({
    frameCount: 1,
    weapon: WEAPON,
    anchors: [{ frame: 0, hand: { x: 10, y: -20 }, tip: { x: 10, y: -40 } }],
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].transform.scale, 2);
  assert.equal(entries[0].transform.rotation, -90);
  close(entries[0].transform.offset.x, 10);
  close(entries[0].transform.offset.y, -24);
  const grip = transformAttachmentPoint(WEAPON.grip, entries[0].transform);
  const tip = transformAttachmentPoint(WEAPON.tip, entries[0].transform);
  close(grip.x, 10);
  close(grip.y, -20);
  close(tip.x, 10);
  close(tip.y, -40);
  close(entries[0].gripErrorPx, 0);
  close(entries[0].tipAngleErrorDeg, 0);
});

test("weapon planning interpolates hand, logarithmic scale, and the shortest rotation arc", () => {
  const entries = planWeaponTransforms({
    frameCount: 3,
    weapon: WEAPON,
    anchors: [
      { frame: 0, hand: { x: 0, y: 0 }, rotation: 170, scale: 1, layer: "below" },
      { frame: 2, hand: { x: 20, y: -10 }, rotation: -170, scale: 4, layer: "above" },
    ],
  });

  assert.deepEqual(
    entries.map((entry) => entry.frame),
    [0, 1, 2],
  );
  close(entries[1].hand.x, 10);
  close(entries[1].hand.y, -5);
  close(entries[1].transform.scale, 2);
  close(Math.abs(entries[1].transform.rotation), 180);
  assert.equal(entries[1].layer, "below");
  assert.equal(entries[2].layer, "above");
  const middleGrip = transformAttachmentPoint(WEAPON.grip, entries[1].transform);
  close(middleGrip.x, 10);
  close(middleGrip.y, -5);
});

test("weapon planning rejects ambiguous anchors and unsafe frame ranges", () => {
  assert.throws(
    () =>
      planWeaponTransforms({
        frameCount: 1,
        weapon: WEAPON,
        anchors: [{ frame: 0, hand: { x: 0, y: 0 } }],
      }),
    /tip or both rotation and scale/u,
  );
  assert.throws(
    () =>
      planWeaponTransforms({
        frameCount: 1,
        weapon: WEAPON,
        anchors: [{ frame: 0, hand: { x: 0, y: 0 }, tip: { x: 0, y: 0 } }],
      }),
    /positive length/u,
  );
  assert.throws(
    () =>
      planWeaponTransforms({
        frameCount: 1,
        weapon: WEAPON,
        anchors: [{ frame: 2, hand: { x: 0, y: 0 }, rotation: 0, scale: 1 }],
      }),
    /between 0 and 0/u,
  );
});

test("weapon trail derivation uses transformed tips, grips, and attachment layers", () => {
  const attachments = [
    {
      id: "sword_0000",
      assetId: "asset-sword",
      layer: "below",
      metadata: { frame: 0 },
      transform: { scale: 2, scaleX: 2, scaleY: 2, rotation: -90, offset: { x: 10, y: -24 } },
    },
    {
      id: "sword_0001",
      assetId: "asset-sword",
      layer: "above",
      metadata: { frame: 1 },
      transform: { scale: 1, scaleX: 1, scaleY: 1, rotation: 0, offset: { x: 12, y: -20 } },
    },
  ];

  const result = deriveWeaponTrailSticks({
    attachments,
    attachmentId: "asset-sword",
    weapon: WEAPON,
  });

  assert.deepEqual(result.sticks, [
    { frame: 0, top: { x: 10, y: -40 }, bottom: { x: 10, y: -20 }, layer: "behind" },
    { frame: 1, top: { x: 20, y: -20 }, bottom: { x: 10, y: -20 }, layer: "front" },
  ]);
  assert.equal(result.warnings.length, 0);
});

test("weapon trail derivation rejects fewer than two poses and warns on discontinuities", () => {
  assert.throws(
    () =>
      deriveWeaponTrailSticks({
        attachments: [{ id: "sword", metadata: { frame: 0 }, transform: { offset: { x: 0, y: 0 } } }],
        attachmentId: "sword",
        weapon: WEAPON,
      }),
    /at least two weapon poses/u,
  );

  const result = deriveWeaponTrailSticks({
    attachments: [
      { id: "sword", metadata: { frame: 0 }, transform: { scale: 1, rotation: 0, offset: { x: 0, y: 0 } } },
      {
        id: "sword",
        metadata: { frame: 3 },
        transform: { scale: 4, rotation: 170, offset: { x: 80, y: 0 } },
      },
    ],
    attachmentId: "sword",
    weapon: WEAPON,
  });
  assert.ok(result.warnings.some((warning) => /missing weapon frames/u.test(warning)));
  assert.ok(result.warnings.some((warning) => /scale jump/u.test(warning)));
  assert.ok(result.warnings.some((warning) => /rotation jump/u.test(warning)));
});
