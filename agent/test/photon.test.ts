import test from "node:test";
import assert from "node:assert/strict";
import { PhotonNotifier, subscribersFrom, warningKey, type PhotonApi, type PhotonMessage } from "../src/photon.js";

function received(space: string, text: string, createdAt: string, over: Partial<PhotonMessage> = {}): PhotonMessage {
  return {
    id: `msg-${space}-${createdAt}`,
    platform: "imessage",
    status: "received",
    createdAt,
    content: { type: "text", text },
    space: { id: space },
    receivedBy: { id: "agent-user" },
    sentBy: { id: `user-${space}`, handle: `+1555000${space}` },
    ...over,
  };
}

/** A stub Photon API: serves the given messages in pages of two and records every send. */
function stub(messages: PhotonMessage[], failFor: string[] = []) {
  const sends: { key: string; spaceId: string; senderId: string; text: string }[] = [];
  const api: PhotonApi = {
    async listMessages(q) {
      assert.equal(q.platform, "imessage");
      assert.equal(q.direction, "received");
      const start = q.pageToken ? Number(q.pageToken) : 0;
      const next = start + 2;
      return { items: messages.slice(start, next), ...(next < messages.length ? { nextPageToken: String(next) } : {}) };
    },
    async sendMessage(key, body) {
      if (failFor.includes(body.spaceId)) throw new Error("SENDER_NOT_AUTHORIZED");
      sends.push({ key, spaceId: body.spaceId, senderId: body.senderId, text: body.content.text });
      return { status: "accepted" };
    },
  };
  return { api, sends };
}

test("subscribersFrom: one entry per conversation, and only people who texted in", () => {
  const subs = subscribersFrom([
    received("2", "hi", "2026-11-14T10:00:00Z"),
    received("1", "subscribe", "2026-11-14T09:00:00Z"),
    received("1", "hello again", "2026-11-14T11:00:00Z"),
    received("3", "x", "2026-11-14T10:00:00Z", { status: "delivered" }), // something we sent, not an opt-in
    received("4", "x", "2026-11-14T10:00:00Z", { platform: "sms" }),
    received("5", "x", "2026-11-14T10:00:00Z", { receivedBy: undefined }),
  ]);
  assert.deepEqual(subs, [
    { spaceId: "1", senderId: "agent-user", handle: "+15550001" },
    { spaceId: "2", senderId: "agent-user", handle: "+15550002" },
  ]);
});

test("subscribersFrom: STOP opts out, and a later text opts back in", () => {
  const stop = [received("1", "hi", "2026-11-14T09:00:00Z"), received("1", " Stop. ", "2026-11-14T10:00:00Z")];
  assert.deepEqual(subscribersFrom(stop), []);
  assert.equal(subscribersFrom([...stop, received("1", "start", "2026-11-14T11:00:00Z")]).length, 1);
  assert.equal(subscribersFrom([received("1", "please stop the car", "2026-11-14T09:00:00Z")]).length, 1, "only a bare STOP counts");
});

test("warningKey: stable per alert and conversation, printable ASCII, at most 255 characters", () => {
  assert.equal(warningKey(7, "spc_1"), "gt-alert-7-spc_1");
  assert.equal(warningKey(7, "spc_1"), warningKey(7, "spc_1"));
  assert.notEqual(warningKey(7, "spc_1"), warningKey(8, "spc_1"));
  assert.match(warningKey(7, "a bé"), /^[\x21-\x7e]+$/);
  assert.equal(warningKey(7, "x".repeat(400)).length, 255);
});

test("sendWarning: reads every page, sends once per opted-in conversation with the alert's key", async () => {
  const { api, sends } = stub([
    received("1", "hi", "2026-11-14T09:00:00Z"),
    received("2", "hi", "2026-11-14T09:01:00Z"),
    received("3", "hi", "2026-11-14T09:02:00Z"),
    received("2", "STOP", "2026-11-14T09:03:00Z"),
  ]);
  const out = await new PhotonNotifier(api).sendWarning(12, "Fake cell tower nearby. Do not tap links in toll texts.");
  assert.deepEqual(out, { subscribers: 2, accepted: 2, errors: [] });
  assert.deepEqual(sends.map((s) => [s.spaceId, s.key, s.senderId]), [
    ["1", "gt-alert-12-1", "agent-user"],
    ["3", "gt-alert-12-3", "agent-user"],
  ]);
  assert.equal(sends[0].text, "Fake cell tower nearby. Do not tap links in toll texts.");
});

test("sendWarning: one failed conversation does not stop the others", async () => {
  const lines: string[] = [];
  const { api, sends } = stub([received("1", "hi", "2026-11-14T09:00:00Z"), received("2", "hi", "2026-11-14T09:01:00Z")], ["1"]);
  const out = await new PhotonNotifier(api, (l) => lines.push(l)).sendWarning(3, "Fake cell tower nearby.");
  assert.equal(out.accepted, 1);
  assert.equal(out.errors.length, 1);
  assert.equal(sends.length, 1);
  assert.match(lines[0], /SENDER_NOT_AUTHORIZED/);
});

test("sendWarning: refuses a link or a message over 160 characters, and sends nothing", async () => {
  const { api, sends } = stub([received("1", "hi", "2026-11-14T09:00:00Z")]);
  const n = new PhotonNotifier(api);
  await assert.rejects(n.sendWarning(1, "Pay at txtag-pay-demo.example now"), /link/);
  await assert.rejects(n.sendWarning(1, "x".repeat(161)), /160/);
  assert.equal(sends.length, 0);
});

test("sendWarning: nobody opted in means nothing is sent", async () => {
  const { api, sends } = stub([]);
  assert.deepEqual(await new PhotonNotifier(api).sendWarning(1, "Fake cell tower nearby."), { subscribers: 0, accepted: 0, errors: [] });
  assert.equal(sends.length, 0);
});
