/**
 * @typedef {{x: number, y: number, width: number, height: number}} PixelRegion
 */

/**
 * Builds a reusable mask for a bright, low-saturation logo inside a selected region.
 * @param {Uint8Array} referenceFrame RGB24 reference frame.
 * @param {number} frameWidth Source frame width.
 * @param {PixelRegion} region Logo bounds.
 * @param {{minimumLuma?: number, maximumChannelSpread?: number, dilationRadius?: number}} [options] Mask tuning.
 * @returns {Uint8Array} Region-local binary mask.
 */
export function buildBrightLogoMask(referenceFrame, frameWidth, region, options = {}) {
  const minimumLuma = options.minimumLuma ?? 70;
  const maximumChannelSpread = options.maximumChannelSpread ?? 96;
  const dilationRadius = options.dilationRadius ?? 4;
  const mask = new Uint8Array(region.width * region.height);

  for (let regionY = 0; regionY < region.height; regionY += 1) {
    for (let regionX = 0; regionX < region.width; regionX += 1) {
      const frameOffset = ((region.y + regionY) * frameWidth + region.x + regionX) * 3;
      const red = referenceFrame[frameOffset];
      const green = referenceFrame[frameOffset + 1];
      const blue = referenceFrame[frameOffset + 2];
      const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const channelSpread = Math.max(red, green, blue) - Math.min(red, green, blue);
      if (luma >= minimumLuma && channelSpread <= maximumChannelSpread) {
        mask[regionY * region.width + regionX] = 1;
      }
    }
  }

  return dilateMask(mask, region.width, region.height, dilationRadius);
}

/**
 * Repairs one RGB24 frame with a static logo mask and foreground-aware title reconstruction.
 * @param {Uint8Array} sourceFrame RGB24 source frame.
 * @param {number} frameWidth Source frame width.
 * @param {PixelRegion} region Logo bounds.
 * @param {Uint8Array} logoMask Region-local binary logo mask.
 * @param {{yellowClosingRadius?: number, titleOutlineRadius?: number, reconstructTitle?: boolean}} [options] Foreground reconstruction tuning.
 * @returns {Buffer} Repaired RGB24 frame.
 */
export function repairSmartLogoFrame(sourceFrame, frameWidth, region, logoMask, options = {}) {
  const yellowClosingRadius = options.yellowClosingRadius ?? 5;
  const titleOutlineRadius = options.titleOutlineRadius ?? 7;
  const reconstructTitle = options.reconstructTitle ?? false;
  const outputFrame = Buffer.from(sourceFrame);
  const yellowCoreMask = new Uint8Array(region.width * region.height);
  const yellowColor = { red: 255, green: 218, blue: 24, count: 0 };

  for (let regionY = 0; regionY < region.height; regionY += 1) {
    for (let regionX = 0; regionX < region.width; regionX += 1) {
      const frameOffset = ((region.y + regionY) * frameWidth + region.x + regionX) * 3;
      const red = sourceFrame[frameOffset];
      const green = sourceFrame[frameOffset + 1];
      const blue = sourceFrame[frameOffset + 2];
      if (isYellowTitlePixel(red, green, blue)) {
        const maskOffset = regionY * region.width + regionX;
        yellowCoreMask[maskOffset] = 1;
        yellowColor.red += red;
        yellowColor.green += green;
        yellowColor.blue += blue;
        yellowColor.count += 1;
      }
    }
  }

  const hasYellowTitle = yellowColor.count >= 24;
  const repairedYellow = hasYellowTitle
    ? {
        red: Math.round(yellowColor.red / (yellowColor.count + 1)),
        green: Math.round(yellowColor.green / (yellowColor.count + 1)),
        blue: Math.round(yellowColor.blue / (yellowColor.count + 1)),
      }
    : null;

  inpaintMaskedRegion(outputFrame, frameWidth, region, logoMask);
  if (repairedYellow && reconstructTitle) {
    const repairedFillMask = closeMaskDiamond(
      yellowCoreMask,
      region.width,
      region.height,
      yellowClosingRadius,
    );
    const repairedOutlineMask = dilateMaskDiamond(
      repairedFillMask,
      region.width,
      region.height,
      titleOutlineRadius,
    );
    paintMask(outputFrame, frameWidth, region, repairedOutlineMask, { red: 4, green: 4, blue: 4 });
    paintMask(outputFrame, frameWidth, region, repairedFillMask, repairedYellow);
  }
  return outputFrame;
}

