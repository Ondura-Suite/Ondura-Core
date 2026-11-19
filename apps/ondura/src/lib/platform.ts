// Operating system of the window (for platform conventions: the macOS
// title bar, ⌘ instead of Ctrl).

const ua = typeof navigator !== "undefined" ? `${navigator.platform} ${navigator.userAgent}` : "";

export const IS_MAC = /Mac|iPhone|iPad/.test(ua);
export const IS_WINDOWS = /Win/.test(ua);
