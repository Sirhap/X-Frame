(function attachXFrameCompositeContext(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XFrameCompositeContext = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (_root) => {
  "use strict";

  /**
   * Creates image-loading operations for composite animation context.
   *
   * Group relationships stay derived from the active configuration while all
   * mutable image state is supplied by explicit getters and setters.
   *
   * @param {{
   *   getConfig?:()=>object|null,
   *   getCurrentGroup?:()=>object|null,
   *   getChainImages?:()=>object[],
   *   setChainImages?:(value:object[])=>void,
   *   getPreviewOwnerGroup?:()=>object|null,
   *   setPreviewOwnerGroup?:(value:object|null)=>void,
   *   getPreviewOwnerImages?:()=>object[],
   *   setPreviewOwnerImages?:(value:object[])=>void,
   *   getCoordinateOwnerGroup?:()=>object|null,
   *   setCoordinateOwnerGroup?:(value:object|null)=>void,
   *   getCoordinateOwnerImages?:()=>object[],
   *   setCoordinateOwnerImages?:(value:object[])=>void,
   *   getAttachedLayerImageSets?:()=>Map<string,object[]>,
   *   setAttachedLayerImageSets?:(value:Map<string,object[]>)=>void,
   *   getPlaybackChainGroup?:()=>object|null,
   *   getImagesLoader?:()=>object|((frames:object[])=>Promise<object[]>),
   *   getAttachmentFrames?:(index:number,group:object)=>object[],
   *   getImageCacheKey?:(frame:object)=>string,
   *   mapWithConcurrency?:(items:object[],mapper:(item:object)=>Promise<unknown>)=>Promise<unknown[]>,
   * }} dependencies Controller dependencies.
   * @returns {{
   *   loadChainImages:(chain?:object|null)=>Promise<object[]>,
   *   findRelatedGroup:(ownerGroup:object|null,name:string)=>object|null,
   *   attachedLayerGroups:(ownerGroup:object|null)=>object[],
   *   loadCompositeContext:(group:object|null)=>Promise<object>,
   *   loadFrameImageAttachmentsForGroup:(group:object|null)=>Promise<void>,
   * }} Composite context operations.
   */
  function createController(dependencies = {}) {
    const {
      getConfig = () => null,
      getCurrentGroup = () => null,
      getChainImages = () => [],
      setChainImages = () => {},
      getPreviewOwnerGroup = () => null,
      setPreviewOwnerGroup = () => {},
      getPreviewOwnerImages = () => [],
      setPreviewOwnerImages = () => {},
      getCoordinateOwnerGroup = () => null,
      setCoordinateOwnerGroup = () => {},
      getCoordinateOwnerImages = () => [],
      setCoordinateOwnerImages = () => {},
      getAttachedLayerImageSets = () => new Map(),
      setAttachedLayerImageSets = () => {},
      getPlaybackChainGroup = () => null,
      getImagesLoader = () => null,
      getAttachmentFrames = () => [],
      getImageCacheKey = (frame) => String(frame?.path || ""),
      mapWithConcurrency = async (items, mapper) => Promise.all(items.map(mapper)),
    } = dependencies;

    /**
     * Resolves the injected image cache controller or bounded loader.
     * @returns {{loadImagesBounded?:(frames:object[])=>Promise<object[]>,loadImageCached?:(frame:object)=>Promise<object>}} Image loader.
     */
    function imagesLoader() {
      const loader = getImagesLoader();
      if (typeof loader === "function") return { loadImagesBounded: loader };
      return loader || {};
    }

    /**
     * Loads an ordered set of frame images through the shared image cache.
     * @param {object[]} frames Frame descriptors.
     * @returns {Promise<object[]>} Decoded images.
     */
    function loadImages(frames) {
      const loader = imagesLoader();
      if (typeof loader.loadImagesBounded !== "function") {
        return Promise.reject(new TypeError("An image loader is required."));
      }
      return loader.loadImagesBounded(frames);
    }

    /**
     * Loads one frame image, preserving the cache-specific path when available.
     * @param {object} frame Frame descriptor.
     * @returns {Promise<object>} Decoded image.
     */
    function loadImage(frame) {
      const loader = imagesLoader();
      if (typeof loader.loadImageCached === "function") return loader.loadImageCached(frame);
      return loadImages([frame]).then((loaded) => loaded[0]);
    }

    /**
     * Loads images for the configured chained playback group.
     * @param {object|null} [chain] Optional chain group override.
     * @returns {Promise<object[]>} Decoded chain images.
     */
    async function loadChainImages(chain = getPlaybackChainGroup()) {
      const currentGroup = getCurrentGroup();
      let nextImages = [];
      if (chain && currentGroup && chain.uiId !== currentGroup.uiId) {
        nextImages = await loadImages(chain.frames || []);
        if (chain.huangXianAnchorFrame) {
          chain.huangXianAnchorImage = await loadImage(chain.huangXianAnchorFrame);
        } else {
          delete chain.huangXianAnchorImage;
        }
      }
      setChainImages(nextImages);
      return getChainImages();
    }

    /**
     * Finds a related group sharing the owner's tuning target.
     * @param {object|null} ownerGroup Group that owns the relation.
     * @param {string} name Related group name.
     * @returns {object|null} Matching group, if any.
     */
    function findRelatedGroup(ownerGroup, name) {
      if (!ownerGroup || !name) return null;
      return (
        getConfig()?.groups?.find(
          (group) => group.tuningTarget === ownerGroup.tuningTarget && group.name === name,
        ) || null
      );
    }

    /**
     * Resolves all configured attachment layers for one owner group.
     * @param {object|null} ownerGroup Group whose layers should be resolved.
     * @returns {object[]} Related layer groups.
     */
    function attachedLayerGroups(ownerGroup) {
      if (!Array.isArray(ownerGroup?.attachedLayers)) return [];
      return ownerGroup.attachedLayers.map((name) => findRelatedGroup(ownerGroup, name)).filter(Boolean);
    }

    /**
     * Loads preview, coordinate-owner, and attached-layer image context.
     * @param {object|null} group Active animation group.
     * @returns {Promise<object>} Loaded composite context.
     */
    async function loadCompositeContext(group) {
      const previewOwnerGroup = group?.previewOwner ? findRelatedGroup(group, group.previewOwner) : null;
      setPreviewOwnerGroup(previewOwnerGroup);
      const previewOwnerImages = previewOwnerGroup ? await loadImages(previewOwnerGroup.frames || []) : [];
      setPreviewOwnerImages(previewOwnerImages);

      const coordinateOwnerName = group?.previewOwner || (group?.type === "vfx" ? group.attachTo : "");
      const coordinateOwnerGroup = coordinateOwnerName ? findRelatedGroup(group, coordinateOwnerName) : null;
      setCoordinateOwnerGroup(coordinateOwnerGroup);
      const coordinateOwnerImages = coordinateOwnerGroup
        ? coordinateOwnerGroup.uiId === previewOwnerGroup?.uiId
          ? previewOwnerImages
          : await loadImages(coordinateOwnerGroup.frames || [])
        : [];
      setCoordinateOwnerImages(coordinateOwnerImages);

      const attachedLayerImageSets = new Map();
      for (const ownerGroup of [group, previewOwnerGroup].filter(Boolean)) {
        for (const layerGroup of attachedLayerGroups(ownerGroup)) {
          if (attachedLayerImageSets.has(layerGroup.uiId)) continue;
          attachedLayerImageSets.set(layerGroup.uiId, await loadImages(layerGroup.frames || []));
        }
      }
      setAttachedLayerImageSets(attachedLayerImageSets);
      return {
        previewOwnerGroup: getPreviewOwnerGroup(),
        previewOwnerImages: getPreviewOwnerImages(),
        coordinateOwnerGroup: getCoordinateOwnerGroup(),
        coordinateOwnerImages: getCoordinateOwnerImages(),
        attachedLayerImageSets: getAttachedLayerImageSets(),
      };
    }

    /**
     * Preloads all image attachments referenced by an animation group.
     * @param {object|null} group Animation group.
     * @returns {Promise<void>} Resolves after preload attempts complete.
     */
    async function loadFrameImageAttachmentsForGroup(group) {
      if (!group?.frames?.length) return;
      const preloadFrames = new Map();
      for (let index = 0; index < group.frames.length; index += 1) {
        for (const attachment of getAttachmentFrames(index, group)) {
          if (attachment.path) preloadFrames.set(getImageCacheKey(attachment), attachment);
        }
      }
      await mapWithConcurrency(Array.from(preloadFrames.values()), (frame) =>
        loadImage(frame).catch(() => null),
      );
    }

    return {
      attachedLayerGroups,
      findRelatedGroup,
      loadChainImages,
      loadCompositeContext,
      loadFrameImageAttachmentsForGroup,
    };
  }

  return Object.freeze({ createController });
});