/**
 * Expands a binary mask using Manhattan distance for a rounded, connected outline.
 * @param {Uint8Array} sourceMask Binary source mask.
 * @param {number} width Mask width.
 * @param {number} height Mask height.
 * @param {number} radius Expansion radius.
 * @returns {Uint8Array} Diamond-dilated mask.
 */
export function dilateMaskDiamond(sourceMask, width, height, radius) {
  if (radius <= 0) return Uint8Array.from(sourceMask);
  const outputMask = Uint8Array.from(sourceMask);
  let frontier = Uint8Array.from(sourceMask);

  for (let step = 0; step < radius; step += 1) {
    const nextFrontier = new Uint8Array(sourceMask.length);
    for (let offset = 0; offset < frontier.length; offset += 1) {
      if (!frontier[offset]) continue;
      const x = offset % width;
      const y = Math.floor(offset / width);
      const neighbors = [
        x > 0 ? offset - 1 : -1,
        x + 1 < width ? offset + 1 : -1,
        y > 0 ? offset - width : -1,
        y + 1 < height ? offset + width : -1,
      ];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || outputMask[neighbor]) continue;
        outputMask[neighbor] = 1;
        nextFrontier[neighbor] = 1;
      }
    }
    frontier = nextFrontier;
  }

  return outputMask;
}

/**
 * Closes small holes in a binary mask while preserving its overall silhouette.
 * @param {Uint8Array} sourceMask Binary source mask.
 * @param {number} width Mask width.
 * @param {number} height Mask height.
 * @param {number} radius Closing radius.
 * @returns {Uint8Array} Closed mask.
 */
export function closeMaskDiamond(sourceMask, width, height, radius) {
  const dilatedMask = dilateMaskDiamond(sourceMask, width, height, radius);
  const inverseMask = Uint8Array.from(dilatedMask, (value) => (value ? 0 : 1));
  const erodedInverse = dilateMaskDiamond(inverseMask, width, height, radius);
  return Uint8Array.from(erodedInverse, (value) => (value ? 0 : 1));
}

/**
 * Expands a binary mask with a square structuring element in linear time.
 * @param {Uint8Array} sourceMask Binary source mask.
 * @param {number} width Mask width.
 * @param {number} height Mask height.
 * @param {number} radius Expansion radius.
 * @returns {Uint8Array} Dilated mask.
 */
export function dilateMask(sourceMask, width, height, radius) {
  if (radius <= 0) return Uint8Array.from(sourceMask);
  const horizontalMask = new Uint8Array(sourceMask.length);
  const outputMask = new Uint8Array(sourceMask.length);

  for (let y = 0; y < height; y += 1) {
    const prefix = new Uint32Array(width + 1);
    for (let x = 0; x < width; x += 1) {
      prefix[x + 1] = prefix[x] + (sourceMask[y * width + x] ? 1 : 0);
    }
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      horizontalMask[y * width + x] = prefix[right + 1] - prefix[left] > 0 ? 1 : 0;
    }
  }

  for (let x = 0; x < width; x += 1) {
    const prefix = new Uint32Array(height + 1);
    for (let y = 0; y < height; y += 1) {
      prefix[y + 1] = prefix[y] + (horizontalMask[y * width + x] ? 1 : 0);
    }
    for (let y = 0; y < height; y += 1) {
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height - 1, y + radius);
      outputMask[y * width + x] = prefix[bottom + 1] - prefix[top] > 0 ? 1 : 0;
    }
  }

  return outputMask;
}

