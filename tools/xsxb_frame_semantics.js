"use strict";

const ALPHA_VISIBLE = 16;

function visible(frame, x, y) {
  return frame.data[(y * frame.width + x) * 4 + 3] > ALPHA_VISIBLE;
}

function luma(frame, x, y) {
  const offset = (y * frame.width + x) * 4;
  return 0.2126 * frame.data[offset] + 0.7152 * frame.data[offset + 1] + 0.0722 * frame.data[offset + 2];
}

/**
 * Finds the largest connected opaque component, preferring non-highlight pixels so detached
 * slash FX does not move the temporal alignment anchor.
 * @param {{data:Uint8ClampedArray|Uint8Array,width:number,height:number}} frame RGBA frame.
 * @returns {{candidateCount:number,region:object,anchorX2:number,anchorY:number,bounds:object,opaquePixels:number}}
 */
function alignedBodyCandidate(frame) {
  const pixelCount = frame.width * frame.height;
  const visibleMask = new Uint8Array(pixelCount);
  const darkMask = new Uint8Array(pixelCount);
  let opaquePixels = 0;
  let darkPixels = 0;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      if (!visible(frame, x, y)) continue;
      const index = y * frame.width + x;
      visibleMask[index] = 1;
      opaquePixels += 1;
      if (luma(frame, x, y) < 185) {
        darkMask[index] = 1;
        darkPixels += 1;
      }
    }
  }
  if (!opaquePixels) {
    return {
      candidateCount: 0,
      region: { left: 0, top: 0, right: 0, bottom: 0 },
      anchorX2: 0,
      anchorY: 0,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      opaquePixels: 0,
    };
  }
  const mask = darkPixels >= Math.max(4, Math.ceil(opaquePixels * 0.03)) ? darkMask : visibleMask;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(opaquePixels);
  let bestBounds = null;
  let bestScore = -1;
  for (let start = 0; start < pixelCount; start += 1) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let minimumX = frame.width;
    let minimumY = frame.height;
    let maximumX = -1;
    let maximumY = -1;
    visited[start] = 1;
    queue[tail] = start;
    tail += 1;
    while (head < tail) {
      const index = queue[head];
      head += 1;
      const x = index % frame.width;
      const y = Math.floor(index / frame.width);
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextY < 0 || nextX >= frame.width || nextY >= frame.height) continue;
          const next = nextY * frame.width + nextX;
          if (!mask[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail] = next;
          tail += 1;
        }
      }
    }
    const score = tail * (1 + (maximumY / Math.max(1, frame.height - 1)) * 0.12);
    if (score > bestScore) {
      bestScore = score;
      bestBounds = {
        x: minimumX,
        y: minimumY,
        width: maximumX - minimumX + 1,
        height: maximumY - minimumY + 1,
      };
    }
  }
  const coreBounds = bestBounds || { x: 0, y: 0, width: frame.width, height: frame.height };
  const paddingX = Math.max(2, Math.round(coreBounds.width * 0.2));
  const paddingY = Math.max(2, Math.round(coreBounds.height * 0.12));
  const left = Math.max(0, coreBounds.x - paddingX);
  const top = Math.max(0, coreBounds.y - paddingY);
  const right = Math.min(frame.width, coreBounds.x + coreBounds.width + paddingX);
  const bottom = Math.min(frame.height, coreBounds.y + coreBounds.height + paddingY);
  let candidateCount = 0;
  let candidateMinX = frame.width;
  let candidateMinY = frame.height;
  let candidateMaxX = -1;
  let candidateMaxY = -1;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (!visibleMask[y * frame.width + x]) continue;
      candidateCount += 1;
      candidateMinX = Math.min(candidateMinX, x);
      candidateMinY = Math.min(candidateMinY, y);
      candidateMaxX = Math.max(candidateMaxX, x);
      candidateMaxY = Math.max(candidateMaxY, y);
    }
  }
  return {
    candidateCount,
    region: { left, top, right, bottom },
    anchorX2: coreBounds.x * 2 + coreBounds.width - 1,
    anchorY: coreBounds.y + coreBounds.height - 1,
    bounds:
      candidateCount > 0
        ? {
            x: candidateMinX,
            y: candidateMinY,
            width: candidateMaxX - candidateMinX + 1,
            height: candidateMaxY - candidateMinY + 1,
          }
        : coreBounds,
    opaquePixels,
  };
}

/**
 * Separates temporally persistent character pixels from transient baked FX.
 * @param {Array<{data:Uint8ClampedArray|Uint8Array,width:number,height:number}>} inputFrames RGBA frames.
 * @returns {{frames:object[],provenance:object,persistentPixelCount:number}}
 */
