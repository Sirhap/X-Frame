(function attachXsxbBrowserProjectStorage(root, factory) {
  "use strict";

  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.XSXBBrowserProjectStorage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const DATABASE_NAME = "xsxb-frame-tuner-projects";
  const DATABASE_VERSION = 1;
  const OBJECT_STORE_NAME = "state";
  const STATE_KEY = "browser-projects";

  /** Resolves an IndexedDB request as a promise. */
  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener(
        "error",
        () => reject(request.error || new Error("IndexedDB request failed.")),
        {
          once: true,
        },
      );
    });
  }

  /** Waits for an IndexedDB transaction to commit. */
  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.addEventListener("complete", resolve, { once: true });
      transaction.addEventListener(
        "abort",
        () => reject(transaction.error || new Error("IndexedDB transaction was aborted.")),
        { once: true },
      );
      transaction.addEventListener(
        "error",
        () => reject(transaction.error || new Error("IndexedDB transaction failed.")),
        { once: true },
      );
    });
  }

  /** Creates the IndexedDB adapter used by the project snapshot store. */
  function createIndexedDbAdapter(indexedDBRef, databaseName = DATABASE_NAME) {
    if (!indexedDBRef?.open) return null;
    let databasePromise = null;

    /** Opens the project database once for this page lifecycle. */
    function database() {
      if (databasePromise) return databasePromise;
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDBRef.open(databaseName, DATABASE_VERSION);
        request.addEventListener(
          "upgradeneeded",
          () => {
            if (!request.result.objectStoreNames.contains(OBJECT_STORE_NAME)) {
              request.result.createObjectStore(OBJECT_STORE_NAME);
            }
          },
          { once: true },
        );
        request.addEventListener("success", () => resolve(request.result), { once: true });
        request.addEventListener(
          "error",
          () => reject(request.error || new Error("Browser project storage could not be opened.")),
          { once: true },
        );
      });
      return databasePromise;
    }

    return {
      async read() {
        const db = await database();
        const transaction = db.transaction(OBJECT_STORE_NAME, "readonly");
        return requestResult(transaction.objectStore(OBJECT_STORE_NAME).get(STATE_KEY));
      },
      async write(snapshot) {
        const db = await database();
        const transaction = db.transaction(OBJECT_STORE_NAME, "readwrite");
        transaction.objectStore(OBJECT_STORE_NAME).put(snapshot, STATE_KEY);
        await transactionDone(transaction);
      },
    };
  }

  /**
   * Creates a serialized project snapshot store.
   * @param {{indexedDBRef?:IDBFactory|null,adapter?:{read:()=>Promise<object|null>,write:(snapshot:object)=>Promise<void>},clone?:(value:any)=>any,databaseName?:string}} dependencies Storage dependencies.
   * @returns {{load:()=>Promise<object|null>,save:(registry:object,projects:Map<string,object>)=>Promise<boolean>}}
   */
  function createStore(dependencies = {}) {
    const clone =
      dependencies.clone ||
      ((value) => {
        if (typeof root?.structuredClone === "function") return root.structuredClone(value);
        return JSON.parse(JSON.stringify(value));
      });
    const indexedDBRef =
      dependencies.indexedDBRef === undefined ? root?.indexedDB : dependencies.indexedDBRef;
    const adapter =
      dependencies.adapter ||
      createIndexedDbAdapter(indexedDBRef, dependencies.databaseName || DATABASE_NAME);
    let writeQueue = Promise.resolve();

    async function load() {
      if (!adapter) return null;
      const snapshot = await adapter.read();
      if (
        snapshot?.version !== 1 ||
        !Array.isArray(snapshot?.registry?.projects) ||
        !Array.isArray(snapshot?.projects)
      ) {
        return null;
      }
      return clone(snapshot);
    }

    async function save(registry, projects) {
      if (!adapter) return false;
      const snapshot = clone({
        version: 1,
        registry,
        projects: Array.from(projects || [], ([projectId, config]) => [projectId, config]),
      });
      writeQueue = writeQueue.catch(() => {}).then(() => adapter.write(snapshot));
      await writeQueue;
      return true;
    }

    return Object.freeze({ load, save });
  }

  return Object.freeze({ createIndexedDbAdapter, createStore });
});