/**
 * Diffuses neighboring known pixels into a thin masked region one boundary layer at a time.
 * @param {Buffer} frame Mutable RGB24 frame.
 * @param {number} frameWidth Source frame width.
 * @param {PixelRegion} region Region containing the mask.
 * @param {Uint8Array} sourceMask Region-local pixels to inpaint.
 */
export function inpaintMaskedRegion(frame, frameWidth, region, sourceMask) {
  const remainingMask = Uint8Array.from(sourceMask);
  let remainingCount = remainingMask.reduce((sum, value) => sum + value, 0);

  while (remainingCount > 0) {
    const pendingPixels = [];
    for (let maskOffset = 0; maskOffset < remainingMask.length; maskOffset += 1) {
      if (!remainingMask[maskOffset]) continue;
      const regionX = maskOffset % region.width;
      const regionY = Math.floor(maskOffset / region.width);
      const average = averageKnownNeighbors(frame, frameWidth, region, remainingMask, regionX, regionY);
      if (average) pendingPixels.push({ maskOffset, regionX, regionY, average });
    }

    if (!pendingPixels.length) {
      throw new Error("水印遮罩没有可用于补洞的相邻像素");
    }

    for (const pixel of pendingPixels) {
      const frameOffset = ((region.y + pixel.regionY) * frameWidth + region.x + pixel.regionX) * 3;
      frame[frameOffset] = pixel.average.red;
      frame[frameOffset + 1] = pixel.average.green;
      frame[frameOffset + 2] = pixel.average.blue;
      remainingMask[pixel.maskOffset] = 0;
      remainingCount -= 1;
    }
  }
}

/**
 * Detects the saturated yellow fill used by the foreground title.
 * @param {number} red Red channel.
 * @param {number} green Green channel.
 * @param {number} blue Blue channel.
 * @returns {boolean} Whether the pixel belongs to the yellow title fill.
 */
function isYellowTitlePixel(red, green, blue) {
  return red >= 180 && green >= 120 && blue <= 110 && red - blue >= 100 && green - blue >= 70;
}

/** Paints a solid RGB color through a region-local binary mask. */
function paintMask(frame, frameWidth, region, mask, color) {
  for (let maskOffset = 0; maskOffset < mask.length; maskOffset += 1) {
    if (!mask[maskOffset]) continue;
    const regionX = maskOffset % region.width;
    const regionY = Math.floor(maskOffset / region.width);
    const frameOffset = ((region.y + regionY) * frameWidth + region.x + regionX) * 3;
    frame[frameOffset] = color.red;
    frame[frameOffset + 1] = color.green;
    frame[frameOffset + 2] = color.blue;
  }
}

/**
 * Computes an RGB average from currently known eight-connected neighbors.
 * @param {Buffer} frame Mutable RGB24 frame.
 * @param {number} frameWidth Source frame width.
 * @param {PixelRegion} region Region containing the mask.
 * @param {Uint8Array} remainingMask Region-local unresolved mask.
 * @param {number} regionX Region-local x coordinate.
 * @param {number} regionY Region-local y coordinate.
 * @returns {{red: number, green: number, blue: number}|null} Neighbor average when available.
 */
function averageKnownNeighbors(frame, frameWidth, region, remainingMask, regionX, regionY) {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
    for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
      if (deltaX === 0 && deltaY === 0) continue;
      const neighborX = regionX + deltaX;
      const neighborY = regionY + deltaY;
      if (neighborX < 0 || neighborX >= region.width || neighborY < 0 || neighborY >= region.height) continue;
      const neighborMaskOffset = neighborY * region.width + neighborX;
      if (remainingMask[neighborMaskOffset]) continue;
      const frameOffset = ((region.y + neighborY) * frameWidth + region.x + neighborX) * 3;
      red += frame[frameOffset];
      green += frame[frameOffset + 1];
      blue += frame[frameOffset + 2];
      count += 1;
    }
  }

  return count
    ? { red: Math.round(red / count), green: Math.round(green / count), blue: Math.round(blue / count) }
    : null;
}