function analyzeFrameSequence(inputFrames) {
  const frames = Array.isArray(inputFrames) ? inputFrames : [];
  if (!frames.length)
    return { frames: [], provenance: { body: "none", sourceFx: "none" }, persistentPixelCount: 0 };
  const width = frames[0].width;
  const height = frames[0].height;
  if (frames.some((frame) => frame.width !== width || frame.height !== height)) {
    throw new Error("Frame semantics requires a shared canvas size.");
  }
  const candidates = frames.map(alignedBodyCandidate);
  if (frames.length === 1) {
    const candidate = candidates[0];
    const body = candidate.candidateCount ? candidate.bounds : { x: 0, y: 0, width: 1, height: 1 };
    return {
      frames: [
        {
          body,
          feetY: body.y + body.height - 1,
          opaquePixels: candidate.opaquePixels,
          sourceFxPixels: Math.max(0, candidate.opaquePixels - candidate.candidateCount),
          confidence: candidate.candidateCount ? 0.55 : 0,
        },
      ],
      persistentPixelCount: candidate.candidateCount,
      provenance: {
        body: "single_frame_fallback",
        sourceFx: "single_frame_unverified",
        alignment: "single_frame",
      },
    };
  }
  const totalCandidatePixels = candidates.reduce((sum, candidate) => sum + candidate.candidateCount, 0);
  const sampleStep = Math.max(1, Math.ceil(Math.sqrt(totalCandidatePixels / 500_000)));
  const normalizedYSpan = height * 2 + 1;
  const normalizedXOffset = width * 2;
  const normalizedYOffset = height;
  const normalizedKey = (index, candidate) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const normalizedX2 = x * 2 - candidate.anchorX2;
    const normalizedY = y - candidate.anchorY;
    return (normalizedX2 + normalizedXOffset) * normalizedYSpan + normalizedY + normalizedYOffset;
  };
  const frequency = new Map();
  const sampledCounts = [];
  for (let frameIndex = 0; frameIndex < candidates.length; frameIndex += 1) {
    const candidate = candidates[frameIndex];
    const frame = frames[frameIndex];
    let sampled = 0;
    for (let y = candidate.region.top; y < candidate.region.bottom; y += sampleStep) {
      for (let x = candidate.region.left; x < candidate.region.right; x += sampleStep) {
        if (!visible(frame, x, y)) continue;
        const index = y * width + x;
        const key = normalizedKey(index, candidate);
        frequency.set(key, Number(frequency.get(key) || 0) + 1);
        sampled += 1;
      }
    }
    sampledCounts.push(sampled);
  }
  const threshold = frames.length === 1 ? 1 : Math.max(2, Math.ceil(frames.length * 0.5));
  let persistentPixelCount = 0;
  let persistentMinX2 = Infinity;
  let persistentMaxX2 = -Infinity;
  let persistentMinY = Infinity;
  let persistentMaxY = -Infinity;
  for (const [key, count] of frequency) {
    if (count < threshold) continue;
    persistentPixelCount += 1;
    const normalizedX2 = Math.floor(key / normalizedYSpan) - normalizedXOffset;
    const normalizedY = (key % normalizedYSpan) - normalizedYOffset;
    persistentMinX2 = Math.min(persistentMinX2, normalizedX2);
    persistentMaxX2 = Math.max(persistentMaxX2, normalizedX2);
    persistentMinY = Math.min(persistentMinY, normalizedY);
    persistentMaxY = Math.max(persistentMaxY, normalizedY);
  }
  const persistentBounds = persistentPixelCount
    ? {
        minX2: persistentMinX2,
        maxX2: persistentMaxX2,
        minY: persistentMinY,
        maxY: persistentMaxY,
      }
    : null;
  const paddingX2 = Math.max(
    4,
    Math.round(Number((persistentBounds?.maxX2 || width * 2) - (persistentBounds?.minX2 || 0) + 1) * 0.2),
  );
  const paddingY = Math.max(
    2,
    Math.round(Number((persistentBounds?.maxY || height) - (persistentBounds?.minY || 0) + 1) * 0.12),
  );
  const analyzedFrames = frames.map((frame, frameIndex) => {
    const candidate = candidates[frameIndex];
    let bodyPixelCount = 0;
    let persistentMatches = 0;
    let bodyMinX = width;
    let bodyMinY = height;
    let bodyMaxX = -1;
    let bodyMaxY = -1;
    for (let y = candidate.region.top; y < candidate.region.bottom; y += 1) {
      for (let x = candidate.region.left; x < candidate.region.right; x += 1) {
        if (!visible(frame, x, y)) continue;
        const index = y * width + x;
        const normalizedX2 = x * 2 - candidate.anchorX2;
        const normalizedY = y - candidate.anchorY;
        const key = normalizedKey(index, candidate);
        const persistentPixel = Number(frequency.get(key) || 0) >= threshold;
        const nearCore =
          persistentBounds &&
          normalizedX2 >= persistentBounds.minX2 - paddingX2 &&
          normalizedX2 <= persistentBounds.maxX2 + paddingX2 &&
          normalizedY >= persistentBounds.minY - paddingY &&
          normalizedY <= persistentBounds.maxY + paddingY;
        const transientHighlight = !persistentPixel && luma(frame, x, y) >= 185;
        if (persistentPixel || (nearCore && !transientHighlight)) {
          bodyPixelCount += 1;
          bodyMinX = Math.min(bodyMinX, x);
          bodyMinY = Math.min(bodyMinY, y);
          bodyMaxX = Math.max(bodyMaxX, x);
          bodyMaxY = Math.max(bodyMaxY, y);
          if (persistentPixel) persistentMatches += 1;
        }
      }
    }
    const body =
      bodyPixelCount > 0
        ? {
            x: bodyMinX,
            y: bodyMinY,
            width: bodyMaxX - bodyMinX + 1,
            height: bodyMaxY - bodyMinY + 1,
          }
        : candidate.candidateCount
          ? candidate.bounds
          : { x: 0, y: 0, width: 1, height: 1 };
    const overlap = persistentMatches / Math.max(1, sampledCounts[frameIndex]);
    const confidence = candidate.candidateCount
      ? frames.length > 1
        ? Math.min(1, 0.4 + overlap * 0.6)
        : 0.55
      : 0;
    return {
      body,
      feetY: body.y + body.height - 1,
      opaquePixels: candidate.opaquePixels,
      sourceFxPixels: Math.max(0, candidate.opaquePixels - bodyPixelCount),
      confidence: Math.round(confidence * 1000) / 1000,
    };
  });
  return {
    frames: analyzedFrames,
    persistentPixelCount,
    provenance: {
      body: frames.length > 1 ? "temporal_persistent_core" : "single_frame_fallback",
      sourceFx: frames.length > 1 ? "transient_highlight" : "single_frame_unverified",
      alignment: frames.length > 1 ? "feet_center_translation" : "single_frame",
    },
  };
}

