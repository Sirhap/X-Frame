(function attachXsxbAppBoxAdjustment(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAppBoxAdjustment = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (_root) => {
  "use strict";

  /**
   * Creates the box-screen geometry and box-input synchronization helpers.
   *
   * The controller deliberately receives every app.js dependency. This keeps
   * mutable project state owned by app.js while allowing the rendering and
   * input helpers to be tested in isolation.
   *
   * @param {{
   *   elements:{stage:object,showBoxes:object,boxOnlyMode?:object,boxChoiceInputs?:object[],boxEnabled?:object,deleteBox?:object,clearBox?:object},
   *   getCurrentGroup?:()=>object|null,
   *   getSelectedFrame?:()=>number,
   *   getSelectedBox?:()=>string,
   *   getSelectedBoxes?:()=>Set<string>,
   *   getShowBoxes?:()=>boolean,
   *   getImages?:()=>Array<object>,
   *   getView?:()=>{zoom:number},
   *   getDevicePixelRatio?:()=>number,
   *   boxDrawOrder?:string[],
   *   collisionBoxHandles?:Set<string>,
   *   boxExistsOnFrame:(boxName:string,index:number,group:object|null)=>boolean,
   *   frameBox:(boxName:string,index:number,group:object|null,images?:Array<object>)=>object,
   *   boxAutoTransform:(index:number,group:object|null,images?:Array<object>)=>object,
   *   groupOriginScreen:(index:number,group:object|null,images?:Array<object>,includeOffset?:boolean)=>{x:number,y:number},
   *   isCollisionBox:(boxName:string)=>boolean,
   *   rotateVector:(value:{x:number,y:number},radians:number)=>{x:number,y:number},
   *   rotatePoint:(point:{x:number,y:number},radians:number,origin:{x:number,y:number})=>{x:number,y:number},
   *   pointInRect:(point:{x:number,y:number},rect:object)=>boolean,
   *   pointInBoxRect:(point:{x:number,y:number},rect:object,padding?:number)=>boolean,
   *   canEditBoxes:(group?:object|null)=>boolean,
   *   canEditBox:(boxName:string,group?:object|null)=>boolean,
   *   normalizeBoxSelectionForGroup:(group?:object|null)=>boolean,
   *   saveBoxViewPrefs:()=>void,
   *   selectedFrameIndexes:()=>number[],
   *   cloneVector:(value:object,fallback?:object)=>{x:number,y:number},
   *   collisionOffsetYForHeight:(height:number)=>number,
   *   setBoxOverride:(boxName:string,box:object,index:number,group:object|null)=>void,
   *   nudgeFrameBox?:(boxName:string,box:object,deltaX:number,deltaY:number)=>object,
   *   pushUndo?:(label:string)=>void,
   *   renderFilmstrip:()=>void,
   *   draw:()=>void,
   * }} dependencies Controller dependencies.
   * @returns {{boxScreenRect:function,boxHandleRects:function,editableBoxHandleRects:function,nudgeSelectedBox:function,stagePoint:function,hitTestBoxes:function,syncBoxInputs:function,updateSelectedBoxFromInputs:function}} Box helpers.
   */
  function createController(dependencies) {
    const {
      elements,
      getCurrentGroup = () => null,
      getSelectedFrame = () => 0,
      getSelectedBox = () => "",
      getSelectedBoxes = () => new Set(),
      getShowBoxes = () => false,
      getImages = () => [],
      getView = () => ({ zoom: 1 }),
      getDevicePixelRatio = () => 1,
      boxDrawOrder = [],
      collisionBoxHandles = new Set(),
      boxExistsOnFrame,
      frameBox,
      boxAutoTransform,
      groupOriginScreen,
      isCollisionBox,
      rotateVector,
      rotatePoint,
      pointInRect,
      pointInBoxRect,
      canEditBoxes,
      canEditBox,
      normalizeBoxSelectionForGroup,
      saveBoxViewPrefs,
      selectedFrameIndexes,
      cloneVector,
      collisionOffsetYForHeight,
      setBoxOverride,
      nudgeFrameBox = (boxName, box, deltaX, deltaY) => ({
        ...box,
        offset: {
          x: Number(box?.offset?.x || 0) + Number(deltaX || 0),
          y: Number(box?.offset?.y || 0) + Number(deltaY || 0),
        },
      }),
      pushUndo = () => {},
      renderFilmstrip,
      draw,
    } = dependencies;

    /**
     * Converts one logical box into its rotated screen-space rectangle.
     * @param {string} boxName Box name.
     * @param {number} [index] Frame index.
     * @param {object|null} [group] Animation group.
     * @param {Array<object>} [groupImages] Decoded frame images.
     * @returns {object|null} Screen rectangle or null when the box is absent.
     */
    function boxScreenRect(
      boxName,
      index = getSelectedFrame(),
      group = getCurrentGroup(),
      groupImages = getImages(),
    ) {
      if (!boxExistsOnFrame(boxName, index, group)) return null;
      const box = frameBox(boxName, index, group, groupImages);
      const worldScale = getView().zoom * getDevicePixelRatio();
      const auto = boxAutoTransform(index, group, groupImages);
      const width = Math.max(1, Math.abs(box.size.x * auto.scaleX * worldScale));
      const height = Math.max(1, Math.abs(box.size.y * auto.scaleY * worldScale));
      const origin = groupOriginScreen(index, group, groupImages, false);
      const localCenter = {
        x: box.offset.x * auto.scaleX * worldScale,
        y: box.offset.y * auto.scaleY * worldScale,
      };
      const rotatedCenter = rotateVector(localCenter, auto.rotation);
      const centerX = origin.x + auto.offset.x * worldScale + rotatedCenter.x;
      const centerY = origin.y + (isCollisionBox(boxName) ? 0 : auto.offset.y * worldScale) + rotatedCenter.y;
      const rotation = isCollisionBox(boxName)
        ? 0
        : auto.rotation + (Number(box.rotation || 0) * auto.facing * Math.PI) / 180;
      const localCorners = [
        { x: -width / 2, y: -height / 2 },
        { x: width / 2, y: -height / 2 },
        { x: width / 2, y: height / 2 },
        { x: -width / 2, y: height / 2 },
      ];
      const points = localCorners.map((point) => rotatePoint(point, rotation, { x: centerX, y: centerY }));
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);
      return {
        box,
        centerX,
        centerY,
        rotation,
        x: left,
        y: top,
        width,
        height,
        halfWidth: width / 2,
        halfHeight: height / 2,
        left,
        right,
        top,
        bottom,
        points,
      };
    }

    /**
     * Returns the eight resize-handle rectangles for a screen rectangle.
     * @param {{points:Array<{x:number,y:number}>}} rect Screen rectangle.
     * @returns {Array<object>} Handle rectangles.
     */
    function boxHandleRects(rect) {
      const size = Math.max(18 * getDevicePixelRatio(), 18);
      const half = size / 2;
      const [nw, ne, se, sw] = rect.points;
      const points = [
        ["nw", nw.x, nw.y],
        ["n", (nw.x + ne.x) / 2, (nw.y + ne.y) / 2],
        ["ne", ne.x, ne.y],
        ["e", (ne.x + se.x) / 2, (ne.y + se.y) / 2],
        ["se", se.x, se.y],
        ["s", (sw.x + se.x) / 2, (sw.y + se.y) / 2],
        ["sw", sw.x, sw.y],
        ["w", (nw.x + sw.x) / 2, (nw.y + sw.y) / 2],
      ];
      return points.map(([name, x, y]) => ({ name, x: x - half, y: y - half, width: size, height: size }));
    }

    /**
     * Filters resize handles according to the selected box type.
     * @param {string} boxName Box name.
     * @param {object} rect Screen rectangle.
     * @returns {Array<object>} Editable handle rectangles.
     */
    function editableBoxHandleRects(boxName, rect) {
      const handles = boxHandleRects(rect);
      if (!isCollisionBox(boxName)) return handles;
      return handles.filter((handle) => collisionBoxHandles.has(handle.name));
    }

    /**
     * Converts a pointer event into device-pixel stage coordinates.
     * @param {{clientX:number,clientY:number}} event Pointer event.
     * @returns {{x:number,y:number}} Stage point.
     */
    function stagePoint(event) {
      const stageRect = elements.stage.getBoundingClientRect();
      const deviceScale = getDevicePixelRatio();
      return {
        x: (event.clientX - stageRect.left) * deviceScale,
        y: (event.clientY - stageRect.top) * deviceScale,
      };
    }

    /**
     * Hit-tests selected boxes and resize handles for a pointer event.
     * @param {{altKey?:boolean,clientX:number,clientY:number}} event Pointer event.
     * @returns {{boxName:string,mode:string,handle?:string}|null} Hit result.
     */
    function hitTestBoxes(event) {
      if (!getShowBoxes() || !canEditBoxes()) return null;
      const point = stagePoint(event);
      const boxNames = boxDrawOrder
        .slice()
        .reverse()
        .filter((name) => getSelectedBoxes().has(name));
      for (const boxName of boxNames) {
        const rect = boxScreenRect(boxName);
        if (!rect) continue;
        let nearest = null;
        let nearestDistance = Infinity;
        for (const handle of editableBoxHandleRects(boxName, rect)) {
          if (!pointInRect(point, handle)) continue;
          const centerX = handle.x + handle.width / 2;
          const centerY = handle.y + handle.height / 2;
          const distance = (point.x - centerX) ** 2 + (point.y - centerY) ** 2;
          if (distance < nearestDistance) {
            nearest = handle;
            nearestDistance = distance;
          }
        }
        if (nearest) return { boxName, mode: "box-resize", handle: nearest.name };
      }
      for (const boxName of boxNames) {
        const rect = boxScreenRect(boxName);
        if (!rect) continue;
        const padding = Math.max(10 * getDevicePixelRatio(), 10);
        if (!pointInBoxRect(point, rect, padding)) continue;
        if (event.altKey) return { boxName, mode: "box-alt-block" };
        return { boxName, mode: "box-move" };
      }
      return null;
    }

    /**
     * Synchronizes box controls with current selection and group permissions.
     * @returns {void}
     */
    function syncBoxInputs() {
      const showBoxes = getShowBoxes();
      elements.showBoxes.checked = showBoxes;
      if (elements.boxOnlyMode) {
        elements.boxOnlyMode.checked = false;
        elements.boxOnlyMode.disabled = true;
      }
      const changed = getCurrentGroup() ? normalizeBoxSelectionForGroup() : false;
      for (const input of elements.boxChoiceInputs) {
        const boxName = input.dataset.boxChoice;
        const enabled = getCurrentGroup() ? canEditBox(boxName) : false;
        input.disabled = !enabled;
        input.checked = getSelectedBoxes().has(boxName);
        const choice = input.closest(".boxChoice");
        if (choice) {
          choice.classList.toggle("activeBoxChoice", getSelectedBox() === boxName);
          choice.classList.toggle("disabled", !enabled);
        }
      }
      if (changed) saveBoxViewPrefs();
      const enabled = canEditBox(getSelectedBox()) && Boolean(getSelectedBox());
      for (const input of [elements.boxEnabled, elements.deleteBox, elements.clearBox].filter(Boolean)) {
        input.disabled = !enabled;
      }
      if (!enabled) {
        if (elements.boxEnabled) elements.boxEnabled.checked = false;
        return;
      }
      const box = frameBox(getSelectedBox());
      if (elements.boxEnabled) elements.boxEnabled.checked = box.enabled !== false;
    }

    /**
     * Writes the selected box input values to every selected frame.
     * @returns {void}
     */
    /**
     * Nudges the selected box on every selected frame.
     * @param {number} deltaX Local X step.
     * @param {number} deltaY Local Y step.
     * @param {{repeat?:boolean}} [options] Keyboard repeat flag; skips extra undo points.
     * @returns {boolean} Whether a selected editable box consumed the nudge.
     */
    function nudgeSelectedBox(deltaX, deltaY, options = {}) {
      const selectedBox = getSelectedBox();
      if (!canEditBox(selectedBox) || !selectedBox) return false;
      const dx = Number(deltaX);
      const dy = Number(deltaY);
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return false;
      if (!options.repeat) pushUndo("nudge box");
      for (const frameIndex of selectedFrameIndexes()) {
        const current = frameBox(selectedBox, frameIndex, getCurrentGroup());
        setBoxOverride(
          selectedBox,
          nudgeFrameBox(selectedBox, current, dx, dy),
          frameIndex,
          getCurrentGroup(),
        );
      }
      syncBoxInputs();
      draw();
      return true;
    }

    function updateSelectedBoxFromInputs() {
      const selectedBox = getSelectedBox();
      if (!canEditBox(selectedBox) || !selectedBox) return;
      const current = frameBox(selectedBox);
      const collision = isCollisionBox(selectedBox);
      const box = {
        offset: {
          x: Number(current.offset?.x || 0),
          y: collision ? collisionOffsetYForHeight(current.size.y) : Number(current.offset?.y || 0),
        },
        size: cloneVector(current.size),
        rotation: collision ? 0 : Number(current.rotation || 0),
        enabled: elements.boxEnabled ? elements.boxEnabled.checked : current.enabled !== false,
      };
      for (const frameIndex of selectedFrameIndexes()) {
        setBoxOverride(selectedBox, box, frameIndex, getCurrentGroup());
      }
      renderFilmstrip();
      draw();
    }

    return {
      boxHandleRects,
      boxScreenRect,
      editableBoxHandleRects,
      hitTestBoxes,
      nudgeSelectedBox,
      stagePoint,
      syncBoxInputs,
      updateSelectedBoxFromInputs,
    };
  }

  return { createController };
});
