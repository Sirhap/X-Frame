(function attachCutoutQualityCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CutoutQualityCore = api;
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
   * Summarizes the visible alpha plane for batch-quality analysis.
   * @param {Uint8ClampedArray|Uint8Array} data RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {{
   *   backgroundColors?:Array<{r:number,g:number,b:number}>,
   *   backgroundTolerance?:number
   * }} [options] Optional background references for residual-color detection.
   * @returns {{
   *   width:number,
   *   height:number,
   *   alphaArea:number,
   *   visiblePixels:number,
   *   partialPixels:number,
   *   partialRatio:number,
   *   edgePixels:number,
   *   softEdgePixels:number,
   *   softEdgeRatio:number,
   *   componentCount:number,
   *   secondaryComponentRatio:number,
   *   holePixels:number,
   *   holeRatio:number,
   *   clippedEdgeRatio:number,
   *   transparentRgbRatio:number,
   *   residualBackgroundRatio:number,
   *   coverage:number,
   *   center:{x:number,y:number}|null,
   *   bounds:{x:number,y:number,width:number,height:number}|null
   * }|null}
   */
  function createCutoutQualityMetrics(data, width, height, options = {}) {
    const pixelCount = width * height;
    if (width <= 0 || height <= 0 || !data || data.length !== pixelCount * 4) return null;
    const visible = new Uint8Array(pixelCount);
    let alphaArea = 0;
    let visiblePixels = 0;
    let partialPixels = 0;
    let weightedX = 0;
    let weightedY = 0;
    let minimumX = width;
    let minimumY = height;
    let maximumX = -1;
    let maximumY = -1;
    let residualBackgroundPixels = 0;
    const backgroundColors = Array.isArray(options.backgroundColors)
      ? options.backgroundColors
      : [];
    const backgroundThresholdSquared = (
      Math.max(0, Number(options.backgroundTolerance ?? 12)) * 5.1
    ) ** 2;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        const offset = pixel * 4;
        const alpha = data[offset + 3];
        if (alpha === 0) continue;
        const weight = alpha / 255;
        visible[pixel] = 1;
        alphaArea += weight;
        visiblePixels += 1;
        if (alpha < 255) partialPixels += 1;
        weightedX += x * weight;
        weightedY += y * weight;
        minimumX = Math.min(minimumX, x);
        minimumY = Math.min(minimumY, y);
        maximumX = Math.max(maximumX, x);
        maximumY = Math.max(maximumY, y);
        if (backgroundColors.some((color) => {
          const deltaR = data[offset] - Number(color?.r || 0);
          const deltaG = data[offset + 1] - Number(color?.g || 0);
          const deltaB = data[offset + 2] - Number(color?.b || 0);
          return deltaR * deltaR + deltaG * deltaG + deltaB * deltaB
            <= backgroundThresholdSquared;
        })) residualBackgroundPixels += 1;
      }
    }
    let edgePixels = 0;
    let softEdgePixels = 0;
    let clippedEdgePixels = 0;
    let transparentEdgePixels = 0;
    let transparentRgbPixels = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        if (!visible[pixel]) continue;
        const edge = (
          x === 0
          || x + 1 === width
          || y === 0
          || y + 1 === height
          || !visible[pixel - 1]
          || !visible[pixel + 1]
          || !visible[pixel - width]
          || !visible[pixel + width]
        );
        if (!edge) continue;
        edgePixels += 1;
        if (x === 0 || x + 1 === width || y === 0 || y + 1 === height) clippedEdgePixels += 1;
        if (data[pixel * 4 + 3] < 250) softEdgePixels += 1;
      }
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        if (visible[pixel]) continue;
        const touchesSubject = (
          (x > 0 && visible[pixel - 1])
          || (x + 1 < width && visible[pixel + 1])
          || (y > 0 && visible[pixel - width])
          || (y + 1 < height && visible[pixel + width])
        );
        if (!touchesSubject) continue;
        transparentEdgePixels += 1;
        const offset = pixel * 4;
        if (data[offset] > 3 || data[offset + 1] > 3 || data[offset + 2] > 3) {
          transparentRgbPixels += 1;
        }
      }
    }
    const visitedVisible = new Uint8Array(pixelCount);
    const queue = new Int32Array(pixelCount);
    const componentSizes = [];
    for (let origin = 0; origin < pixelCount; origin += 1) {
      if (!visible[origin] || visitedVisible[origin]) continue;
      let head = 0;
      let tail = 0;
      let componentSize = 0;
      queue[tail++] = origin;
      visitedVisible[origin] = 1;
      while (head < tail) {
        const pixel = queue[head++];
        componentSize += 1;
        const x = pixel % width;
        const neighbors = [
          x > 0 ? pixel - 1 : -1,
          x + 1 < width ? pixel + 1 : -1,
          pixel >= width ? pixel - width : -1,
          pixel + width < pixelCount ? pixel + width : -1,
        ];
        for (const neighbor of neighbors) {
          if (neighbor < 0 || !visible[neighbor] || visitedVisible[neighbor]) continue;
          visitedVisible[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      }
      componentSizes.push(componentSize);
    }
    componentSizes.sort((left, right) => right - left);
    const significantComponentMinimum = Math.max(2, Math.ceil(visiblePixels * 0.01));
    const componentCount = componentSizes.filter(
      (componentSize) => componentSize >= significantComponentMinimum,
    ).length;
    const largestComponent = componentSizes[0] || 0;
    const exteriorTransparent = new Uint8Array(pixelCount);
    let transparentHead = 0;
    let transparentTail = 0;
    const enqueueTransparent = (pixel) => {
      if (pixel < 0 || visible[pixel] || exteriorTransparent[pixel]) return;
      exteriorTransparent[pixel] = 1;
      queue[transparentTail++] = pixel;
    };
    for (let x = 0; x < width; x += 1) {
      enqueueTransparent(x);
      enqueueTransparent((height - 1) * width + x);
    }
    for (let y = 0; y < height; y += 1) {
      enqueueTransparent(y * width);
      enqueueTransparent(y * width + width - 1);
    }
    while (transparentHead < transparentTail) {
      const pixel = queue[transparentHead++];
      const x = pixel % width;
      enqueueTransparent(x > 0 ? pixel - 1 : -1);
      enqueueTransparent(x + 1 < width ? pixel + 1 : -1);
      enqueueTransparent(pixel >= width ? pixel - width : -1);
      enqueueTransparent(pixel + width < pixelCount ? pixel + width : -1);
    }
    let holePixels = 0;
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      if (!visible[pixel] && !exteriorTransparent[pixel]) holePixels += 1;
    }
    return {
      width,
      height,
      alphaArea,
      visiblePixels,
      partialPixels,
      partialRatio: visiblePixels ? partialPixels / visiblePixels : 0,
      edgePixels,
      softEdgePixels,
      softEdgeRatio: edgePixels ? softEdgePixels / edgePixels : 0,
      componentCount,
      secondaryComponentRatio: visiblePixels
        ? Math.max(0, visiblePixels - largestComponent) / visiblePixels
        : 0,
      holePixels,
      holeRatio: visiblePixels ? holePixels / visiblePixels : 0,
      clippedEdgeRatio: edgePixels ? clippedEdgePixels / edgePixels : 0,
      transparentRgbRatio: transparentEdgePixels
        ? transparentRgbPixels / transparentEdgePixels
        : 0,
      residualBackgroundRatio: visiblePixels ? residualBackgroundPixels / visiblePixels : 0,
      coverage: alphaArea / pixelCount,
      center: alphaArea > 0 ? { x: weightedX / alphaArea, y: weightedY / alphaArea } : null,
      bounds: visiblePixels ? {
        x: minimumX,
        y: minimumY,
        width: maximumX - minimumX + 1,
        height: maximumY - minimumY + 1,
      } : null,
    };
  }

  /**
   * Finds the nearest available metric before or after an index.
   * @param {Array<object|null>} metrics Quality metric sequence.
   * @param {number} index Origin index.
   * @param {-1|1} direction Search direction.
   * @param {boolean} [circular=false] Whether search wraps around the sequence.
   * @returns {object|null}
   */
  function nearestQualityMetric(metrics, index, direction, circular = false) {
    for (let offset = 1; offset < metrics.length; offset += 1) {
      const rawIndex = index + direction * offset;
      if (!circular && (rawIndex < 0 || rawIndex >= metrics.length)) break;
      const candidateIndex = (rawIndex + metrics.length) % metrics.length;
      const candidate = metrics[candidateIndex];
      if (candidate?.center && candidate.alphaArea > 0) return candidate;
    }
    return null;
  }

  /**
   * Detects structural defects and circular frame-to-frame quality changes.
   * @param {Array<object|null>} metrics Quality metrics in frame order.
   * @param {{
   *   emptyArea?:number,
   *   areaWarning?:number,
   *   areaCritical?:number,
   *   positionWarning?:number,
   *   positionCritical?:number,
   *   softEdgeMinimum?:number,
   *   softEdgeDelta?:number,
   *   splitRatio?:number,
   *   holeRatio?:number,
   *   clippedEdgeRatio?:number,
   *   transparentRgbRatio?:number,
   *   residualBackgroundRatio?:number,
   *   circular?:boolean
   * }} [options] Optional sensitivity overrides.
   * @returns {Array<{
   *   severity:"pending"|"ok"|"warning"|"critical",
   *   codes:Array<"empty"|"area"|"position"|"soft-edge"|"split"|"holes"|"clipped"|"transparent-rgb"|"background-residue">,
   *   score:number,
   *   details:{areaDeviation:number,positionDeviation:number,softEdgeDeviation:number}
   * }>}
   */
  function analyzeCutoutQualitySequence(metrics, options = {}) {
    const settings = {
      emptyArea: Number(options.emptyArea ?? 4),
      areaWarning: Number(options.areaWarning ?? 0.32),
      areaCritical: Number(options.areaCritical ?? 0.62),
      positionWarning: Number(options.positionWarning ?? 0.22),
      positionCritical: Number(options.positionCritical ?? 0.4),
      softEdgeMinimum: Number(options.softEdgeMinimum ?? 0.48),
      softEdgeDelta: Number(options.softEdgeDelta ?? 0.18),
      splitRatio: Number(options.splitRatio ?? 0.08),
      holeRatio: Number(options.holeRatio ?? 0.04),
      clippedEdgeRatio: Number(options.clippedEdgeRatio ?? 0.18),
      transparentRgbRatio: Number(options.transparentRgbRatio ?? 0.5),
      residualBackgroundRatio: Number(options.residualBackgroundRatio ?? 0.08),
      circular: options.circular !== false,
    };
    return metrics.map((metric, index) => {
      const result = {
        severity: metric ? "ok" : "pending",
        codes: [],
        score: 0,
        details: {
          areaDeviation: 0,
          positionDeviation: 0,
          softEdgeDeviation: 0,
        },
      };
      if (!metric) return result;
      if (metric.alphaArea < settings.emptyArea || !metric.center) {
        result.severity = "critical";
        result.codes.push("empty");
        result.score = 100;
        return result;
      }
      const structuralChecks = [
        [metric.componentCount > 1 && metric.secondaryComponentRatio > settings.splitRatio, "split", "critical"],
        [metric.holeRatio > settings.holeRatio, "holes", "warning"],
        [metric.clippedEdgeRatio > settings.clippedEdgeRatio, "clipped", "warning"],
        [metric.transparentRgbRatio > settings.transparentRgbRatio, "transparent-rgb", "warning"],
        [metric.residualBackgroundRatio > settings.residualBackgroundRatio, "background-residue", "warning"],
      ];
      for (const [failed, code, severity] of structuralChecks) {
        if (!failed) continue;
        result.codes.push(code);
        result.score = Math.max(result.score, severity === "critical" ? 90 : 60);
        if (severity === "critical" || result.severity === "ok") result.severity = severity;
      }
      if (metrics.length < 3) return result;
      const previous = nearestQualityMetric(metrics, index, -1, settings.circular);
      const next = nearestQualityMetric(metrics, index, 1, settings.circular);
      if (!previous || !next) return result;
      const expectedArea = Math.sqrt(
        Math.max(1, previous.alphaArea) * Math.max(1, next.alphaArea),
      );
      const areaDeviation = Math.min(
        Math.abs(Math.log(Math.max(1, metric.alphaArea) / Math.max(1, previous.alphaArea))),
        Math.abs(Math.log(Math.max(1, metric.alphaArea) / Math.max(1, next.alphaArea))),
      );
      result.details.areaDeviation = areaDeviation;
      if (areaDeviation > settings.areaWarning) {
        result.codes.push("area");
        result.score = Math.max(
          result.score,
          clamp(areaDeviation / settings.areaCritical, 0, 1) * 100,
        );
        result.severity = areaDeviation > settings.areaCritical ? "critical" : "warning";
      }
      const subjectScale = Math.max(12, Math.sqrt(expectedArea));
      const positionDeviation = Math.min(
        Math.hypot(
          metric.center.x - previous.center.x,
          metric.center.y - previous.center.y,
        ),
        Math.hypot(
          metric.center.x - next.center.x,
          metric.center.y - next.center.y,
        ),
      ) / subjectScale;
      result.details.positionDeviation = positionDeviation;
      if (positionDeviation > settings.positionWarning) {
        result.codes.push("position");
        result.score = Math.max(
          result.score,
          clamp(positionDeviation / settings.positionCritical, 0, 1) * 100,
        );
        if (positionDeviation > settings.positionCritical) result.severity = "critical";
        else if (result.severity === "ok") result.severity = "warning";
      }
      const softEdgeDeviation = Math.min(
        metric.softEdgeRatio - previous.softEdgeRatio,
        metric.softEdgeRatio - next.softEdgeRatio,
      );
      result.details.softEdgeDeviation = softEdgeDeviation;
      if (
        metric.softEdgeRatio > settings.softEdgeMinimum
        && softEdgeDeviation > settings.softEdgeDelta
      ) {
        result.codes.push("soft-edge");
        result.score = Math.max(
          result.score,
          clamp(
            softEdgeDeviation / Math.max(settings.softEdgeDelta * 2, 0.01),
            0,
            1,
          ) * 100,
        );
        if (result.severity === "ok") result.severity = "warning";
      }
      return result;
    });
  }

  return {
    analyzeCutoutQualitySequence,
    createCutoutQualityMetrics,
  };
}));
