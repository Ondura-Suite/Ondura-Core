// Small cross-module messages inside the Nexora Mail window.

export interface ComposeRequest {
  to: { name: string | null; email: string }[];
  subject?: string;
}

type Handler = (req: ComposeRequest) => void;

const handlers = new Set<Handler>();
const switchers = new Set<() => void>();
/** Request made before the mail module was mounted. */
let pending: ComposeRequest | null = null;

/** Ask the mail module to open a new message (e.g. "E-Mail an Gruppe"). */
export function requestCompose(req: ComposeRequest): void {
  switchers.forEach((s) => s());
  if (handlers.size === 0) pending = req;
  else handlers.forEach((h) => h(req));
}

/** The mail module registers here; a pending request is delivered at once. */
export function onComposeRequest(handler: Handler): () => void {
  handlers.add(handler);
  if (pending) {
    const req = pending;
    pending = null;
    setTimeout(() => handler(req), 0);
  }
  return () => handlers.delete(handler);
}

/** The Nexora Mail window switches to the mail module on compose requests. */
export function onComposeSwitch(fn: () => void): () => void {
  switchers.add(fn);
  return () => switchers.delete(fn);
}
