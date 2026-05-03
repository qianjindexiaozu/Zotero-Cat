const GLOBAL_SCOPE_KEY = "__global__";

export function resolveConversationScopeKey(item: Zotero.Item | null) {
  return resolveItemScopeKey(item);
}

export function resolveCustomContextKey(item: Zotero.Item | null) {
  return resolveItemScopeKey(item);
}

export function resolveItemScopeKey(item: Zotero.Item | null) {
  const primaryItem = resolvePrimaryContextItem(item);
  if (!primaryItem?.key) {
    return GLOBAL_SCOPE_KEY;
  }
  const libraryID =
    typeof primaryItem.libraryID === "number"
      ? String(primaryItem.libraryID)
      : "unknown";
  return `${libraryID}:${primaryItem.key}`;
}

export function resolvePrimaryContextItem(item: Zotero.Item | null) {
  if (!item) {
    return null;
  }
  let current: Zotero.Item = item;
  let guard = 0;
  while (current.parentItem && guard < 6) {
    current = current.parentItem;
    guard += 1;
  }
  return current;
}
