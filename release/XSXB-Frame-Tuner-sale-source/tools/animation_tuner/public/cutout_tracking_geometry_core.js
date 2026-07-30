(function attachCutoutTrackingGeometryCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CutoutTrackingGeometryCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
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
   * Maps a point through normalized PCA-local coordinates.
   * @param {{x:number,y:number}} point Source point.
   * @param {object} source Source descriptor.
   * @param {object} target Target descriptor.
   * @returns {{x:number,y:number}}
   */
  function mapPoint(point, source, target) {
    const deltaX = point.x - source.center.x;
    const deltaY = point.y - source.center.y;
    const localMajor = (deltaX * source.majorAxis.x + deltaY * source.majorAxis.y) / source.majorLength;
    const localMinor = (deltaX * source.minorAxis.x + deltaY * source.minorAxis.y) / source.minorLength;
    return {
      x:
        target.center.x +
        localMajor * target.majorLength * target.majorAxis.x +
        localMinor * target.minorLength * target.minorAxis.x,
      y:
        target.center.y +
        localMajor * target.majorLength * target.majorAxis.y +
        localMinor * target.minorLength * target.minorAxis.y,
    };
  }

  /**
   * Maps an axis-aligned repair rectangle between two subject descriptors.
   * @param {{x1:number,y1:number,x2:number,y2:number}} rectangle Source rectangle.
   * @param {object} source Source descriptor.
   * @param {object} target Target descriptor.
   * @returns {{x1:number,y1:number,x2:number,y2:number}}
   */
  function mapRectangle(rectangle, source, target) {
    const corners = [
      { x: rectangle.x1, y: rectangle.y1 },
      { x: rectangle.x2, y: rectangle.y1 },
      { x: rectangle.x2, y: rectangle.y2 },
      { x: rectangle.x1, y: rectangle.y2 },
    ].map((point) => mapPoint(point, source, target));
    return {
      x1: clamp(Math.min(...corners.map((point) => point.x)), 0, target.width),
      y1: clamp(Math.min(...corners.map((point) => point.y)), 0, target.height),
      x2: clamp(Math.max(...corners.map((point) => point.x)), 0, target.width),
      y2: clamp(Math.max(...corners.map((point) => point.y)), 0, target.height),
    };
  }

  /**
   * Maps a serialized brush or eraser stroke between two subject descriptors.
   * The scalar brush size follows the geometric mean of the PCA-axis scales so
   * area remains stable when the target subject changes size anisotropically.
   * @param {{points:Array<{x:number,y:number}>,size:number}} stroke Source stroke.
   * @param {object} source Source descriptor.
   * @param {object} target Target descriptor.
   * @returns {{points:Array<{x:number,y:number}>,size:number}}
   */
  function mapBrushStroke(stroke, source, target) {
    const points = Array.isArray(stroke?.points)
      ? stroke.points
          .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
          .map((point) => {
            const mapped = mapPoint(point, source, target);
            return {
              x: clamp(mapped.x, 0, Math.max(0, target.width - 1)),
              y: clamp(mapped.y, 0, Math.max(0, target.height - 1)),
            };
          })
      : [];
    const majorScale = target.majorLength / Math.max(source.majorLength, 0.000001);
    const minorScale = target.minorLength / Math.max(source.minorLength, 0.000001);
    const sizeScale = Math.sqrt(Math.max(0, majorScale * minorScale));
    return {
      points,
      size: Math.max(0.5, Number(stroke?.size || 1) * sizeScale),
    };
  }

  /**
   * Maps one pixel coordinate between source canvases without subject tracking.
   * This is the deterministic propagation model used by isolated single-frame editing.
   * @param {{x:number,y:number}} point Source-canvas point.
   * @param {{width:number,height:number}} source Source canvas dimensions.
   * @param {{width:number,height:number}} target Target canvas dimensions.
   * @returns {{x:number,y:number}} Proportionally mapped target-canvas point.
   */
  function mapCanvasPoint(point, source, target) {
    const sourceWidth = Math.max(1, Number(source?.width || 1));
    const sourceHeight = Math.max(1, Number(source?.height || 1));
    const targetWidth = Math.max(1, Number(target?.width || 1));
    const targetHeight = Math.max(1, Number(target?.height || 1));
    return {
      x: clamp((Number(point?.x || 0) * targetWidth) / sourceWidth, 0, targetWidth - 1),
      y: clamp((Number(point?.y || 0) * targetHeight) / sourceHeight, 0, targetHeight - 1),
    };
  }

  /**
   * Maps an axis-aligned selection between canvases by normalized coordinates.
   * @param {{x1:number,y1:number,x2:number,y2:number}} rectangle Source rectangle.
   * @param {{width:number,height:number}} source Source canvas dimensions.
   * @param {{width:number,height:number}} target Target canvas dimensions.
   * @returns {{x1:number,y1:number,x2:number,y2:number}} Target rectangle.
   */
  function mapCanvasRectangle(rectangle, source, target) {
    const first = mapCanvasPoint({ x: rectangle.x1, y: rectangle.y1 }, source, target);
    const second = mapCanvasPoint({ x: rectangle.x2, y: rectangle.y2 }, source, target);
    return {
      x1: Math.min(first.x, second.x),
      y1: Math.min(first.y, second.y),
      x2: Math.max(first.x, second.x),
      y2: Math.max(first.y, second.y),
    };
  }

  /**
   * Maps a brush stroke or point repair between canvases by normalized coordinates.
   * @param {{points:Array<{x:number,y:number}>,size?:number}} stroke Source stroke.
   * @param {{width:number,height:number}} source Source canvas dimensions.
   * @param {{width:number,height:number}} target Target canvas dimensions.
   * @returns {{points:Array<{x:number,y:number}>,size:number}} Target stroke geometry.
   */
  function mapCanvasBrushStroke(stroke, source, target) {
    const points = Array.isArray(stroke?.points)
      ? stroke.points
          .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
          .map((point) => mapCanvasPoint(point, source, target))
      : [];
    const widthScale = Math.max(1, Number(target?.width || 1)) / Math.max(1, Number(source?.width || 1));
    const heightScale = Math.max(1, Number(target?.height || 1)) / Math.max(1, Number(source?.height || 1));
    return {
      points,
      size: Math.max(0.5, Number(stroke?.size || 1) * Math.sqrt(widthScale * heightScale)),
    };
  }

  return {
    mapCanvasBrushStroke,
    mapCanvasPoint,
    mapCanvasRectangle,
    mapBrushStroke,
    mapPoint,
    mapRectangle,
  };
});
