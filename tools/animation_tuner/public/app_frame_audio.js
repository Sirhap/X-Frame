(function attachXsxbFrameAudio(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBFrameAudio = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  /**
   * Creates the browser-side frame-audio persistence controller.
   * @param {{
   *   dbName:string,
   *   dbVersion:number,
   *   storeName:string,
   *   getBindings:()=>Record<string,object>,
   *   getActiveProjectId:()=>string,
   *   getFrameAudioKey:(index:number,group:object)=>string,
   *   getFrameAudioMetadata:(index:number,group:object)=>object,
   *   getFrameAudioMetadataFromKey:(key:string)=>object|null,
   *   revokeBinding:(binding:object|null|undefined)=>void,
   *   status?:(message:string)=>void,
   *   translate?:(key:string,variables?:object)=>string,
   *   getConfig?:()=>object|null,
   *   indexedDBRef?:IDBFactory|null,
   *   urlApi?:typeof URL,
   *   audioConstructor?:typeof Audio,
   *   fileReaderConstructor?:typeof FileReader,
   *   fetchImpl?:typeof fetch,
   * }} dependencies Controller dependencies.
   * @returns {object} Frame-audio operations.
   */
  function createController(dependencies) {
    const {
      dbName,
      dbVersion,
      storeName,
      getBindings,
      getActiveProjectId,
      getFrameAudioKey,
      getFrameAudioMetadata,
      getFrameAudioMetadataFromKey,
      revokeBinding,
      status,
      translate,
      getConfig,
      indexedDBRef = root.indexedDB,
      urlApi = root.URL,
      audioConstructor = root.Audio,
      fileReaderConstructor = root.FileReader,
      fetchImpl = root.fetch,
    } = dependencies;
    let dbPromise = null;
    let syncPromise = null;

    /**
     * Reports a recoverable persistence failure to the existing UI layer.
     * @param {string} key Translation key.
     * @param {unknown} error Failure value.
     * @returns {void}
     */
    function reportFailure(key, error) {
      const message = error instanceof Error ? error.message : String(error);
      status?.(translate ? translate(key, { message }) : message);
    }

    /**
     * Opens the IndexedDB store once and reuses the connection promise.
     * @returns {Promise<IDBDatabase|null>} Database or null when unavailable.
     */
    function open() {
      if (typeof indexedDBRef === "undefined" || indexedDBRef === null) return Promise.resolve(null);
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDBRef.open(dbName, dbVersion);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: "key" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
        request.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
      });
      return dbPromise;
    }

    /**
     * Persists one Blob-backed frame-audio binding.
     * @param {string} key Frame binding key.
     * @param {{blob?:Blob,name?:string,type?:string,size?:number,metadata?:object}} binding Binding.
     * @returns {Promise<void>}
     */
    async function saveToDb(key, binding) {
      if (!key || !binding?.blob) return;
      try {
        const db = await open();
        if (!db) return;
        await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, "readwrite");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error("Audio save failed"));
          tx.objectStore(storeName).put({
            key,
            name: binding.name || "audio",
            type: binding.type || "",
            size: Number(binding.size || 0),
            metadata: binding.metadata || getFrameAudioMetadataFromKey(key),
            blob: binding.blob,
          });
        });
      } catch (error) {
        reportFailure("frameSfxSessionOnly", error);
      }
    }

    /**
     * Removes one frame-audio binding from IndexedDB.
     * @param {string} key Frame binding key.
     * @returns {Promise<void>}
     */
    async function deleteFromDb(key) {
      if (!key) return;
      try {
        const db = await open();
        if (!db) return;
        await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, "readwrite");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error("Audio delete failed"));
          tx.objectStore(storeName).delete(key);
        });
      } catch (error) {
        reportFailure("frameSfxDeleteFailed", error);
      }
    }

    /**
     * Restores persisted records that still have a matching project binding.
     * @returns {Promise<void>}
     */
    async function loadFromDb() {
      try {
        const db = await open();
        if (!db) return;
        const records = await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, "readonly");
          const request = tx.objectStore(storeName).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error || new Error("Audio load failed"));
        });
        const bindings = getBindings();
        for (const record of records) {
          if (!record?.key || !record.blob) continue;
          const existing = bindings[record.key];
          const metadata = existing?.metadata || record.metadata || getFrameAudioMetadataFromKey(record.key);
          if (!metadata || (metadata.projectId && metadata.projectId !== getActiveProjectId())) continue;
          if (existing) revokeBinding(existing);
          bindings[record.key] = {
            ...(existing || {}),
            key: record.key,
            name: existing?.name || record.name || "audio",
            url: urlApi.createObjectURL(record.blob),
            type: existing?.type || record.type || "",
            size: Number(existing?.size || record.size || 0),
            metadata,
            blob: record.blob,
            path: existing?.path || existing?.file || "",
            data: existing?.data || "",
          };
        }
      } catch (error) {
        reportFailure("frameSfxRestoreFailed", error);
      }
    }

    /**
     * Binds a selected file to one animation frame.
     * @param {File|Blob|null|undefined} file Audio file.
     * @param {number} index Frame index.
     * @param {object|null|undefined} group Animation group.
     * @returns {Promise<void>}
     */
    async function setBinding(file, index, group) {
      if (!file || !group) return;
      const key = getFrameAudioKey(index, group);
      const bindings = getBindings();
      revokeBinding(bindings[key]);
      bindings[key] = {
        key,
        name: file.name || "audio",
        url: urlApi.createObjectURL(file),
        type: file.type || "",
        size: Number(file.size || 0),
        metadata: getFrameAudioMetadata(index, group),
        blob: file,
      };
      await saveToDb(key, bindings[key]);
    }

    /**
     * Removes a frame-audio binding from memory and IndexedDB.
     * @param {number} index Frame index.
     * @param {object|null|undefined} group Animation group.
     * @returns {Promise<void>}
     */
    async function clearBinding(index, group) {
      const key = getFrameAudioKey(index, group);
      const bindings = getBindings();
      revokeBinding(bindings[key]);
      delete bindings[key];
      await deleteFromDb(key);
    }

    /**
     * Previews one frame's audio binding.
     * @param {number} index Frame index.
     * @param {object|null|undefined} group Animation group.
     * @returns {void}
     */
    function play(index, group) {
      const key = getFrameAudioKey(index, group);
      const binding = getBindings()[key];
      const source = binding?.url || binding?.data || "";
      if (!source || typeof audioConstructor !== "function") return;
      const audio = new audioConstructor(source);
      audio.preload = "auto";
      audio.play().catch((error) => reportFailure("audioPreviewBlocked", error));
    }

    /**
     * Converts a Blob to a data URL for the save API.
     * @param {Blob} blob Audio Blob.
     * @returns {Promise<string>} Data URL.
     */
    function blobToDataUrl(blob) {
      if (typeof fileReaderConstructor !== "function") {
        return Promise.reject(new Error("FileReader is unavailable."));
      }
      return new Promise((resolve, reject) => {
        const reader = new fileReaderConstructor();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("Audio read failed"));
        reader.readAsDataURL(blob);
      });
    }

    /**
     * Collects active project bindings into the server payload shape.
     * @returns {Promise<object[]>} Serializable frame-audio bindings.
     */
    async function collectForSave() {
      const result = [];
      for (const [key, binding] of Object.entries(getBindings())) {
        const metadata = binding.metadata || getFrameAudioMetadataFromKey(key);
        if (!metadata || metadata.projectId !== getActiveProjectId() || !metadata.animation) continue;
        const frame = Number(metadata.frame);
        if (!Number.isFinite(frame)) continue;
        const data = binding?.blob ? await blobToDataUrl(binding.blob) : String(binding?.data || "");
        const existingPath = String(binding?.path || binding?.file || "");
        if (!data && !existingPath) continue;
        result.push({
          key,
          ...metadata,
          frame,
          name: binding.name || "audio",
          type: binding.type || "",
          size: Number(binding.size || 0),
          ...(data ? { data } : {}),
          ...(existingPath ? { path: existingPath } : {}),
        });
      }
      return result;
    }

    /**
     * Synchronizes frame-audio bindings with the local project server.
     * @param {{silent?:boolean}} [options] Sync options.
     * @returns {Promise<object>} Server response.
     */
    async function syncToGame(options = {}) {
      const silent = options.silent === true;
      if (syncPromise) await syncPromise.catch(() => {});
      syncPromise = (async () => {
        if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable.");
        const bindings = await collectForSave();
        const response = await fetchImpl("/api/frame-audio", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: getActiveProjectId(), frameAudioBindings: bindings }),
        });
        if (!response.ok) throw new Error(await response.text());
        const result = await response.json();
        if (result.dataRevision && getConfig()) getConfig().dataRevision = result.dataRevision;
        if (!silent)
          status?.(translate ? translate("frameSfxSaved", { count: result.frameAudioCount || 0 }) : "Saved");
        return result;
      })();
      try {
        return await syncPromise;
      } finally {
        syncPromise = null;
      }
    }

    return {
      clearBinding,
      collectForSave,
      deleteFromDb,
      loadFromDb,
      open,
      play,
      saveToDb,
      setBinding,
      syncToGame,
    };
  }

  return { createController };
});
