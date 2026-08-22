(function attachXsxbAttachmentUtils(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBAttachmentUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates a stable local identifier without requiring a crypto API.
   * @param {string} [prefix="id"] Identifier prefix.
   * @returns {string} New local identifier.
   */
  function newLocalId(prefix = "id") {
    if (root.crypto?.randomUUID) return `${prefix}_${root.crypto.randomUUID().replaceAll("-", "")}`;
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  /**
   * Builds the stable frame-binding key shared by the workbench, MCP, and Godot handoff.
   * @param {{projectId?:string,tuningTarget?:string,profileId?:string,groupType?:string,groupName?:string,source?:string,frame?:number}} identity Frame identity.
   * @returns {string} Canonical attachment key.
   */
  function canonicalAttachmentFrameKey(identity = {}) {
    return [
      identity.projectId || "default",
      identity.tuningTarget || "player",
      identity.profileId || "all",
      identity.groupType || "animation",
      identity.groupName || "",
      identity.source || "",
      Number(identity.frame || 0),
    ].join(":");
  }

  /**
   * Matches one persisted attachment to a workbench frame, including legacy simplified keys.
   * @param {object|null|undefined} attachment Persisted attachment.
   * @param {string} canonicalKey Current workbench frame key.
   * @param {{projectId?:string,profileId?:string,animation?:string,frame?:number}} identity Current frame metadata.
   * @returns {boolean} Whether the attachment belongs to the frame.
   */
  function attachmentMatchesFrame(attachment, canonicalKey, identity = {}) {
    if (!attachment || typeof attachment !== "object") return false;
    if (String(attachment.key || attachment.frameKey || "") === String(canonicalKey || "")) return true;
    const metadata =
      attachment.metadata && typeof attachment.metadata === "object" ? attachment.metadata : {};
    const frame = Number(metadata.frame);
    if (!Number.isFinite(frame) || frame !== Number(identity.frame)) return false;
    if (
      identity.projectId &&
      metadata.projectId &&
      String(metadata.projectId) !== String(identity.projectId)
    ) {
      return false;
    }
    if (
      identity.profileId &&
      metadata.profileId &&
      String(metadata.profileId) !== String(identity.profileId)
    ) {
      return false;
    }
    return Boolean(
      identity.animation && metadata.animation && String(metadata.animation) === String(identity.animation),
    );
  }

  /**
   * Normalizes an attached image transform.
   * @param {{scale?:number,scaleX?:number,scaleY?:number,visual_scale?:{x?:number,y?:number},offset?:{x?:number,y?:number},rotation?:number}} [transform]
   * Raw transform.
   * @returns {{scale:number,scaleX:number,scaleY:number,offset:{x:number,y:number},rotation:number}}
   * Normalized transform.
   */
  function normalizeAttachmentTransform(transform = {}) {
    const scale = Math.max(0.001, Number(transform.scale ?? 1));
    return {
      scale,
      scaleX: Math.max(0.001, Number(transform.scaleX ?? transform.visual_scale?.x ?? scale)),
      scaleY: Math.max(0.001, Number(transform.scaleY ?? transform.visual_scale?.y ?? scale)),
      offset: {
        x: Number(transform.offset?.x || 0),
        y: Number(transform.offset?.y || 0),
      },
      rotation: Number(transform.rotation || 0),
    };
  }

  /**
   * Normalizes the signed layer order used by attachment sorting.
   * @param {{layerOrder?:number,layer?:string}|null|undefined} source Raw attachment.
   * @returns {number} Signed layer order.
   */
  function normalizeAttachmentLayerOrder(source = {}) {
    const parsed = Number(source.layerOrder);
    if (Number.isFinite(parsed) && Math.abs(parsed) > 0.0001) return parsed;
    return source.layer === "below" ? -1 : 1;
  }

  /**
   * Normalizes a persisted attached image record.
   * @param {object|null|undefined} raw Raw attachment record.
   * @returns {object} Normalized attachment record.
   */
  function normalizeFrameImageAttachment(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const metadata = source.metadata && typeof source.metadata === "object" ? source.metadata : {};
    const key = String(source.key || source.frameKey || "");
    const layerOrder = normalizeAttachmentLayerOrder(source);
    return {
      id: String(source.id || newLocalId("layer")),
      key,
      frameKey: key,
      metadata,
      name: String(source.name || "image"),
      path: String(source.path || ""),
      assetId: String(source.assetId || source.automation?.assetId || ""),
      assetHash: String(source.assetHash || ""),
      type: String(source.type || ""),
      width: Number(source.width || 0),
      height: Number(source.height || 0),
      layer: layerOrder < 0 ? "below" : "above",
      layerOrder,
      transform: normalizeAttachmentTransform(source.transform),
      automation:
        source.automation && typeof source.automation === "object"
          ? structuredClone(source.automation)
          : undefined,
    };
  }

  /**
   * Creates a clipboard-safe attachment copy without project identity fields.
   * @param {object} attachment Normalized attachment.
   * @returns {object} Clipboard attachment payload.
   */
  function frameImageAttachmentClipboardItem(attachment) {
    return {
      name: attachment.name,
      path: attachment.path,
      ...(attachment.assetId ? { assetId: attachment.assetId } : {}),
      assetHash: attachment.assetHash,
      type: attachment.type,
      width: attachment.width,
      height: attachment.height,
      layer: attachment.layer === "below" ? "below" : "above",
      layerOrder: normalizeAttachmentLayerOrder(attachment),
      transform: structuredClone(normalizeAttachmentTransform(attachment.transform)),
    };
  }

  return {
    attachmentLayerOrder: normalizeAttachmentLayerOrder,
    attachmentMatchesFrame,
    canonicalAttachmentFrameKey,
    frameImageAttachmentClipboardItem,
    newLocalId,
    normalizeAttachmentLayerOrder,
    normalizeAttachmentTransform,
    normalizeFrameImageAttachment,
  };
});
