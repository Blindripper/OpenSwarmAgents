export function readStoredItem(primaryKey: string, legacyKeys: string[] = []): string | null {
  try {
    const value = localStorage.getItem(primaryKey);
    if (value !== null) return value;
    for (const key of legacyKeys) {
      const legacy = localStorage.getItem(key);
      if (legacy !== null) return legacy;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function writeStoredItem(primaryKey: string, value: string) {
  try {
    localStorage.setItem(primaryKey, value);
  } catch {
    /* ignore */
  }
}

export function removeStoredItems(primaryKey: string, legacyKeys: string[] = []) {
  try {
    localStorage.removeItem(primaryKey);
    for (const key of legacyKeys) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
