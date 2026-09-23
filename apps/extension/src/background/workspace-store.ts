import {
  DEFAULT_WORKSPACE_STATE,
  normalizeWorkspaceState,
  WORKSPACE_STORAGE_KEY as WORKSPACE_KEY,
  type WorkspaceState,
} from "@channelpilot/shared";

export async function getWorkspaceState(): Promise<WorkspaceState> {
  const stored = await chrome.storage.local.get(WORKSPACE_KEY);
  const normalized = normalizeWorkspaceState(stored[WORKSPACE_KEY]);
  if (!normalized.updatedAt) {
    return {
      ...DEFAULT_WORKSPACE_STATE,
      ...normalized,
    };
  }
  return normalized;
}

export async function saveWorkspaceState(value: unknown): Promise<WorkspaceState> {
  const current = await getWorkspaceState();
  const incoming = normalizeWorkspaceState(value);
  if (incoming.updatedAt !== current.updatedAt) {
    throw new Error("WORKSPACE_CONFLICT");
  }
  const currentTime = Date.parse(current.updatedAt);
  const normalized = {
    ...incoming,
    updatedAt: new Date(
      Math.max(Date.now(), Number.isFinite(currentTime) ? currentTime + 1 : 0),
    ).toISOString(),
  } satisfies WorkspaceState;
  await chrome.storage.local.set({ [WORKSPACE_KEY]: normalized });
  return normalized;
}

export async function clearWorkspaceState(): Promise<void> {
  await chrome.storage.local.remove(WORKSPACE_KEY);
}
