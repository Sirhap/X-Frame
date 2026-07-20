(function attachCutoutTrackingCore(root, factory) {
  const geometryCore =
    typeof module === "object" && module.exports
      ? require("./cutout_tracking_geometry_core")
      : root?.CutoutTrackingGeometryCore;
  const api = factory(geometryCore);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CutoutTrackingCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (geometryCore) => {
  "use strict";

  if (!geometryCore?.mapPoint || !geometryCore?.mapCanvasPoint) {
    throw new Error("CutoutTrackingGeometryCore is required.");
  }

  const { mapCanvasBrushStroke, mapCanvasPoint, mapCanvasRectangle, mapBrushStroke, mapPoint, mapRectangle } =
    geometryCore;

  const REFERENCE_PI = 3.141593;
  const REFERENCE_FOUR_PI = 12.566371;

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
   * Rebuilds the reference `fp_kernel_05` local PCA frame for a binary mask.
   * @param {Uint8Array|Uint8ClampedArray} mask Non-zero pixels belong to the subject.
   * @param {number} width Mask width.
   * @param {number} height Mask height.
   * @param {{ux:number,uy:number}|null} [previousFrame=null] Optional prior direction.
   * @returns {{ux:number,uy:number,vx:number,vy:number,cx:number,cy:number,majorLen:number,minorLen:number,isotropic?:boolean}|null}
   */
  function computeReferenceLocalFrame(mask, width, height, previousFrame = null) {
    const pixelCount = width * height;
    if (width <= 0 || height <= 0 || !mask || mask.length !== pixelCount) return null;
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let minimumX = Infinity;
    let maximumX = -Infinity;
    let minimumY = Infinity;
    let maximumY = -Infinity;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!mask[y * width + x]) continue;
        area += 1;
        sumX += x;
        sumY += y;
        minimumX = Math.min(minimumX, x);
        maximumX = Math.max(maximumX, x);
        minimumY = Math.min(minimumY, y);
        maximumY = Math.max(maximumY, y);
      }
    }
    if (area < 3) return null;
    const centerX = sumX / area;
    const centerY = sumY / area;
    let covarianceXX = 0;
    let covarianceXY = 0;
    let covarianceYY = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!mask[y * width + x]) continue;
        const deltaX = x - centerX;
        const deltaY = y - centerY;
        covarianceXX += deltaX * deltaX;
        covarianceXY += deltaX * deltaY;
        covarianceYY += deltaY * deltaY;
      }
    }
    const trace = covarianceXX + covarianceYY;
    const discriminant = Math.sqrt(
      Math.max(0, trace * trace - 4 * (covarianceXX * covarianceYY - covarianceXY * covarianceXY)),
    );
    const previousUx = Number(previousFrame?.ux);
    const previousUy = Number(previousFrame?.uy);
    const hasPreviousDirection = Number.isFinite(previousUx) && Number.isFinite(previousUy);
    if (trace <= 0) return null;
    if (discriminant < trace * 0.15) {
      const widthSpan = maximumX - minimumX;
      const heightSpan = maximumY - minimumY;
      if (!(widthSpan > 0) || !(heightSpan > 0)) return null;
      const horizontal = hasPreviousDirection
        ? Math.abs(previousUx) >= Math.abs(previousUy)
        : widthSpan >= heightSpan;
      let ux = horizontal ? 1 : 0;
      let uy = horizontal ? 0 : 1;
      if (hasPreviousDirection && ux * previousUx + uy * previousUy < 0) {
        ux = -ux;
        uy = -uy;
      }
      return {
        ux,
        uy,
        vx: -uy,
        vy: ux,
        cx: centerX,
        cy: centerY,
        majorLen: horizontal ? widthSpan : heightSpan,
        minorLen: horizontal ? heightSpan : widthSpan,
        isotropic: true,
      };
    }
    const largestEigenvalue = (trace + discriminant) * 0.5;
    const firstX = covarianceXY;
    const firstY = largestEigenvalue - covarianceXX;
    const secondX = largestEigenvalue - covarianceYY;
    const secondY = covarianceXY;
    const firstLength = Math.hypot(firstX, firstY);
    const secondLength = Math.hypot(secondX, secondY);
    let ux;
    let uy;
    if (firstLength >= secondLength && firstLength > Number.EPSILON) {
      ux = firstX / firstLength;
      uy = firstY / firstLength;
    } else if (secondLength > Number.EPSILON) {
      ux = secondX / secondLength;
      uy = secondY / secondLength;
    } else {
      return null;
    }
    if (hasPreviousDirection) {
      if (ux * previousUx + uy * previousUy < 0) {
        ux = -ux;
        uy = -uy;
      }
    } else if (ux < 0 || (ux === 0 && uy < 0)) {
      ux = -ux;
      uy = -uy;
    }
    const vx = -uy;
    const vy = ux;
    let minimumMajor = Infinity;
    let maximumMajor = -Infinity;
    let minimumMinor = Infinity;
    let maximumMinor = -Infinity;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!mask[y * width + x]) continue;
        const deltaX = x - centerX;
        const deltaY = y - centerY;
        const major = deltaX * ux + deltaY * uy;
        const minor = deltaX * vx + deltaY * vy;
        minimumMajor = Math.min(minimumMajor, major);
        maximumMajor = Math.max(maximumMajor, major);
        minimumMinor = Math.min(minimumMinor, minor);
        maximumMinor = Math.max(maximumMinor, minor);
      }
    }
    return {
      ux,
      uy,
      vx,
      vy,
      cx: centerX,
      cy: centerY,
      majorLen: maximumMajor - minimumMajor,
      minorLen: maximumMinor - minimumMinor,
    };
  }

  /**
   * Builds a shape descriptor from a binary visibility plane.
   * @param {Uint8Array} visible Non-zero pixels belong to the subject.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {number} area Visible pixel count.
   * @param {number} sumX Sum of visible X coordinates.
   * @param {number} sumY Sum of visible Y coordinates.
   * @returns {object|null}
   */
  function describeVisiblePixels(visible, width, height, area, sumX, sumY) {
    if (area < 16) return null;
    const localFrame = computeReferenceLocalFrame(visible, width, height);
    if (!localFrame) return null;
    const centerX = sumX / area;
    const centerY = sumY / area;
    let perimeter = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (!visible[index]) continue;
        if (x === 0 || !visible[index - 1]) perimeter += 1;
        if (x + 1 === width || !visible[index + 1]) perimeter += 1;
        if (y === 0 || !visible[index - width]) perimeter += 1;
        if (y + 1 === height || !visible[index + width]) perimeter += 1;
      }
    }
    const angle = Math.atan2(localFrame.uy, localFrame.ux);
    const majorLength = localFrame.majorLen;
    const minorLength = localFrame.minorLen;
    return {
      width,
      height,
      area,
      perimeter,
      compactness: (perimeter * perimeter) / (REFERENCE_FOUR_PI * area),
      aspectRatio: majorLength / minorLength,
      center: { x: centerX, y: centerY },
      angle,
      majorAxis: { x: localFrame.ux, y: localFrame.uy },
      minorAxis: { x: localFrame.vx, y: localFrame.vy },
      majorLength,
      minorLength,
      isotropic: localFrame.isotropic === true,
    };
  }

  /**
   * Builds a descriptor directly from one connected component without allocating a full-frame mask.
   * Component pixels are intentionally retained in traversal order; tracking only consumes the
   * resulting geometric facts and does not expose this temporary representation.
   * @param {{pixels:number[],area:number,sumX:number,sumY:number,minimumX:number,maximumX:number,minimumY:number,maximumY:number,perimeter:number}} component Connected alpha component.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @returns {object|null} Shape descriptor.
   */
  function describeConnectedComponent(component, width, height) {
    const area = Number(component?.area || 0);
    if (area < 16) return null;
    const centerX = Number(component.sumX || 0) / area;
    const centerY = Number(component.sumY || 0) / area;
    let covarianceXX = 0;
    let covarianceXY = 0;
    let covarianceYY = 0;
    for (const index of component.pixels) {
      const x = index % width;
      const y = Math.floor(index / width);
      const deltaX = x - centerX;
      const deltaY = y - centerY;
      covarianceXX += deltaX * deltaX;
      covarianceXY += deltaX * deltaY;
      covarianceYY += deltaY * deltaY;
    }
    const trace = covarianceXX + covarianceYY;
    if (trace <= 0) return null;
    const discriminant = Math.sqrt(
      Math.max(0, trace * trace - 4 * (covarianceXX * covarianceYY - covarianceXY * covarianceXY)),
    );
    const widthSpan = component.maximumX - component.minimumX;
    const heightSpan = component.maximumY - component.minimumY;
    let ux;
    let uy;
    let isotropic = false;
    if (discriminant < trace * 0.15) {
      if (!(widthSpan > 0) || !(heightSpan > 0)) return null;
      const horizontal = widthSpan >= heightSpan;
      ux = horizontal ? 1 : 0;
      uy = horizontal ? 0 : 1;
      const vx = -uy;
      const vy = ux;
      return {
        width,
        height,
        area,
        perimeter: component.perimeter,
        compactness: (component.perimeter * component.perimeter) / (REFERENCE_FOUR_PI * area),
        aspectRatio: (horizontal ? widthSpan : heightSpan) / (horizontal ? heightSpan : widthSpan),
        center: { x: centerX, y: centerY },
        angle: Math.atan2(uy, ux),
        majorAxis: { x: ux, y: uy },
        minorAxis: { x: vx, y: vy },
        majorLength: horizontal ? widthSpan : heightSpan,
        minorLength: horizontal ? heightSpan : widthSpan,
        isotropic: true,
      };
    }
    const largestEigenvalue = (trace + discriminant) * 0.5;
    const firstX = covarianceXY;
    const firstY = largestEigenvalue - covarianceXX;
    const secondX = largestEigenvalue - covarianceYY;
    const secondY = covarianceXY;
    const firstLength = Math.hypot(firstX, firstY);
    const secondLength = Math.hypot(secondX, secondY);
    if (firstLength >= secondLength && firstLength > Number.EPSILON) {
      ux = firstX / firstLength;
      uy = firstY / firstLength;
    } else if (secondLength > Number.EPSILON) {
      ux = secondX / secondLength;
      uy = secondY / secondLength;
    } else {
      return null;
    }
    if (ux < 0 || (ux === 0 && uy < 0)) {
      ux = -ux;
      uy = -uy;
    }
    const vx = -uy;
    const vy = ux;
    let minimumMajor = Infinity;
    let maximumMajor = -Infinity;
    let minimumMinor = Infinity;
    let maximumMinor = -Infinity;
    for (const index of component.pixels) {
      const x = index % width;
      const y = Math.floor(index / width);
      const deltaX = x - centerX;
      const deltaY = y - centerY;
      const major = deltaX * ux + deltaY * uy;
      const minor = deltaX * vx + deltaY * vy;
      minimumMajor = Math.min(minimumMajor, major);
      maximumMajor = Math.max(maximumMajor, major);
      minimumMinor = Math.min(minimumMinor, minor);
      maximumMinor = Math.max(maximumMinor, minor);
    }
    const majorLength = maximumMajor - minimumMajor;
    const minorLength = maximumMinor - minimumMinor;
    return {
      width,
      height,
      area,
      perimeter: component.perimeter,
      compactness: (component.perimeter * component.perimeter) / (REFERENCE_FOUR_PI * area),
      aspectRatio: majorLength / minorLength,
      center: { x: centerX, y: centerY },
      angle: Math.atan2(uy, ux),
      majorAxis: { x: ux, y: uy },
      minorAxis: { x: vx, y: vy },
      majorLength,
      minorLength,
      isotropic,
    };
  }

  /**
   * Applies the reference `fp_kernel_11` shape gates to precomputed statistics.
   * @param {{area:number,majorLength:number,minorLength:number,compactness?:number|null,perimeter?:number|null}} candidate Candidate statistics.
   * @param {{area:number,pcaMajor:number,pcaMinor:number,compactness?:number|null}|null} seed Seed statistics.
   * @returns {{passed:boolean,ratioA:number|null,rSeed:number|null,rCand:number|null,rSegment:string|null,ratioC:number|null,layerPassed:Array<boolean|null>,candArea:number|null,candPerimeter:number|null,candCompactness:number|null}}
   */
  function compareReferenceShapeStats(candidate, seed) {
    if (!seed) {
      return {
        passed: true,
        ratioA: null,
        rSeed: null,
        rCand: null,
        rSegment: null,
        ratioC: null,
        layerPassed: [null, null, null],
        candArea: null,
        candPerimeter: null,
        candCompactness: null,
      };
    }
    const candidateArea = Math.trunc(candidate?.area || 0);
    const candidatePerimeter = Number(candidate?.perimeter || 0);
    const candidateCompactness = Number(candidate?.compactness || 0);
    const result = {
      passed: false,
      ratioA: null,
      rSeed: null,
      rCand: null,
      rSegment: null,
      ratioC: null,
      layerPassed: [false, null, null],
      candArea: candidateArea,
      candPerimeter:
        candidatePerimeter > 0 ? Math.sqrt(candidateCompactness * 4 * REFERENCE_PI * candidateArea) : null,
      candCompactness: candidatePerimeter > 0 ? candidateCompactness : null,
    };
    if (candidateArea < 3 || candidatePerimeter <= 0) return result;
    const seedArea = Math.trunc(seed.area || 0);
    if (seedArea <= 0) return result;
    const ratioA = candidateArea / seedArea;
    result.ratioA = ratioA;
    result.layerPassed[0] = ratioA >= 0.769231 && ratioA <= 1.3;
    if (!result.layerPassed[0]) return result;
    const candidateMajor = Math.max(candidate.majorLength || 0, candidate.minorLength || 0);
    const candidateMinor = Math.min(candidate.majorLength || 0, candidate.minorLength || 0);
    if (candidateMajor <= 0) {
      result.rSegment = "degenerate";
      result.layerPassed[1] = false;
      return result;
    }
    const seedMajor = Number(seed.pcaMajor || 0);
    if (seedMajor === 0) {
      result.rSegment = "degenerate";
      result.layerPassed[1] = null;
    } else {
      const rCand = candidateMinor / candidateMajor;
      const rSeed = Number(seed.pcaMinor || 0) / seedMajor;
      result.rCand = rCand;
      result.rSeed = rSeed;
      if (rSeed < 0.15) {
        result.rSegment = "elongated";
        result.layerPassed[1] = rCand < 0.25;
      } else {
        const ratioC = rCand / rSeed;
        result.ratioC = ratioC;
        if (rSeed < 0.6) {
          result.rSegment = "mid";
          result.layerPassed[1] = ratioC >= 0.59988 && ratioC <= 1.667;
        } else {
          result.rSegment = "compact";
          result.layerPassed[1] = ratioC >= 0.69979 && ratioC <= 1.429;
        }
      }
      if (!result.layerPassed[1]) return result;
    }
    const seedCompactness = Number(seed.compactness || 0);
    if (candidateArea >= 200 && seed.compactness != null && seedCompactness !== 0) {
      const compactnessRatio = candidateCompactness / seedCompactness;
      result.ratioC = compactnessRatio;
      result.layerPassed[2] = compactnessRatio >= 0.4 && compactnessRatio <= 2.5;
      if (!result.layerPassed[2]) return result;
    }
    result.passed = true;
    return result;
  }

  /**
   * Rebuilds the reference `fp_kernel_11` output for a binary candidate mask.
   * @param {Uint8Array|Uint8ClampedArray} mask Binary candidate mask.
   * @param {number} width Mask width.
   * @param {number} height Mask height.
   * @param {{area:number,pcaMajor:number,pcaMinor:number,compactness?:number|null}|null} [seed=null] Seed statistics.
   * @returns {ReturnType<typeof compareReferenceShapeStats>}
   */
  function checkReferenceShapeMatch(mask, width, height, seed = null) {
    const pixelCount = width * height;
    if (width <= 0 || height <= 0 || !mask || mask.length !== pixelCount) {
      return compareReferenceShapeStats({ area: 0, majorLength: 0, minorLength: 0 }, seed);
    }
    if (!seed) return compareReferenceShapeStats(null, null);
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let perimeter = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (!mask[index]) continue;
        area += 1;
        sumX += x;
        sumY += y;
        if (x === 0 || !mask[index - 1]) perimeter += 1;
        if (x + 1 === width || !mask[index + 1]) perimeter += 1;
        if (y === 0 || !mask[index - width]) perimeter += 1;
        if (y + 1 === height || !mask[index + width]) perimeter += 1;
      }
    }
    const frame = area >= 3 ? computeReferenceLocalFrame(mask, width, height) : null;
    const compactness = area > 0 && perimeter > 0 ? (perimeter * perimeter) / (REFERENCE_FOUR_PI * area) : 0;
    return compareReferenceShapeStats(
      {
        area,
        majorLength: frame?.majorLen || 0,
        minorLength: frame?.minorLen || 0,
        compactness,
        perimeter,
        sumX,
        sumY,
      },
      seed,
    );
  }

  /**
   * Builds a PCA shape descriptor from visible RGBA pixels.
   * @param {Uint8ClampedArray|Uint8Array} data RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {{alphaThreshold?:number}} options Descriptor options.
   * @returns {object|null}
   */
  function createShapeDescriptor(data, width, height, options = {}) {
    const alphaThreshold = clamp(options.alphaThreshold ?? 32, 0, 255);
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    const visible = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const alpha = data[index * 4 + 3];
        if (alpha <= alphaThreshold) continue;
        visible[index] = 1;
        area += 1;
        sumX += x;
        sumY += y;
      }
    }
    return describeVisiblePixels(visible, width, height, area, sumX, sumY);
  }

  /**
   * Extracts the largest alpha-connected shape candidates.
   * @param {Uint8ClampedArray|Uint8Array} data RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {{alphaThreshold?:number,minimumArea?:number,maximumCandidates?:number}} options Candidate options.
   * @returns {Array<object>}
   */
  function createShapeCandidates(data, width, height, options = {}) {
    const alphaThreshold = clamp(options.alphaThreshold ?? 32, 0, 255);
    const minimumArea = Math.max(16, Number(options.minimumArea || 16));
    const maximumCandidates = Math.max(1, Math.min(8, Number(options.maximumCandidates || 8)));
    const pixelCount = width * height;
    const visited = new Uint8Array(pixelCount);
    const queue = new Int32Array(pixelCount);
    const components = [];
    for (let start = 0; start < pixelCount; start += 1) {
      if (visited[start] || data[start * 4 + 3] <= alphaThreshold) continue;
      let head = 0;
      let tail = 1;
      let area = 0;
      let sumX = 0;
      let sumY = 0;
      let minimumX = width;
      let maximumX = -1;
      let minimumY = height;
      let maximumY = -1;
      let perimeter = 0;
      const component = [];
      queue[0] = start;
      visited[start] = 1;
      while (head < tail) {
        const index = queue[head];
        head += 1;
        component.push(index);
        area += 1;
        const x = index % width;
        const y = Math.floor(index / width);
        sumX += x;
        sumY += y;
        minimumX = Math.min(minimumX, x);
        maximumX = Math.max(maximumX, x);
        minimumY = Math.min(minimumY, y);
        maximumY = Math.max(maximumY, y);
        const neighbors = [
          x > 0 ? index - 1 : -1,
          x + 1 < width ? index + 1 : -1,
          y > 0 ? index - width : -1,
          y + 1 < height ? index + width : -1,
        ];
        for (const neighbor of neighbors) {
          if (neighbor < 0 || data[neighbor * 4 + 3] <= alphaThreshold) {
            perimeter += 1;
            continue;
          }
          if (visited[neighbor]) continue;
          visited[neighbor] = 1;
          queue[tail] = neighbor;
          tail += 1;
        }
      }
      if (area < minimumArea) continue;
      components.push({
        pixels: component,
        area,
        sumX,
        sumY,
        minimumX,
        maximumX,
        minimumY,
        maximumY,
        perimeter,
      });
    }
    return components
      .sort((left, right) => right.area - left.area)
      .slice(0, maximumCandidates)
      .map((component) => describeConnectedComponent(component, width, height))
      .filter(Boolean);
  }

  /**
   * Scores whether two descriptors plausibly represent the same animated subject.
   * @param {object|null} source Source descriptor.
   * @param {object|null} target Target descriptor.
   * @param {object} options Matching tolerances.
   * @returns {{accepted:boolean,score:number,areaRatio:number,aspectRatio:number,compactnessRatio:number}}
   */
  function compareShapeDescriptors(source, target, options = {}) {
    if (!source || !target) {
      return {
        accepted: false,
        score: 0,
        areaRatio: 0,
        aspectRatio: 0,
        compactnessRatio: 0,
      };
    }
    const referenceMatch = compareReferenceShapeStats(target, {
      area: source.area,
      pcaMajor: source.majorLength,
      pcaMinor: source.minorLength,
      compactness: source.compactness,
    });
    const areaRatio = target.area / source.area;
    const aspectRatio = target.aspectRatio / source.aspectRatio;
    const compactnessRatio = target.compactness / source.compactness;
    const accepted =
      referenceMatch.passed &&
      areaRatio >= Number(options.areaMinimum ?? 0) &&
      areaRatio <= Number(options.areaMaximum ?? Number.POSITIVE_INFINITY) &&
      aspectRatio >= Number(options.aspectMinimum ?? 0) &&
      aspectRatio <= Number(options.aspectMaximum ?? Number.POSITIVE_INFINITY) &&
      compactnessRatio >= Number(options.compactnessMinimum ?? 0) &&
      compactnessRatio <= Number(options.compactnessMaximum ?? Number.POSITIVE_INFINITY);
    const logarithmicError =
      Math.abs(Math.log(Math.max(0.001, areaRatio))) +
      Math.abs(Math.log(Math.max(0.001, aspectRatio))) +
      Math.abs(Math.log(Math.max(0.001, compactnessRatio))) * 0.5;
    return {
      accepted,
      score: clamp(1 - logarithmicError / 2.5, 0, 1),
      areaRatio,
      aspectRatio,
      compactnessRatio,
      referenceMatch,
    };
  }

  /**
   * Creates mutable state for sequential cross-frame tracking.
   * @param {object} descriptor Initial successful descriptor.
   * @returns {{lastDescriptor:object,lastSuccessCenter:{x:number,y:number},recentDeltas:Array<object>,failureStreak:number}}
   */
  function createTrackingState(descriptor) {
    return {
      lastDescriptor: descriptor,
      lastSuccessCenter: { ...descriptor.center },
      recentDeltas: [],
      failureStreak: 0,
    };
  }

  /**
   * Predicts the next center from the latest three successful displacements.
   * @param {object} state Tracking state.
   * @param {number} steps Prediction distance in frames.
   * @returns {{x:number,y:number}}
   */
  function predictTrackingCenter(state, steps = 1) {
    const deltas = Array.isArray(state?.recentDeltas) ? state.recentDeltas.slice(-3) : [];
    if (!deltas.length) return { ...state.lastSuccessCenter };
    const average = deltas.reduce(
      (sum, delta) => ({
        x: sum.x + delta.x,
        y: sum.y + delta.y,
      }),
      { x: 0, y: 0 },
    );
    return {
      x: state.lastSuccessCenter.x + (average.x / deltas.length) * steps,
      y: state.lastSuccessCenter.y + (average.y / deltas.length) * steps,
    };
  }

  /**
   * Keeps PCA axes continuous across frames. Eigenvectors are directionless,
   * so the same pose may otherwise alternate between 0 and 180 degrees and
   * mirror every mapped repair around the subject center.
   * @param {object} reference Last accepted descriptor.
   * @param {object} candidate Newly measured descriptor.
   * @returns {object} Descriptor with stable major/minor axis directions.
   */
  function alignTrackingDescriptor(reference, candidate) {
    if (!reference?.majorAxis || !candidate?.majorAxis) return candidate;
    const aligned = {
      ...candidate,
      majorAxis: { ...candidate.majorAxis },
      minorAxis: { ...candidate.minorAxis },
    };
    if (candidate.isotropic && reference.majorAxis && reference.minorAxis) {
      aligned.majorAxis = { ...reference.majorAxis };
      aligned.minorAxis = { ...reference.minorAxis };
      aligned.angle = Number(reference.angle || 0);
      return aligned;
    }
    const directionDot =
      aligned.majorAxis.x * reference.majorAxis.x + aligned.majorAxis.y * reference.majorAxis.y;
    if (directionDot >= 0) return aligned;
    aligned.majorAxis.x *= -1;
    aligned.majorAxis.y *= -1;
    aligned.minorAxis.x *= -1;
    aligned.minorAxis.y *= -1;
    aligned.angle = Math.atan2(aligned.majorAxis.y, aligned.majorAxis.x);
    return aligned;
  }

  /**
   * Applies a deliberately broad but bounded reacquisition gate after several
   * missing frames. Local texture/region validation remains the final guard for
   * point repairs, while these limits reject unrelated tiny debris and scenery.
   * @param {ReturnType<typeof compareShapeDescriptors>} comparison Last-frame comparison.
   * @param {ReturnType<typeof compareShapeDescriptors>} sourceComparison Source-frame comparison.
   * @returns {boolean} Whether the candidate is safe enough for reacquisition.
   */
  function isPlausibleReacquisition(comparison, sourceComparison) {
    const candidates = [comparison, sourceComparison];
    return candidates.some(
      (result) =>
        result.score >= 0.24 &&
        result.areaRatio >= 0.35 &&
        result.areaRatio <= 2.85 &&
        result.aspectRatio >= 0.25 &&
        result.aspectRatio <= 4 &&
        result.compactnessRatio >= 0.2 &&
        result.compactnessRatio <= 5,
    );
  }

  /**
   * Selects the best shape candidate using shape similarity and motion prediction.
   * @param {object} sourceDescriptor Original propagation source descriptor.
   * @param {Array<object>} candidates Target-frame candidates.
   * @param {object} state Sequential tracking state.
   * @returns {{candidate:object,score:number,strictMode:boolean,reacquisitionLevel:number}|null}
   */
  function selectTrackedCandidate(sourceDescriptor, candidates, state) {
    if (!sourceDescriptor || !Array.isArray(candidates) || !candidates.length || !state) return null;
    const reacquisitionLevel = Math.min(3, Math.floor(state.failureStreak / 2));
    const predictedCenter = predictTrackingCenter(state, state.failureStreak + 1);
    const reference = state.lastDescriptor || sourceDescriptor;
    const searchRadius = Math.max(
      60 + reacquisitionLevel * 36,
      reference.majorLength * (5 + reacquisitionLevel * 1.5),
    );
    let best = null;
    const candidateLimit = reacquisitionLevel ? 16 : 8;
    for (const rawCandidate of candidates.slice(0, candidateLimit)) {
      const candidate = alignTrackingDescriptor(reference, rawCandidate);
      const comparison = compareShapeDescriptors(reference, candidate);
      const motionDistance = Math.hypot(
        candidate.center.x - predictedCenter.x,
        candidate.center.y - predictedCenter.y,
      );
      if (motionDistance > searchRadius) continue;
      const motionScore = clamp(1 - motionDistance / searchRadius, 0, 1);
      const sourceComparison = compareShapeDescriptors(sourceDescriptor, candidate);
      const accepted =
        comparison.accepted ||
        (reacquisitionLevel >= 1 && sourceComparison.accepted) ||
        (reacquisitionLevel >= 2 && isPlausibleReacquisition(comparison, sourceComparison));
      if (!accepted) continue;
      const score = comparison.score * 0.4 + sourceComparison.score * 0.25 + motionScore * 0.35;
      if (!best || score > best.score) {
        best = {
          candidate,
          score,
          strictMode: false,
          reacquisitionLevel,
        };
      }
    }
    return best;
  }

  /**
   * Records a successful or failed tracking step.
   * @param {object} state Mutable tracking state.
   * @param {object|null} descriptor Selected descriptor, or null on failure.
   * @returns {object}
   */
  function advanceTrackingState(state, descriptor) {
    if (!descriptor) {
      state.failureStreak += 1;
      return state;
    }
    const delta = {
      x: descriptor.center.x - state.lastSuccessCenter.x,
      y: descriptor.center.y - state.lastSuccessCenter.y,
    };
    state.recentDeltas.push(delta);
    if (state.recentDeltas.length > 3) state.recentDeltas.shift();
    state.lastSuccessCenter = { ...descriptor.center };
    state.lastDescriptor = descriptor;
    state.failureStreak = 0;
    return state;
  }

  /**
   * Rebuilds `fp_kernel_01` nearest-color search inside a circular radius.
   * Color distance wins first; squared spatial distance breaks exact ties.
   * @param {Uint8ClampedArray|Uint8Array} data RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {{r:number,g:number,b:number,a?:number}} targetColor Reference color.
   * @param {{x:number,y:number}} center Rounded search center.
   * @param {number} radius Integer search radius.
   * @returns {{x:number,y:number,dist:number,newSeedColor:[number,number,number,number]}|null}
   */
  function findReferenceNearestColorInRadius(data, width, height, targetColor, center, radius) {
    const pixelCount = width * height;
    if (width <= 0 || height <= 0 || !data || data.length !== pixelCount * 4) return null;
    const safeRadius = Math.trunc(radius);
    if (safeRadius < 0) return null;
    const centerX = Math.round(center?.x);
    const centerY = Math.round(center?.y);
    const hasAlpha = targetColor.a != null && (targetColor.a & 255) < 255;
    const targetAlpha = hasAlpha ? targetColor.a & 255 : 0;
    const colorDistanceSquared = (pixel) => {
      const offset = pixel * 4;
      const deltaRed = data[offset] - (targetColor.r & 255);
      const deltaGreen = data[offset + 1] - (targetColor.g & 255);
      const deltaBlue = data[offset + 2] - (targetColor.b & 255);
      const deltaAlpha = hasAlpha ? data[offset + 3] - targetAlpha : 0;
      return deltaRed * deltaRed + deltaGreen * deltaGreen + deltaBlue * deltaBlue + deltaAlpha * deltaAlpha;
    };
    if (centerX >= 0 && centerX < width && centerY >= 0 && centerY < height) {
      const centerIndex = centerY * width + centerX;
      if (colorDistanceSquared(centerIndex) === 0) {
        const offset = centerIndex * 4;
        return {
          x: centerX,
          y: centerY,
          dist: 0,
          newSeedColor: [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]],
        };
      }
    }
    const minimumX = Math.max(centerX - safeRadius, 0);
    const maximumX = Math.min(centerX + safeRadius, width - 1);
    const minimumY = Math.max(centerY - safeRadius, 0);
    const maximumY = Math.min(centerY + safeRadius, height - 1);
    if (minimumX > maximumX || minimumY > maximumY) return null;
    const radiusSquared = safeRadius * safeRadius;
    let bestPixel = -1;
    let bestColorDistance = Number.MAX_SAFE_INTEGER;
    let bestSpatialDistance = Number.MAX_SAFE_INTEGER;
    for (let y = minimumY; y <= maximumY; y += 1) {
      const deltaY = y - centerY;
      if (deltaY * deltaY > radiusSquared) continue;
      for (let x = minimumX; x <= maximumX; x += 1) {
        const deltaX = x - centerX;
        const spatialDistance = deltaX * deltaX + deltaY * deltaY;
        if (spatialDistance > radiusSquared) continue;
        const pixel = y * width + x;
        const candidateDistance = colorDistanceSquared(pixel);
        if (
          candidateDistance > bestColorDistance ||
          (candidateDistance === bestColorDistance && spatialDistance >= bestSpatialDistance)
        ) {
          continue;
        }
        bestPixel = pixel;
        bestColorDistance = candidateDistance;
        bestSpatialDistance = spatialDistance;
      }
    }
    if (bestPixel < 0) return null;
    const offset = bestPixel * 4;
    return {
      x: bestPixel % width,
      y: Math.floor(bestPixel / width),
      dist: Math.sqrt(bestColorDistance),
      newSeedColor: [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]],
    };
  }

  /**
   * Reacquires the closest corresponding color near a predicted point.
   * @param {Uint8ClampedArray|Uint8Array} data RGBA pixels.
   * @param {number} width Image width.
   * @param {number} height Image height.
   * @param {{r:number,g:number,b:number}} targetColor Source-frame color.
   * @param {{x:number,y:number}} center Predicted target point.
   * @param {number} radius Search radius.
   * @returns {{r:number,g:number,b:number}}
   */
  function sampleMatchingColor(data, width, height, targetColor, center, radius = 15) {
    const match = findReferenceNearestColorInRadius(data, width, height, targetColor, center, radius);
    if (!match) return { ...targetColor };
    return {
      r: match.newSeedColor[0],
      g: match.newSeedColor[1],
      b: match.newSeedColor[2],
      ...(targetColor.a == null ? {} : { a: match.newSeedColor[3] }),
    };
  }

  return {
    advanceTrackingState,
    alignTrackingDescriptor,
    checkReferenceShapeMatch,
    compareShapeDescriptors,
    compareReferenceShapeStats,
    computeReferenceLocalFrame,
    createShapeDescriptor,
    createShapeCandidates,
    createTrackingState,
    findReferenceNearestColorInRadius,
    mapCanvasBrushStroke,
    mapCanvasPoint,
    mapCanvasRectangle,
    mapBrushStroke,
    mapPoint,
    mapRectangle,
    predictTrackingCenter,
    sampleMatchingColor,
    selectTrackedCandidate,
  };
});
