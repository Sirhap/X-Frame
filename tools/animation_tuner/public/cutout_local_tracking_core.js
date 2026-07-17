(function attachCutoutLocalTrackingCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CutoutLocalTrackingCore = api;
}(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  /**
   * Keeps a number inside an inclusive range.
   * @param {number} value Candidate value.
   * @param {number} minimum Inclusive minimum.
   * @param {number} maximum Inclusive maximum.
   * @returns {number}
   */
  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number(value || 0)));
  }

  /**
   * Returns the RGBA offset for an in-bounds point.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {number} x Pixel X coordinate.
   * @param {number} y Pixel Y coordinate.
   * @returns {number} RGBA offset, or -1 when outside the image.
   */
  function pixelOffset(width, height, x, y) {
    const roundedX = Math.round(x);
    const roundedY = Math.round(y);
    if (roundedX < 0 || roundedX >= width || roundedY < 0 || roundedY >= height) return -1;
    return (roundedY * width + roundedX) * 4;
  }

  /**
   * Captures a compact RGBA template around a repair point before the repair changes it.
   * @param {Uint8ClampedArray|Uint8Array} data Source RGBA pixels.
   * @param {number} width Source width.
   * @param {number} height Source height.
   * @param {{x:number,y:number}} point Source anchor point.
   * @param {{radius?:number}} [options] Template options.
   * @returns {{point:{x:number,y:number},sourceWidth:number,sourceHeight:number,radius:number,size:number,data:Uint8ClampedArray,valid:Uint8Array}|null}
   */
  function createLocalAnchor(data, width, height, point, options = {}) {
    if (!data || data.length !== width * height * 4 || width <= 0 || height <= 0) return null;
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
    const radius = Math.round(clamp(
      options.radius ?? Math.round(Math.min(width, height) * 0.0125),
      5,
      14,
    ));
    const size = radius * 2 + 1;
    const pixels = new Uint8ClampedArray(size * size * 4);
    const valid = new Uint8Array(size * size);
    for (let localY = -radius; localY <= radius; localY += 1) {
      for (let localX = -radius; localX <= radius; localX += 1) {
        const patchIndex = (localY + radius) * size + localX + radius;
        const sourceOffset = pixelOffset(width, height, point.x + localX, point.y + localY);
        if (sourceOffset < 0) continue;
        valid[patchIndex] = 1;
        pixels.set(data.subarray(sourceOffset, sourceOffset + 4), patchIndex * 4);
      }
    }
    return {
      point: { x: Number(point.x), y: Number(point.y) },
      sourceWidth: width,
      sourceHeight: height,
      radius,
      size,
      data: pixels,
      valid,
    };
  }

  /**
   * Scores a target point against a captured local template.
   * Alpha layout carries most of the weight so enclosed transparent gaps such as
   * an armpit remain distinguishable from similarly colored body pixels.
   * @param {ReturnType<typeof createLocalAnchor>} anchor Captured local template.
   * @param {Uint8ClampedArray|Uint8Array} targetData Target RGBA pixels.
   * @param {number} targetWidth Target width.
   * @param {number} targetHeight Target height.
   * @param {{x:number,y:number}} candidate Candidate target point.
   * @param {number} sampleStep Patch sampling step.
   * @returns {number} Normalized error where lower is better.
   */
  function localAnchorError(
    anchor,
    targetData,
    targetWidth,
    targetHeight,
    candidate,
    sampleStep,
  ) {
    const scaleX = targetWidth / Math.max(1, anchor.sourceWidth);
    const scaleY = targetHeight / Math.max(1, anchor.sourceHeight);
    let weightedError = 0;
    let totalWeight = 0;
    for (let localY = -anchor.radius; localY <= anchor.radius; localY += sampleStep) {
      for (let localX = -anchor.radius; localX <= anchor.radius; localX += sampleStep) {
        const patchIndex = (localY + anchor.radius) * anchor.size + localX + anchor.radius;
        if (!anchor.valid[patchIndex]) continue;
        const targetOffset = pixelOffset(
          targetWidth,
          targetHeight,
          candidate.x + localX * scaleX,
          candidate.y + localY * scaleY,
        );
        if (targetOffset < 0) {
          weightedError += 1.25;
          totalWeight += 1;
          continue;
        }
        const sourceOffset = patchIndex * 4;
        const sourceAlpha = anchor.data[sourceOffset + 3];
        const targetAlpha = targetData[targetOffset + 3];
        const alphaError = Math.abs(sourceAlpha - targetAlpha) / 255;
        const colorVisible = Math.max(sourceAlpha, targetAlpha) > 24;
        const colorError = colorVisible
          ? (
            Math.abs(anchor.data[sourceOffset] - targetData[targetOffset])
            + Math.abs(anchor.data[sourceOffset + 1] - targetData[targetOffset + 1])
            + Math.abs(anchor.data[sourceOffset + 2] - targetData[targetOffset + 2])
          ) / 765
          : 0;
        const alphaWeight = colorVisible ? 0.62 : 1;
        const colorWeight = colorVisible ? 0.38 : 0;
        weightedError += alphaError * alphaWeight + colorError * colorWeight;
        totalWeight += 1;
      }
    }
    return totalWeight ? weightedError / totalWeight : Number.POSITIVE_INFINITY;
  }

  /**
   * Locates a local template near a subject-pose prediction using coarse-to-fine search.
   * @param {ReturnType<typeof createLocalAnchor>} anchor Captured source template.
   * @param {Uint8ClampedArray|Uint8Array} targetData Target RGBA pixels.
   * @param {number} targetWidth Target width.
   * @param {number} targetHeight Target height.
   * @param {{x:number,y:number}} predictedPoint Coarse subject-relative prediction.
   * @param {{searchRadius?:number,maximumError?:number,minimumMargin?:number}} [options] Search gates.
   * @returns {{point:{x:number,y:number},matched:boolean,error:number,confidence:number,margin:number,searchRadius:number}|null}
   */
  function trackLocalAnchor(
    anchor,
    targetData,
    targetWidth,
    targetHeight,
    predictedPoint,
    options = {},
  ) {
    if (!anchor || !targetData || targetData.length !== targetWidth * targetHeight * 4) return null;
    if (!Number.isFinite(predictedPoint?.x) || !Number.isFinite(predictedPoint?.y)) return null;
    const searchRadius = Math.round(clamp(
      options.searchRadius ?? Math.min(targetWidth, targetHeight) * 0.1,
      24,
      96,
    ));
    const maximumError = clamp(options.maximumError ?? 0.34, 0.05, 1);
    const minimumMargin = clamp(options.minimumMargin ?? 0.008, 0, 0.25);
    const centerPatchIndex = (anchor.radius * anchor.size + anchor.radius) * 4;
    const sourceTransparent = anchor.data[centerPatchIndex + 3] <= 24;
    const coarseStep = searchRadius >= 48 ? 3 : 2;
    const candidates = [];
    const predictedX = clamp(predictedPoint.x, 0, targetWidth - 1);
    const predictedY = clamp(predictedPoint.y, 0, targetHeight - 1);
    const evaluate = (x, y, sampleStep) => {
      const targetOffset = pixelOffset(targetWidth, targetHeight, x, y);
      if (targetOffset < 0) return;
      const targetTransparent = targetData[targetOffset + 3] <= 24;
      if (sourceTransparent !== targetTransparent) return;
      const textureError = localAnchorError(
        anchor,
        targetData,
        targetWidth,
        targetHeight,
        { x, y },
        sampleStep,
      );
      const spatialPenalty = Math.hypot(x - predictedX, y - predictedY)
        / Math.max(1, searchRadius) * 0.045;
      candidates.push({ x, y, error: textureError + spatialPenalty });
    };
    for (let y = Math.round(predictedY - searchRadius); y <= predictedY + searchRadius; y += coarseStep) {
      for (let x = Math.round(predictedX - searchRadius); x <= predictedX + searchRadius; x += coarseStep) {
        if (Math.hypot(x - predictedX, y - predictedY) > searchRadius) continue;
        evaluate(x, y, 3);
      }
    }
    if (!candidates.length) return null;
    candidates.sort((left, right) => left.error - right.error);
    const coarseBest = candidates[0];
    const refined = [];
    for (let y = coarseBest.y - coarseStep * 2; y <= coarseBest.y + coarseStep * 2; y += 1) {
      for (let x = coarseBest.x - coarseStep * 2; x <= coarseBest.x + coarseStep * 2; x += 1) {
        const targetOffset = pixelOffset(targetWidth, targetHeight, x, y);
        if (targetOffset < 0) continue;
        const targetTransparent = targetData[targetOffset + 3] <= 24;
        if (sourceTransparent !== targetTransparent) continue;
        const textureError = localAnchorError(
          anchor,
          targetData,
          targetWidth,
          targetHeight,
          { x, y },
          1,
        );
        const spatialPenalty = Math.hypot(x - predictedX, y - predictedY)
          / Math.max(1, searchRadius) * 0.045;
        refined.push({ x, y, error: textureError + spatialPenalty });
      }
    }
    refined.sort((left, right) => left.error - right.error);
    const best = refined[0] || coarseBest;
    const ambiguityDistance = Math.max(3, anchor.radius * 0.75);
    const alternate = candidates.find((candidate) => (
      Math.hypot(candidate.x - best.x, candidate.y - best.y) >= ambiguityDistance
    ));
    const margin = alternate ? Math.max(0, alternate.error - best.error) : 1;
    const matched = best.error <= maximumError && (
      margin >= minimumMargin || best.error <= Math.min(0.08, maximumError * 0.35)
    );
    return {
      point: { x: best.x, y: best.y },
      matched,
      error: best.error,
      confidence: clamp(1 - best.error / maximumError, 0, 1),
      margin,
      searchRadius,
    };
  }

  /**
   * Measures a connected color/alpha region using the same matching model as fill.
   * @param {Uint8ClampedArray|Uint8Array} data RGBA pixels before the repair.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {{x:number,y:number}} point Seed point.
   * @param {{sourceColor?:{r:number,g:number,b:number,a?:number},tolerance?:number,maximumPixels?:number}} [options] Region options.
   * @returns {{count:number,touchesBoundary:boolean,truncated:boolean,imageWidth:number,imageHeight:number,center:{x:number,y:number},bounds:{x1:number,y1:number,x2:number,y2:number}}|null}
   */
  function measureConnectedRegion(data, width, height, point, options = {}) {
    if (!data || data.length !== width * height * 4 || width <= 0 || height <= 0) return null;
    const seedX = Math.round(clamp(point?.x, 0, width - 1));
    const seedY = Math.round(clamp(point?.y, 0, height - 1));
    const seedOffset = (seedY * width + seedX) * 4;
    const sampled = options.sourceColor || {
      r: data[seedOffset],
      g: data[seedOffset + 1],
      b: data[seedOffset + 2],
      a: data[seedOffset + 3],
    };
    const tolerance = clamp(options.tolerance ?? 18, 0, 100);
    const alphaTolerance = Math.max(12, Math.round(tolerance * 2.55));
    const maximumPixels = Math.max(1, Math.round(options.maximumPixels ?? width * height));
    const matches = (index) => {
      const offset = index * 4;
      const alpha = data[offset + 3];
      if (Number(sampled.a ?? 255) <= 16) return alpha <= Math.max(16, alphaTolerance);
      const colorDistance = Math.hypot(
        data[offset] - sampled.r,
        data[offset + 1] - sampled.g,
        data[offset + 2] - sampled.b,
      );
      return Math.abs(alpha - Number(sampled.a ?? 255)) <= alphaTolerance
        && colorDistance <= tolerance;
    };
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let head = 0;
    let tail = 1;
    let count = 0;
    let touchesBoundary = false;
    let minimumX = seedX;
    let maximumX = seedX;
    let minimumY = seedY;
    let maximumY = seedY;
    let sumX = 0;
    let sumY = 0;
    queue[0] = seedY * width + seedX;
    visited[queue[0]] = 1;
    while (head < tail) {
      const index = queue[head];
      head += 1;
      if (!matches(index)) continue;
      const x = index % width;
      const y = Math.floor(index / width);
      count += 1;
      sumX += x;
      sumY += y;
      minimumX = Math.min(minimumX, x);
      maximumX = Math.max(maximumX, x);
      minimumY = Math.min(minimumY, y);
      maximumY = Math.max(maximumY, y);
      touchesBoundary ||= x === 0 || y === 0 || x + 1 === width || y + 1 === height;
      if (count >= maximumPixels) {
        return {
          count,
          touchesBoundary,
          truncated: head < tail,
          imageWidth: width,
          imageHeight: height,
          center: { x: sumX / count, y: sumY / count },
          bounds: { x1: minimumX, y1: minimumY, x2: maximumX, y2: maximumY },
        };
      }
      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || visited[neighbor]) continue;
        visited[neighbor] = 1;
        queue[tail] = neighbor;
        tail += 1;
      }
    }
    return {
      count,
      touchesBoundary,
      truncated: false,
      imageWidth: width,
      imageHeight: height,
      center: { x: sumX / Math.max(1, count), y: sumY / Math.max(1, count) },
      bounds: { x1: minimumX, y1: minimumY, x2: maximumX, y2: maximumY },
    };
  }

  /**
   * Finds the enclosed transparent component corresponding to a source fill region.
   * Component topology is more reliable than texture when the clicked hole is uniformly transparent.
   * @param {Uint8ClampedArray|Uint8Array} data Target RGBA pixels.
   * @param {number} width Target width.
   * @param {number} height Target height.
   * @param {ReturnType<typeof measureConnectedRegion>} sourceRegion Source connected region.
   * @param {{x:number,y:number}} predictedPoint Subject-relative target prediction.
   * @param {{tolerance?:number,searchRadius?:number}} [options] Matching options.
   * @returns {{point:{x:number,y:number},region:ReturnType<typeof measureConnectedRegion>,score:number,confidence:number}|null}
   */
  function findMatchingTransparentRegion(
    data,
    width,
    height,
    sourceRegion,
    predictedPoint,
    options = {},
  ) {
    if (!data || data.length !== width * height * 4 || !sourceRegion?.count) return null;
    if (sourceRegion.touchesBoundary || sourceRegion.truncated) return null;
    const alphaThreshold = Math.max(16, Math.round(clamp(options.tolerance ?? 18, 0, 100) * 2.55));
    const searchRadius = clamp(
      options.searchRadius ?? Math.min(width, height) * 0.2,
      48,
      180,
    );
    const predictedX = clamp(predictedPoint?.x, 0, width - 1);
    const predictedY = clamp(predictedPoint?.y, 0, height - 1);
    const sourceImageArea = Math.max(
      1,
      Number(sourceRegion.imageWidth || width) * Number(sourceRegion.imageHeight || height),
    );
    const expectedCount = sourceRegion.count * (width * height) / sourceImageArea;
    const sourceBoundsWidth = Math.max(1, sourceRegion.bounds.x2 - sourceRegion.bounds.x1 + 1);
    const sourceBoundsHeight = Math.max(1, sourceRegion.bounds.y2 - sourceRegion.bounds.y1 + 1);
    const sourceAspect = sourceBoundsWidth / sourceBoundsHeight;
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let best = null;
    for (let start = 0; start < width * height; start += 1) {
      if (visited[start] || data[start * 4 + 3] > alphaThreshold) continue;
      let head = 0;
      let tail = 1;
      let count = 0;
      let touchesBoundary = false;
      let minimumX = width;
      let maximumX = 0;
      let minimumY = height;
      let maximumY = 0;
      let sumX = 0;
      let sumY = 0;
      let nearestPoint = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      queue[0] = start;
      visited[start] = 1;
      while (head < tail) {
        const index = queue[head];
        head += 1;
        const x = index % width;
        const y = Math.floor(index / width);
        count += 1;
        sumX += x;
        sumY += y;
        minimumX = Math.min(minimumX, x);
        maximumX = Math.max(maximumX, x);
        minimumY = Math.min(minimumY, y);
        maximumY = Math.max(maximumY, y);
        touchesBoundary ||= x === 0 || y === 0 || x + 1 === width || y + 1 === height;
        const distance = Math.hypot(x - predictedX, y - predictedY);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestPoint = { x, y };
        }
        const neighbors = [
          x > 0 ? index - 1 : -1,
          x + 1 < width ? index + 1 : -1,
          y > 0 ? index - width : -1,
          y + 1 < height ? index + width : -1,
        ];
        for (const neighbor of neighbors) {
          if (
            neighbor < 0
            || visited[neighbor]
            || data[neighbor * 4 + 3] > alphaThreshold
          ) {
            continue;
          }
          visited[neighbor] = 1;
          queue[tail] = neighbor;
          tail += 1;
        }
      }
      if (touchesBoundary || count < 4 || nearestDistance > searchRadius) continue;
      const areaRatio = count / Math.max(1, expectedCount);
      if (areaRatio < 0.05 || areaRatio > 12) continue;
      const targetAspect = Math.max(1, maximumX - minimumX + 1)
        / Math.max(1, maximumY - minimumY + 1);
      const aspectError = Math.abs(Math.log(Math.max(0.001, targetAspect / sourceAspect)));
      if (aspectError > 2.5) continue;
      const areaError = Math.abs(Math.log(Math.max(0.001, areaRatio)));
      const score = nearestDistance / searchRadius * 0.55 + areaError * 0.3 + aspectError * 0.15;
      if (best && score >= best.score) continue;
      best = {
        point: nearestPoint,
        region: {
          count,
          touchesBoundary: false,
          truncated: false,
          imageWidth: width,
          imageHeight: height,
          center: { x: sumX / count, y: sumY / count },
          bounds: { x1: minimumX, y1: minimumY, x2: maximumX, y2: maximumY },
        },
        score,
        confidence: clamp(1 - score / 2.5, 0, 1),
      };
    }
    return best;
  }

  /**
   * Rejects propagated fills that change topology or expand far beyond the source region.
   * @param {ReturnType<typeof measureConnectedRegion>} sourceRegion Source-frame region.
   * @param {ReturnType<typeof measureConnectedRegion>} targetRegion Target-frame region.
   * @returns {{accepted:boolean,reason:"ok"|"missing"|"boundary"|"size"}}
   */
  function compareConnectedRegions(sourceRegion, targetRegion) {
    if (!sourceRegion || !targetRegion || !sourceRegion.count || !targetRegion.count) {
      return { accepted: false, reason: "missing" };
    }
    if (!sourceRegion.touchesBoundary && targetRegion.touchesBoundary) {
      return { accepted: false, reason: "boundary" };
    }
    const maximumCount = Math.max(sourceRegion.count * 6, sourceRegion.count + 256);
    const minimumCount = Math.max(1, Math.floor(sourceRegion.count * 0.08));
    if (targetRegion.truncated || targetRegion.count > maximumCount || targetRegion.count < minimumCount) {
      return { accepted: false, reason: "size" };
    }
    return { accepted: true, reason: "ok" };
  }

  return {
    compareConnectedRegions,
    createLocalAnchor,
    findMatchingTransparentRegion,
    measureConnectedRegion,
    trackLocalAnchor,
  };
}));
