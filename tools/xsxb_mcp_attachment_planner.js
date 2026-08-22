"use strict";

/** @param {number} value Number to clamp. @param {number} min Minimum. @param {number} max Maximum. @returns {number} Clamped number. */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** @param {unknown} point Candidate point. @param {string} label Error label. @returns {{x:number,y:number}} Finite point. */
function requirePoint(point, label) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`${label} must contain finite x and y.`);
  return { x, y };
}

/** @param {number} degrees Angle. @returns {number} Equivalent angle in [-180, 180]. */
function normalizedAngle(degrees) {
  const normalized = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return normalized === -180 && degrees > 0 ? 180 : normalized;
}

/** @param {number} from Start degrees. @param {number} to End degrees. @returns {number} Shortest signed delta. */
function shortestAngleDelta(from, to) {
  return ((to - from + 540) % 360) - 180;
}

/**
 * Transforms an attachment-local point into group coordinates.
 * @param {{x:number,y:number}} point Point relative to image center.
 * @param {{scale?:number,scaleX?:number,scaleY?:number,rotation?:number,offset?:{x?:number,y?:number}}} transform Attachment transform.
 * @returns {{x:number,y:number}} Group point.
 */
function transformAttachmentPoint(point, transform = {}) {
  const scale = Number(transform.scale ?? 1);
  const scaleX = Number(transform.scaleX ?? scale);
  const scaleY = Number(transform.scaleY ?? scale);
  const radians = (Number(transform.rotation || 0) * Math.PI) / 180;
  const x = Number(point.x) * scaleX;
  const y = Number(point.y) * scaleY;
  return {
    x: Number(transform.offset?.x || 0) + x * Math.cos(radians) - y * Math.sin(radians),
    y: Number(transform.offset?.y || 0) + x * Math.sin(radians) + y * Math.cos(radians),
  };
}

/**
 * Builds a transform whose grip lands exactly on the requested hand point.
 * @param {{x:number,y:number}} hand Target hand in group coordinates.
 * @param {{x:number,y:number}} grip Weapon grip relative to image center.
 * @param {number} rotation Degrees.
 * @param {number} scale Uniform scale.
 * @returns {{scale:number,scaleX:number,scaleY:number,rotation:number,offset:{x:number,y:number}}} Transform.
 */
function transformForHand(hand, grip, rotation, scale) {
  const radians = (rotation * Math.PI) / 180;
  const scaledX = grip.x * scale;
  const scaledY = grip.y * scale;
  const rotatedGrip = {
    x: scaledX * Math.cos(radians) - scaledY * Math.sin(radians),
    y: scaledX * Math.sin(radians) + scaledY * Math.cos(radians),
  };
  return {
    scale,
    scaleX: scale,
    scaleY: scale,
    rotation: normalizedAngle(rotation),
    offset: { x: hand.x - rotatedGrip.x, y: hand.y - rotatedGrip.y },
  };
}

/** @param {{x:number,y:number}} left Point. @param {{x:number,y:number}} right Point. @returns {number} Distance. */
function distance(left, right) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

/**
 * Resolves one explicit weapon anchor into scale and rotation.
 * @param {object} anchor Raw anchor.
 * @param {{grip:{x:number,y:number},tip:{x:number,y:number}}} weapon Weapon landmarks.
 * @returns {object} Resolved anchor.
 */
function resolveAnchor(anchor, weapon) {
  const hand = requirePoint(anchor.hand, `Anchor ${anchor.frame} hand`);
  const sourceVector = { x: weapon.tip.x - weapon.grip.x, y: weapon.tip.y - weapon.grip.y };
  const sourceLength = Math.hypot(sourceVector.x, sourceVector.y);
  if (!(sourceLength > 0)) throw new Error("Weapon grip-to-tip axis must have positive length.");
  let scale;
  let rotation;
  let targetTip = null;
  if (anchor.tip !== undefined) {
    targetTip = requirePoint(anchor.tip, `Anchor ${anchor.frame} tip`);
    const targetVector = { x: targetTip.x - hand.x, y: targetTip.y - hand.y };
    const targetLength = Math.hypot(targetVector.x, targetVector.y);
    if (!(targetLength > 0)) throw new Error("Anchor grip-to-tip vector must have positive length.");
    scale = targetLength / sourceLength;
    rotation =
      ((Math.atan2(targetVector.y, targetVector.x) - Math.atan2(sourceVector.y, sourceVector.x)) * 180) /
      Math.PI;
  } else {
    scale = Number(anchor.scale);
    rotation = Number(anchor.rotation);
    if (!(Number.isFinite(scale) && scale > 0 && Number.isFinite(rotation))) {
      throw new Error(`Anchor ${anchor.frame} must provide tip or both rotation and scale.`);
    }
  }
  return {
    frame: Number(anchor.frame),
    hand,
    targetTip,
    scale,
    rotation: normalizedAngle(rotation),
    layer: anchor.layer === "below" ? "below" : "above",
  };
}

