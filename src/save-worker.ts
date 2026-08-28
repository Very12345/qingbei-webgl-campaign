/// <reference lib="webworker" />

export {};

const DATABASE_NAME = "qingbei-campaign-saves";
const DATABASE_VERSION = 1;
const STORE_NAME = "snapshots";

type SaveMessage = {
  type: "put" | "delete";
  requestId: number;
  key: string;
  value?: unknown;
};

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME))
        request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

self.onmessage = async (event: MessageEvent<SaveMessage>) => {
  const startedAt = performance.now(),
    message = event.data;
  try {
    const database = await openDatabase(),
      transaction = database.transaction(STORE_NAME, "readwrite"),
      store = transaction.objectStore(STORE_NAME);
    if (message.type === "put") store.put(message.value, message.key);
    else store.delete(message.key);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    self.postMessage({
      requestId: message.requestId,
      ok: true,
      durationMs: performance.now() - startedAt,
    });
  } catch (error) {
    self.postMessage({
      requestId: message.requestId,
      ok: false,
      durationMs: performance.now() - startedAt,
      error: error instanceof Error ? error.message : "IndexedDB write failed",
    });
  }
};