function paintPixel(data, width, height, x, y, color) {
  const column = Math.round(x);
  const row = Math.round(y);
  if (column < 0 || row < 0 || column >= width || row >= height) return;
  data.set(color, (row * width + column) * 4);
}

function paintLine(data, width, height, from, to, color) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y)));
  for (let index = 0; index <= steps; index += 1) {
    const phase = index / steps;
    paintPixel(
      data,
      width,
      height,
      from.x + (to.x - from.x) * phase,
      from.y + (to.y - from.y) * phase,
      color,
    );
  }
}

/**
 * Paints saved group-coordinate boxes onto a detached RGBA review frame.
 * @param {{data:Uint8ClampedArray|Uint8Array,width:number,height:number}} frame Source frame.
 * @param {object} boxes Frame boxes.
 * @param {string} [anchorMode] Canvas anchor mode.
 * @returns {{data:Uint8ClampedArray,width:number,height:number}} Review frame.
 */
function renderBoxReviewFrame(frame, boxes, anchorMode = "canvas_bottom_center") {
  const data = new Uint8ClampedArray(frame.data);
  const anchor = {
    x: anchorMode === "canvas_left_bottom" ? 0 : frame.width / 2,
    y: frame.height,
  };
  const colors = {
    hurtbox: [46, 204, 113, 255],
    collisionbox: [52, 152, 219, 255],
    hitbox: [231, 76, 60, 255],
  };
  for (const [name, color] of Object.entries(colors)) {
    const box = boxes?.[name];
    if (!box?.size || !box?.offset) continue;
    const center = { x: anchor.x + Number(box.offset.x || 0), y: anchor.y + Number(box.offset.y || 0) };
    const halfX = Number(box.size.x || 0) / 2;
    const halfY = Number(box.size.y || 0) / 2;
    const radians = (Number(box.rotation || 0) * Math.PI) / 180;
    const rotate = (x, y) => ({
      x: center.x + x * Math.cos(radians) - y * Math.sin(radians),
      y: center.y + x * Math.sin(radians) + y * Math.cos(radians),
    });
    const corners = [
      rotate(-halfX, -halfY),
      rotate(halfX, -halfY),
      rotate(halfX, halfY),
      rotate(-halfX, halfY),
    ];
    const ink = box.enabled === false ? [color[0], color[1], color[2], 120] : color;
    for (let index = 0; index < corners.length; index += 1) {
      paintLine(data, frame.width, frame.height, corners[index], corners[(index + 1) % 4], ink);
    }
  }
  return { data, width: frame.width, height: frame.height };
}

module.exports = { ALPHA_VISIBLE, analyzeFrameSequence, renderBoxReviewFrame };
