export async function api(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(
      result.error || `服务器请求失败（${response.status}），请稍后重试。`,
    );
  }
  return response;
}

export async function apiJSON(url, method = "GET", value) {
  const response = await api(url, {
    method,
    ...(value === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        }),
  });
  return response.json();
}

export async function uploadCSV(folderId, file) {
  const response = await api(
    `/api/folders/${folderId}/files?name=${encodeURIComponent(file.name)}`,
    {
      method: "POST",
      headers: { "Content-Type": "text/csv; charset=utf-8" },
      body: file,
    },
  );
  return response.json();
}

export async function storedCSV(metadata) {
  const response = await api(`/api/files/${metadata.id}`);
  return new File([await response.blob()], metadata.filename, {
    type: "text/csv",
  });
}

function localGet(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}
function localSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Server persistence still works if browser storage is disabled. */
  }
}

const DRAFT_KEY = "visualizemetrics-workspace-draft-v1";
const CLIENT_KEY = "visualizemetrics-client-v1";

// Persist only view configuration here; CSV bytes live exclusively on the server.
export function createPersistence(snapshot, onStatus) {
  const clientId =
    localGet(CLIENT_KEY) ||
    `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localSet(CLIENT_KEY, clientId);
  let sequence = Date.now(),
    ready = false,
    pending = null,
    inFlight = null,
    timer;
  let lastSnapshot = "";
  let lastEnvelope = null;

  function schedule() {
    if (!ready) return;
    const value = snapshot();
    const serialized = JSON.stringify(value);
    if (serialized === lastSnapshot) return;
    lastSnapshot = serialized;
    sequence = Math.max(
      sequence + 1,
      Date.now(),
      (localGet(DRAFT_KEY)?.sequence ?? 0) + 1,
    );
    pending = { clientId, sequence, value };
    lastEnvelope = pending;
    localSet(DRAFT_KEY, pending);
    onStatus("saving");
    clearTimeout(timer);
    timer = setTimeout(flush, 250);
  }

  async function flush() {
    clearTimeout(timer);
    if (inFlight) {
      await inFlight;
      if (pending) return flush();
      return;
    }
    if (!pending || !ready) return;
    const sending = pending;
    pending = null;
    inFlight = (async () => {
      try {
        await apiJSON("/api/workspace", "PUT", sending);
        if (localGet(DRAFT_KEY)?.sequence === sending.sequence)
          localSet(DRAFT_KEY, null);
        onStatus(pending ? "saving" : "saved");
      } catch (error) {
        pending ??= sending;
        onStatus("error", error.message);
      }
    })();
    await inFlight;
    inFlight = null;
    // New edits made while the preceding request was in flight are saved next.
    if (pending && pending.sequence > sending.sequence) return flush();
  }

  function leave() {
    if (!ready) return;
    const draft = localGet(DRAFT_KEY) || lastEnvelope;
    if (!draft || draft.clientId !== clientId) return;
    const body = JSON.stringify(draft);
    if (new Blob([body]).size <= 60_000)
      navigator.sendBeacon(
        "/api/workspace",
        new Blob([body], { type: "application/json" }),
      );
  }
  window.addEventListener("pagehide", leave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") leave();
  });
  window.addEventListener("online", flush);
  return {
    schedule,
    flush,
    restore(saved) {
      if (saved?.clientId === clientId)
        sequence = Math.max(sequence, saved.sequence);
      const draft = localGet(DRAFT_KEY);
      if (
        draft?.clientId === clientId &&
        (!saved ||
          saved.clientId !== clientId ||
          draft.sequence > saved.sequence)
      ) {
        sequence = Math.max(sequence, draft.sequence);
        return draft.value;
      }
      if (
        draft &&
        saved?.clientId === clientId &&
        saved.sequence >= draft.sequence
      )
        localSet(DRAFT_KEY, null);
      return saved?.value ?? null;
    },
    enable() {
      ready = true;
      schedule();
    },
  };
}