/**
 * Plans contiguous per-frame weapon transforms between explicit anchors.
 * @param {{frameCount:number,weapon:{grip:{x:number,y:number},tip:{x:number,y:number}},anchors:object[],startFrame?:number,endFrame?:number}} options Planning input.
 * @returns {object[]} Planned frame entries.
 */
function planWeaponTransforms(options) {
  const frameCount = Number(options?.frameCount);
  if (!Number.isInteger(frameCount) || frameCount < 1) throw new Error("frameCount must be positive.");
  const weapon = {
    grip: requirePoint(options?.weapon?.grip, "Weapon grip"),
    tip: requirePoint(options?.weapon?.tip, "Weapon tip"),
  };
  const rawAnchors = Array.isArray(options?.anchors) ? options.anchors : [];
  if (!rawAnchors.length) throw new Error("Weapon planning requires at least one anchor.");
  const anchors = rawAnchors
    .map((anchor) => {
      const frame = Number(anchor?.frame);
      if (!Number.isInteger(frame) || frame < 0 || frame >= frameCount) {
        throw new Error(`Anchor frame must be between 0 and ${frameCount - 1}.`);
      }
      return resolveAnchor({ ...anchor, frame }, weapon);
    })
    .sort((left, right) => left.frame - right.frame);
  if (anchors.some((anchor, index) => index > 0 && anchor.frame === anchors[index - 1].frame)) {
    throw new Error("Weapon anchors must use unique frames.");
  }
  const startFrame = options.startFrame === undefined ? anchors[0].frame : Number(options.startFrame);
  const endFrame = options.endFrame === undefined ? anchors.at(-1).frame : Number(options.endFrame);
  if (
    !Number.isInteger(startFrame) ||
    !Number.isInteger(endFrame) ||
    startFrame < anchors[0].frame ||
    endFrame > anchors.at(-1).frame ||
    endFrame < startFrame
  ) {
    throw new Error("Planned frame range must stay inside the explicit anchor range.");
  }
  const entries = [];
  for (let frame = startFrame; frame <= endFrame; frame += 1) {
    const rightIndex = anchors.findIndex((anchor) => anchor.frame >= frame);
    const right = anchors[rightIndex < 0 ? anchors.length - 1 : rightIndex];
    const left = anchors[Math.max(0, rightIndex - (right.frame === frame ? 0 : 1))];
    const span = Math.max(1, right.frame - left.frame);
    const phase = left.frame === right.frame ? 0 : clamp((frame - left.frame) / span, 0, 1);
    const hand = {
      x: left.hand.x + (right.hand.x - left.hand.x) * phase,
      y: left.hand.y + (right.hand.y - left.hand.y) * phase,
    };
    const scale = Math.exp(Math.log(left.scale) + (Math.log(right.scale) - Math.log(left.scale)) * phase);
    const rotation = normalizedAngle(
      left.rotation + shortestAngleDelta(left.rotation, right.rotation) * phase,
    );
    const transform = transformForHand(hand, weapon.grip, rotation, scale);
    const grip = transformAttachmentPoint(weapon.grip, transform);
    const tip = transformAttachmentPoint(weapon.tip, transform);
    const expectedTip = left.frame === right.frame && left.targetTip ? left.targetTip : tip;
    const expectedVector = { x: expectedTip.x - hand.x, y: expectedTip.y - hand.y };
    const actualVector = { x: tip.x - grip.x, y: tip.y - grip.y };
    const angleError = Math.abs(
      shortestAngleDelta(
        (Math.atan2(expectedVector.y, expectedVector.x) * 180) / Math.PI,
        (Math.atan2(actualVector.y, actualVector.x) * 180) / Math.PI,
      ),
    );
    entries.push({
      frame,
      hand,
      grip,
      tip,
      layer: left.layer,
      transform,
      gripErrorPx: distance(hand, grip),
      tipAngleErrorDeg: angleError,
    });
  }
  return entries;
}

