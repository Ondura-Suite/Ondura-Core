// Small cross-module messages inside the Ondura Mail window.

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

/** The Ondura Mail window switches to the mail module on compose requests. */
export function onComposeSwitch(fn: () => void): () => void {
  switchers.add(fn);
  return () => switchers.delete(fn);
}

const openers = new Set<(messageId: string) => void>();
let pendingOpen: string | null = null;

/** Ask the mail module to show a message (e.g. from "Gekennzeichnete E-Mails"). */
export function requestOpenMessage(messageId: string): void {
  switchers.forEach((s) => s());
  if (openers.size === 0) pendingOpen = messageId;
  else openers.forEach((o) => o(messageId));
}

export function onOpenMessage(handler: (messageId: string) => void): () => void {
  openers.add(handler);
  if (pendingOpen) {
    const id = pendingOpen;
    pendingOpen = null;
    setTimeout(() => handler(id), 0);
  }
  return () => openers.delete(handler);
}

/** A new appointment prepared elsewhere (a message dragged onto the calendar). */
export interface EventRequest {
  title: string;
  body: string;
  /** Attendees as "Name <address>" or plain addresses. */
  attendees: string[];
}

const eventHandlers = new Set<(r: EventRequest) => void>();
let pendingEvent: EventRequest | null = null;

/** Ask the calendar module to open a new appointment with these details. */
export function requestNewEvent(req: EventRequest): void {
  if (eventHandlers.size === 0) pendingEvent = req;
  else eventHandlers.forEach((h) => h(req));
}

export function onNewEventRequest(handler: (req: EventRequest) => void): () => void {
  eventHandlers.add(handler);
  if (pendingEvent) {
    const req = pendingEvent;
    pendingEvent = null;
    setTimeout(() => handler(req), 0);
  }
  return () => eventHandlers.delete(handler);
}

/** Drag type of messages from the mail list (JSON array of message ids). */
export const MESSAGE_DRAG = "application/x-ondura-messages";
