/**
 * Theme-Galerie-Thumbnails in IndexedDB (MV3 kann keine dynamischen Dateien unter Modules/… anlegen).
 * Key = `galleryScreenshotRef` aus den Settings; Wert = JPEG-Data-URL-String.
 */
(function initGalleryThumbStore(global) {
  const ADM = global.ADM || (global.ADM = {});
  const DB_NAME = "adm_theme_gallery_thumbs";
  const STORE = "thumbs";
  let dbPromise = null;

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
      });
    }
    return dbPromise;
  }

  ADM.galleryThumbStore = {
    async put(ref, dataUrl) {
      const key = String(ref || "").trim();
      const val = String(dataUrl || "").trim();
      if (!key || !val.startsWith("data:image/")) throw new Error("bad_thumb_args");
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore(STORE).put(val, key);
      });
    },

    async get(ref) {
      const key = String(ref || "").trim();
      if (!key) return "";
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const rq = tx.objectStore(STORE).get(key);
        rq.onsuccess = () => resolve(String(rq.result || "").trim());
        rq.onerror = () => reject(rq.error);
      });
    },

    async delete(ref) {
      const key = String(ref || "").trim();
      if (!key) return;
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore(STORE).delete(key);
      });
    }
  };
})(self);
