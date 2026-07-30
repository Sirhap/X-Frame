"use strict";

/**
 * Runs the deterministic 20-frame product golden corpus.
 * @param {object} dependencies Assertion API and product cutout helpers.
 * @returns {void}
 */
function runCutoutProductGoldenTests(dependencies) {
  const { assert, crypto, applyCutout, applyProductCutout } = dependencies;
  /**
   * Builds one deterministic moving-subject frame for the 20-frame product corpus.
   * @param {number} frameIndex Zero-based frame index.
   * @returns {Uint8ClampedArray}
   */
  function createProductGoldenFrame(frameIndex) {
    const width = 8;
    const height = 8;
    const pixels = new Uint8ClampedArray(width * height * 4);
    const subjectX = 1 + (frameIndex % 5);
    const subjectY = 2 + (frameIndex % 3);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const secondaryBackground = x === width - 1 && frameIndex % 2 === 1;
        pixels[offset] = secondaryBackground ? 0 : (x * 2 + frameIndex) % 8;
        pixels[offset + 1] = secondaryBackground ? 0 : 248 + ((x + y + frameIndex) % 8);
        pixels[offset + 2] = secondaryBackground ? 248 : (y * 3 + frameIndex) % 8;
        pixels[offset + 3] = 255;
        if (Math.abs(x - subjectX) <= 1 && Math.abs(y - subjectY) <= 1) {
          pixels[offset] = 180 + ((x * 11 + frameIndex) % 50);
          pixels[offset + 1] = 25 + ((y * 13 + frameIndex) % 45);
          pixels[offset + 2] = 20 + ((x * 7 + y * 5) % 30);
        }
      }
    }
    return pixels;
  }

  const productGoldenOptions = {
    backgroundColor: { r: 0, g: 252, b: 0 },
    backgroundColors: [
      { r: 0, g: 252, b: 0 },
      { r: 0, g: 0, b: 248 },
    ],
    tolerance: 4,
    feather: 5,
    alphaThreshold: 2,
    connected: false,
    perceptual: true,
    referenceChromaKey: true,
    chromaCleanup: 44,
    chromaFeather: 12,
    edgeBoost: 8,
    alphaLow: 3,
    alphaHigh: 250,
    despillStrength: 35,
    despillMode: "chroma",
    edgeDespillRadius: 2,
    edgeRecoveryStrength: 40,
    edgeRecoveryTolerance: 30,
    backgroundRadius: 10,
    blurRadius: 1,
    protectedColors: [{ r: 210, g: 45, b: 30 }],
    protectionTolerance: 4,
  };
  const productGoldenBytes = [];
  for (let frameIndex = 0; frameIndex < 20; frameIndex += 1) {
    const source = createProductGoldenFrame(frameIndex);
    const repairs = [
      {
        mode: frameIndex % 2 ? "eraser" : "brush",
        points: [
          { x: 2, y: 2 },
          { x: 3 + (frameIndex % 3), y: 4 },
        ],
        size: 2 + (frameIndex % 3),
        hardness: 0.65,
        opacity: 0.4,
        color: { r: 35, g: 120, b: 210 },
      },
      {
        mode: frameIndex % 3 === 0 ? "clear" : frameIndex % 3 === 1 ? "restore" : "smart",
        x1: 0,
        y1: 0,
        x2: 2,
        y2: 2,
        tolerance: 5,
        feather: 2,
        backgroundColor: { r: 0, g: 252, b: 0 },
      },
    ];
    const automatic = applyCutout(source, 8, 8, productGoldenOptions);
    const product = applyProductCutout(source, 8, 8, productGoldenOptions, repairs);
    assert.deepEqual([...product.automaticData], [...automatic.data]);
    assert.equal(product.data.length, 8 * 8 * 4);
    productGoldenBytes.push(...product.data);
  }
  const productGoldenHash = crypto
    .createHash("sha256")
    .update(Uint8Array.from(productGoldenBytes))
    .digest("hex");
  assert.equal(productGoldenHash, "ae1425d2810d90ec5c8aefcea5d59cbcf714a61907bb1a630f808f2feabfec03");
}

module.exports = { runCutoutProductGoldenTests };
