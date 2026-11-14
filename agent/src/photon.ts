// Photon (https://photon.codes): iMessage warnings on its free shared line.
//
// A shared line cannot text someone first. It can only send in a conversation the other person started.
// So this is opt-in: a teammate texts the agent's number once, and from then on gets each warning.
// Texting STOP opts out again. Used by src/photon_relay.ts.

import { validateWarning } from "../tools/send_warning.js";

/** The parts of a Photon message this file reads. Matches @photon-ai/api's ReceivedImessageMessage. */
export interface PhotonMessage {
  id: string;
  platform: string;
  status: string;
  createdAt: string;
  content: { type: string; text?: string };
  space: { id: string };
  /** the agent's own user on the shared line: the sender for replies */
  receivedBy?: { id: string };
  sentBy?: { id: string; handle?: string };
}

/** The two Photon calls the notifier makes, so tests can pass a stub instead of the network client. */
export interface PhotonApi {
  listMessages(query: { platform: string; direction: string; pageSize: number; pageToken?: string }): Promise<{ items: PhotonMessage[]; nextPageToken?: string }>;
  sendMessage(key: string, body: { spaceId: string; senderId: string; content: { type: "text"; format: "plain"; text: string } }): Promise<{ status: string }>;
}

export interface Subscriber {
  /** the conversation to send into */
  spaceId: string;
  /** the agent's user id in that conversation */
  senderId: string;
  /** who opted in, for logs only (a phone number or iMessage email) */
  handle: string;
}

const STOP_RE = /^\s*(stop|unsubscribe|cancel|quit)\s*[.!]?\s*$/i;

/**
 * Who has opted in: one entry per conversation whose newest text from the person is not STOP.
 * Only received iMessage texts count, and only those that say which agent user received them.
 */
export function subscribersFrom(messages: PhotonMessage[]): Subscriber[] {
  const newest = new Map<string, PhotonMessage>();
  for (const m of messages) {
    if (m.platform !== "imessage" || m.status !== "received" || m.content?.type !== "text" || !m.receivedBy?.id) continue;
    const seen = newest.get(m.space.id);
    if (!seen || m.createdAt > seen.createdAt) newest.set(m.space.id, m);
  }
  const out: Subscriber[] = [];
  for (const m of newest.values()) {
    if (STOP_RE.test(m.content.text ?? "")) continue;
    out.push({ spaceId: m.space.id, senderId: m.receivedBy!.id, handle: m.sentBy?.handle ?? m.sentBy?.id ?? "unknown" });
  }
  return out.sort((a, b) => a.spaceId.localeCompare(b.spaceId));
}

/** Idempotency key for one warning to one conversation: resending the same alert never double-texts. */
export function warningKey(alertId: number | string, spaceId: string): string {
  return `gt-alert-${alertId}-${spaceId}`.replace(/[^\x21-\x7e]/g, "_").slice(0, 255);
}

export interface SendOutcome {
  subscribers: number;
  accepted: number;
  errors: string[];
}

const MAX_PAGES = 5;

export class PhotonNotifier {
  constructor(private api: PhotonApi, private log: (line: string) => void = () => {}) {}

  /** Reads recent received iMessages (newest first, up to 1,000) and works out who is opted in. */
  async subscribers(): Promise<Subscriber[]> {
    const all: PhotonMessage[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.api.listMessages({ platform: "imessage", direction: "received", pageSize: 200, ...(pageToken ? { pageToken } : {}) });
      all.push(...res.items);
      pageToken = res.nextPageToken;
      if (!pageToken) break;
    }
    return subscribersFrom(all);
  }

  /**
   * Sends one warning to everyone opted in. The text must pass the same checks as SMS warnings
   * (160 characters at most, no link). "Accepted" means Photon took the message, not that it was delivered.
   */
  async sendWarning(alertId: number | string, text: string): Promise<SendOutcome> {
    const problem = validateWarning(text);
    if (problem) throw new Error(`photon warning refused: ${problem}`);
    const subs = await this.subscribers();
    const outcome: SendOutcome = { subscribers: subs.length, accepted: 0, errors: [] };
    for (const s of subs) {
      try {
        const res = await this.api.sendMessage(warningKey(alertId, s.spaceId), {
          spaceId: s.spaceId,
          senderId: s.senderId,
          content: { type: "text", format: "plain", text },
        });
        if (res.status === "failed") outcome.errors.push(`${s.handle}: Photon reported the send as failed`);
        else outcome.accepted++;
      } catch (e) {
        outcome.errors.push(`${s.handle}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    for (const err of outcome.errors) this.log(`photon: ${err}`);
    return outcome;
  }
}
