// iMessage relay: sends the agent's warnings by iMessage through Photon (https://photon.codes), free plan.
//
// It watches the Spacetime `alert` table and sends each new warning to everyone who has opted in.
// It does not change the agent: it only reads alerts. Runs next to the agent, like the ntfy relay.
//
// Opt in:  text anything to the agent's shared number from a phone you registered in the Photon dashboard.
// Opt out: text STOP to it.
// Photon's shared line cannot text anyone first, so nobody gets a warning without opting in.
//
//   npm run photon                 # watch for warnings and send them
//   npm run photon -- --who        # list who is opted in, then exit
//   npm run photon -- --test       # send one test message to everyone opted in, then exit
//
// Settings (environment or the repo's .env):
//   PHOTON_API_KEY           required. A project API key (pho_sk_...) with project:read and project:write.
//   PHOTON_PROJECT_ID        required. Starts with pho_prj_ (dashboard, Settings).
//   PHOTON_PIN               "lat,lon" of the demo phone; only alerts whose zone covers it are sent (default: the
//                            Android app's demo spot). Set PHOTON_PIN=off to send every alert.
//   PHOTON_MIN_INTERVAL_S    at most one send per this many seconds (default 45; the agent writes two near-identical
//                            alerts per warning)
//   SPACETIME_HOST / SPACETIME_DB   as for the agent
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Photon } from "@photon-ai/api";
import { loadDotEnv, spacetimeConfig } from "./config.js";
import { PhotonNotifier, type PhotonApi, type PhotonMessage } from "./photon.js";

loadDotEnv(resolve(dirname(fileURLToPath(import.meta.url)), "../.env"));

const apiKey = process.env.PHOTON_API_KEY?.trim();
const projectId = process.env.PHOTON_PROJECT_ID?.trim();
if (!apiKey || !projectId) {
  console.error("Set PHOTON_API_KEY and PHOTON_PROJECT_ID (Photon dashboard: API keys, and Settings).");
  process.exit(1);
}
const minIntervalMs = Number(process.env.PHOTON_MIN_INTERVAL_S ?? 45) * 1000;
const pinEnv = (process.env.PHOTON_PIN ?? "32.98036,-96.76805").trim();
const pin: [number, number] | null = pinEnv === "off" ? null : (pinEnv.split(",").map(Number) as [number, number]);
const st = spacetimeConfig();

const photon = new Photon({ headers: { Authorization: `Bearer ${apiKey}` } });
const api: PhotonApi = {
  async listMessages(query) {
    const res = await photon.projects.listMessages({ path: { id: projectId }, query });
    return { items: res.items as unknown as PhotonMessage[], nextPageToken: res.nextPageToken };
  },
  async sendMessage(key, body) {
    const res = await photon.projects.sendMessage({ path: { id: projectId }, headers: { "idempotency-key": key }, body });
    return { status: String(res.status) };
  },
};
const notifier = new PhotonNotifier(api, (line) => console.error(line));

type LatLon = [number, number];
interface Alert { id: number; zone: LatLon[]; message: string; recipients: number }

/** Ray casting; polygons are [lat, lon] lists. */
function contains(p: LatLon, poly: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if (yi > p[0] !== yj > p[0] && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

async function readAlerts(): Promise<Alert[] | null> {
  try {
    const res = await fetch(`${st.host}/v1/database/${st.database}/sql`, {
      method: "POST",
      headers: { "content-type": "text/plain", ...(st.token ? { authorization: `Bearer ${st.token}` } : {}) },
      body: "SELECT * FROM alert",
    });
    if (!res.ok) return null;
    const out: Alert[] = [];
    for (const r of (await res.json()) as any[]) {
      const names: string[] = r.schema.elements.map((e: any) => (typeof e.name === "object" ? e.name?.some : e.name));
      for (const row of r.rows as any[][]) {
        const v = (n: string) => row[names.indexOf(n)];
        out.push({
          id: Number(v("id")), zone: JSON.parse(String(v("zone_json") ?? "[]")),
          message: String(v("message") ?? ""), recipients: Number(v("recipients")),
        });
      }
    }
    return out;
  } catch {
    return null;
  }
}

if (process.argv.includes("--who")) {
  const subs = await notifier.subscribers();
  console.log(subs.length ? `${subs.length} opted in:\n${subs.map((s) => `  ${s.handle}`).join("\n")}` : "Nobody is opted in yet. Text the agent's number from a registered phone.");
  process.exit(0);
}

if (process.argv.includes("--test")) {
  const out = await notifier.sendWarning(`test-${Date.now()}`, "Ghost Tower test. If you can read this, iMessage warnings work.");
  console.log(`test: Photon accepted ${out.accepted} of ${out.subscribers} (accepted is not the same as delivered)`);
  process.exit(out.subscribers > 0 && out.accepted === out.subscribers ? 0 : 1);
}

console.log(`photon relay: ${st.host}/${st.database} -> iMessage; pin ${pin ? pin.join(",") : "off (send every alert)"}`);

let lastId = -1; // highest alert id already looked at; -1 = not baselined yet
let sawAlerts = false;
let lastSendMs = 0;

for (;;) {
  const alerts = await readAlerts();
  if (alerts) {
    if (alerts.length === 0) {
      if (sawAlerts) console.log("alert table emptied (world reset); watching for new warnings");
      sawAlerts = false;
      if (lastId < 0) lastId = 0;
    } else if (lastId < 0) {
      // Alerts that already exist were sent before the relay was watching: don't send them.
      lastId = Math.max(...alerts.map((a) => a.id));
      sawAlerts = true;
    } else {
      sawAlerts = true;
      for (const a of alerts.filter((x) => x.id > lastId).sort((x, y) => x.id - y.id)) {
        lastId = a.id;
        if (pin && !contains(pin, a.zone)) {
          console.log(`alert ${a.id}: zone does not cover the demo phone, not sent`);
          continue;
        }
        if (Date.now() - lastSendMs < minIntervalMs) {
          console.log(`alert ${a.id}: within ${minIntervalMs / 1000} s of the last send, skipped`);
          continue;
        }
        try {
          const out = await notifier.sendWarning(a.id, a.message);
          if (out.accepted) lastSendMs = Date.now();
          console.log(`alert ${a.id}: Photon accepted ${out.accepted} of ${out.subscribers} iMessages: ${a.message}`);
        } catch (e) {
          console.error(`alert ${a.id}: not sent: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }
  await new Promise((r) => setTimeout(r, st.pollMs));
}
