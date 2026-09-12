(function attachFrameOrganizerWorksetSync(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FrameOrganizerWorksetSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Builds the IndexedDB / broadcast topic for one animation workset.
   * @param {string} projectId Active project id.
   * @param {string} animationName Animation name.
   * @returns {string}
   */
  function worksetSyncTopic(projectId, animationName) {
    return `xsxb-organizer-canvas:${String(projectId || "session")}:${String(animationName || "")}`;
  }

  /**
   * Reports whether a canvas broadcast belongs to this tab's loaded animation.
   * @param {{animationName?:string,frames?:object[]}} state Organizer state.
   * @param {{tabId?:string,animationName?:string,uid?:string}} message Broadcast payload.
   * @param {string} tabId Local tab id.
   * @returns {boolean}
   */
  function shouldAcceptRemoteCanvas(state, message, tabId) {
    if (!message || message.tabId === tabId) return false;
    if (String(state?.animationName || "") !== String(message.animationName || "")) return false;
    return Array.from(state?.frames || []).some((frame) => String(frame.uid) === String(message.uid));
  }

  /**
   * Writes a remote or hydrated bitmap onto one organizer frame.
   * @param {object} frame Organizer frame.
   * @param {HTMLCanvasElement|object} canvas Replacement bitmap.
   * @param {number} revision Asset revision from the publisher.
   * @returns {object} The same frame.
   */
  function applyEditedCanvas(frame, canvas, revision) {
    if (!frame) return frame;
    frame.editedCanvas = canvas;
    frame.hasEditedResult = true;
    frame.assetRevision = Math.max(0, Number(frame.assetRevision) || 0, Number(revision) || 0);
    frame.thumbnails = frame.thumbnails || { original: "", edited: "" };
    frame.thumbnails.edited = "";
    frame.signature = null;
    return frame;
  }

  /**
   * Creates a Map-backed canvas store for tests and fallback environments.
   * @returns {{put:Function,get:Function}}
   */
  function createMemoryStorage() {
    const records = new Map();
    return {
      async put(topic, uid, blob, revision) {
        records.set(`${topic}:${uid}`, { blob, revision });
      },
      async get(topic, uid) {
        return records.get(`${topic}:${uid}`) || null;
      },
    };
  }

  /**
   * Opens an IndexedDB object store for cutout canvases.
   * @param {IDBFactory} indexedDb Browser IndexedDB.
   * @returns {Promise<{put:Function,get:Function}>}
   */
  function createIndexedDbStorage(indexedDb) {
    if (!indexedDb?.open) return Promise.resolve(createMemoryStorage());
    const request = indexedDb.open("xsxb-organizer-workset", 1);
    return new Promise((resolve, reject) => {
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("canvases")) db.createObjectStore("canvases");
      };
      request.onerror = () => reject(request.error || new Error("Organizer canvas store failed to open."));
      request.onsuccess = () => {
        const db = request.result;
        resolve({
          async put(topic, uid, blob, revision) {
            await idbRequest(
              db
                .transaction("canvases", "readwrite")
                .objectStore("canvases")
                .put({ blob, revision }, `${topic}:${uid}`),
            );
          },
          async get(topic, uid) {
            return (
              (await idbRequest(db.transaction("canvases").objectStore("canvases").get(`${topic}:${uid}`))) ||
              null
            );
          },
        });
      };
    });
  }

  function idbRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Organizer canvas store request failed."));
    });
  }

  function defaultCanvasToBlob(canvas) {
    if (typeof canvas?.toBlob === "function") {
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Unable to encode organizer canvas."));
        }, "image/png");
      });
    }
    if (typeof canvas?.toDataURL === "function") return Promise.resolve(canvas.toDataURL("image/png"));
    return Promise.resolve(canvas);
  }

  function defaultBlobToCanvas(blob, documentRef) {
    if (!documentRef?.createElement) return Promise.resolve(blob);
    const url = typeof blob === "string" && blob.startsWith("data:") ? blob : root.URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      const image = new root.Image();
      image.onload = () => {
        const canvas = documentRef.createElement("canvas");
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        canvas.getContext("2d").drawImage(image, 0, 0);
        if (typeof blob !== "string") root.URL.revokeObjectURL(url);
        resolve(canvas);
      };
      image.onerror = () => {
        if (typeof blob !== "string") root.URL.revokeObjectURL(url);
        reject(new Error("Unable to decode organizer canvas."));
      };
      image.src = url;
    });
  }

  /**
   * Creates the cross-tab organizer canvas synchronizer.
   * @param {object} [dependencies] Storage, broadcast, and bitmap adapters.
   * @returns {{bind:Function,publishFrame:Function,hydrateFrames:Function,tabId:string}}
   */
  function createController(dependencies = {}) {
    const tabId = String(dependencies.tabId || root.crypto?.randomUUID?.() || `tab_${Date.now()}`);
    const storage = dependencies.storage || createMemoryStorage();
    const channel = dependencies.channel;
    const canvasToBlob = dependencies.canvasToBlob || defaultCanvasToBlob;
    const blobToCanvas =
      dependencies.blobToCanvas ||
      ((blob) => defaultBlobToCanvas(blob, dependencies.documentRef || root.document));
    const getState = dependencies.getState || (() => null);
    const onRemoteApply = dependencies.onRemoteApply || (() => {});
    let bound = false;

    async function publishFrame(projectId, animationName, frame) {
      if (!frame?.hasEditedResult || !frame.editedCanvas) return;
      const topic = worksetSyncTopic(projectId, animationName);
      const revision = Math.max(1, Number(frame.assetRevision) || 1);
      const blob = await canvasToBlob(frame.editedCanvas);
      await storage.put(topic, frame.uid, blob, revision);
      channel?.postMessage?.({
        type: "canvas",
        tabId,
        projectId,
        animationName,
        uid: String(frame.uid),
        revision,
      });
    }

    async function hydrateFrames(projectId, animationName, frames) {
      const topic = worksetSyncTopic(projectId, animationName);
      for (const frame of frames || []) {
        const record = await storage.get(topic, frame.uid);
        if (!record?.blob) continue;
        const canvas = await blobToCanvas(record.blob);
        applyEditedCanvas(frame, canvas, record.revision);
      }
    }

    async function handleMessage(event) {
      const message = event?.data || event;
      const state = getState();
      if (!shouldAcceptRemoteCanvas(state, message, tabId)) return;
      const frame = Array.from(state.frames || []).find((entry) => String(entry.uid) === String(message.uid));
      if (!frame) return;
      const record = await storage.get(
        worksetSyncTopic(message.projectId, message.animationName),
        message.uid,
      );
      if (!record?.blob) return;
      const canvas = await blobToCanvas(record.blob);
      applyEditedCanvas(frame, canvas, record.revision);
      onRemoteApply(frame, message);
    }

    function bind() {
      if (bound) return;
      bound = true;
      channel?.addEventListener?.("message", handleMessage);
    }

    return { bind, hydrateFrames, publishFrame, tabId };
  }

  return {
    applyEditedCanvas,
    createController,
    createIndexedDbStorage,
    createMemoryStorage,
    shouldAcceptRemoteCanvas,
    worksetSyncTopic,
  };
});