/** @param {Uint8ClampedArray} destination Mutable destination. @param {number} offset Pixel offset. @param {Uint8ClampedArray|number[]} source RGBA. @returns {void} */
function alphaOver(destination, offset, source) {
  const sourceAlpha = Number(source[3]) / 255;
  if (sourceAlpha <= 0) return;
  const destinationAlpha = destination[offset + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  for (let channel = 0; channel < 3; channel += 1) {
    destination[offset + channel] = Math.round(
      (Number(source[channel]) * sourceAlpha +
        destination[offset + channel] * destinationAlpha * (1 - sourceAlpha)) /
        Math.max(outputAlpha, 0.000001),
    );
  }
  destination[offset + 3] = Math.round(outputAlpha * 255);
}

/** @param {object} destination Destination frame. @param {object} source Source frame. @returns {void} */
function paintOwner(destination, source) {
  const width = Math.min(destination.width, source.width);
  const height = Math.min(destination.height, source.height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * destination.width + x) * 4;
      const sourceOffset = (y * source.width + x) * 4;
      alphaOver(destination.data, offset, source.data.subarray(sourceOffset, sourceOffset + 4));
    }
  }
}

/** @param {object} destination Destination frame. @param {object} image Attachment image. @param {object} transform Transform. @returns {void} */
function paintAttachment(destination, image, transform) {
  const radians = (Number(transform.rotation || 0) * Math.PI) / 180;
  const scaleX = Number(transform.scaleX ?? transform.scale ?? 1);
  const scaleY = Number(transform.scaleY ?? transform.scale ?? 1);
  const originX = destination.width / 2 + Number(transform.offset?.x || 0);
  const originY = destination.height + Number(transform.offset?.y || 0);
  for (let y = 0; y < destination.height; y += 1) {
    for (let x = 0; x < destination.width; x += 1) {
      const dx = x + 0.5 - originX;
      const dy = y + 0.5 - originY;
      const localX = (dx * Math.cos(radians) + dy * Math.sin(radians)) / scaleX + image.width / 2;
      const localY = (-dx * Math.sin(radians) + dy * Math.cos(radians)) / scaleY + image.height / 2;
      const sourceX = Math.floor(localX);
      const sourceY = Math.floor(localY);
      if (sourceX < 0 || sourceX >= image.width || sourceY < 0 || sourceY >= image.height) continue;
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      alphaOver(
        destination.data,
        (y * destination.width + x) * 4,
        image.data.subarray(sourceOffset, sourceOffset + 4),
      );
    }
  }
}

/** @param {object} frame Frame. @param {{x:number,y:number}} point Group point. @param {number[]} color RGBA. @returns {void} */
function paintCross(frame, point, color) {
  if (!Number.isFinite(Number(point?.x)) || !Number.isFinite(Number(point?.y))) return;
  const centerX = Math.round(frame.width / 2 + point.x);
  const centerY = Math.round(frame.height + point.y);
  for (let delta = -2; delta <= 2; delta += 1) {
    for (const [x, y] of [
      [centerX + delta, centerY],
      [centerX, centerY + delta],
    ]) {
      if (x < 0 || x >= frame.width || y < 0 || y >= frame.height) continue;
      frame.data.set(color, (y * frame.width + x) * 4);
    }
  }
}

/**
 * Renders one planned attachment frame with review markers.
 * @param {{data:Uint8ClampedArray,width:number,height:number}} owner Character frame.
 * @param {{data:Uint8ClampedArray,width:number,height:number}} attachment Attachment image.
 * @param {object} entry Planned entry.
 * @returns {{data:Uint8ClampedArray,width:number,height:number}} Composite frame.
 */
function renderWeaponPlanFrame(owner, attachment, entry) {
  const output = {
    data: new Uint8ClampedArray(owner.width * owner.height * 4),
    width: owner.width,
    height: owner.height,
  };
  if (entry.layer === "below") paintAttachment(output, attachment, entry.transform);
  paintOwner(output, owner);
  if (entry.layer !== "below") paintAttachment(output, attachment, entry.transform);
  paintCross(output, entry.hand, [70, 255, 110, 255]);
  paintCross(output, entry.grip, [255, 80, 80, 255]);
  paintCross(output, entry.tip, [255, 220, 40, 255]);
  return output;
}

module.exports = {
  planWeaponTransforms,
  renderWeaponPlanFrame,
  shortestAngleDelta,
  transformAttachmentPoint,
};
