# Node.js receiver for LumoAuth webhooks

A complete receiver on the Node.js standard library: `server.ts` (the production route) and
`dev-route.ts` (a route for `lumo tunnel`, outside production only). Both import
`lumoauth-webhook.ts`, the verification function in `SKILL.md`. The files were run on
Node.js 24; Node.js 22.18 or later runs `.ts` files directly, and an older version needs the
project's TypeScript build.

## `server.ts`

```ts
import { createServer, type IncomingMessage } from "node:http";
import { verifyLumoAuthWebhook, WebhookVerificationError, type LumoAuthDelivery } from "./lumoauth-webhook.ts";

// Current secret first. Keep the previous secret only while a rotation is in progress.
const secrets = [process.env.LUMOAUTH_WEBHOOK_SECRET, process.env.LUMOAUTH_WEBHOOK_SECRET_PREVIOUS]
  .filter((s): s is string => typeof s === "string" && s !== "");

// Replace both with durable storage in production (see "Replay protection").
const seenDeliveries = new Map<string, number>();
const queue: LumoAuthDelivery[] = [];

function readBody(req: IncomingMessage, limitBytes = 1_048_576): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/webhooks/lumoauth") {
    res.writeHead(404).end();
    return;
  }
  try {
    const rawBody = await readBody(req);
    const header = req.headers["x-lumoauth-signature"];
    const delivery = verifyLumoAuthWebhook(rawBody, Array.isArray(header) ? header[0] : header, secrets);

    if (!seenDeliveries.has(delivery.deliveryId)) {
      queue.push(delivery); // hand over to a worker; do not process here
      seenDeliveries.set(delivery.deliveryId, Date.now());
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end('{"received":true}');
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      res.writeHead(401).end();
      return;
    }
    res.writeHead(500).end();
  }
});

server.listen(Number(process.env.PORT ?? 3000));

// Worker loop: process queued events outside the request.
setInterval(() => {
  const delivery = queue.shift();
  if (!delivery) return;
  switch (delivery.event) {
    case "user.created":
      console.log("new user", delivery.data.target_id);
      break;
    default:
      break; // ignore events that this app does not handle
  }
}, 100);
```

What to replace before production:

| Example | Production |
|---|---|
| `seenDeliveries` (a `Map` in memory) | A table with a unique delivery ID column, or a cache key that is set only if absent and expires after at least two days |
| `queue` (an array in memory) | The app's job queue, or an "inbox" table that a worker reads |
| `setInterval` worker | The app's worker process |
| `console.log` | The app's logger. Do not log the signature header or the secret |

Store the delivery ID and the queued event in one transaction when both are in the same
database. Otherwise write the event first and the ID second: a crash between the two writes
then causes a repeat (which the idempotent worker absorbs), not a lost event.

Run it:

```bash
LUMOAUTH_WEBHOOK_SECRET="$(cat /path/to/secret)" PORT=3000 node server.ts
```

Read the secret from the platform's secret store in a deployed app. The command above is
for a local run only.

## The same route in Express

`express.raw()` gives the handler the body as a `Buffer`. Register this route before any
`express.json()` middleware, or the parsed body replaces the raw bytes.

```ts
import express from "express";
import { verifyLumoAuthWebhook, WebhookVerificationError, type LumoAuthDelivery } from "./lumoauth-webhook.ts";

const secrets = [process.env.LUMOAUTH_WEBHOOK_SECRET, process.env.LUMOAUTH_WEBHOOK_SECRET_PREVIOUS]
  .filter((s): s is string => typeof s === "string" && s !== "");

const seenDeliveries = new Set<string>(); // replace with durable storage
const queue: LumoAuthDelivery[] = [];     // replace with the app's job queue

const app = express();

app.post("/webhooks/lumoauth", express.raw({ type: "application/json", limit: "1mb" }), (req, res) => {
  try {
    const delivery = verifyLumoAuthWebhook(req.body as Buffer, req.get("X-LumoAuth-Signature"), secrets);
    if (!seenDeliveries.has(delivery.deliveryId)) {
      queue.push(delivery);
      seenDeliveries.add(delivery.deliveryId);
    }
    res.status(200).json({ received: true });
  } catch (err) {
    res.sendStatus(err instanceof WebhookVerificationError ? 401 : 500);
  }
});

app.use(express.json()); // other routes

app.listen(Number(process.env.PORT ?? 3000));
```

## `dev-route.ts`: requests from `lumo tunnel`

`lumo tunnel` posts the event's `data` object as the body, with the event name in
`X-LumoAuth-Event` and the delivery ID in `X-LumoAuth-Delivery`. The request has no
signature. This route accepts it outside production only, and passes the same
`LumoAuthDelivery` object to the same queue as the production route.

```ts
// dev-route.ts: register only when NODE_ENV !== "production"
import type { IncomingMessage, ServerResponse } from "node:http";
import type { LumoAuthDelivery } from "./lumoauth-webhook.ts";

export async function handleTunnelRequest(
  req: IncomingMessage,
  res: ServerResponse,
  rawBody: Buffer,
  enqueue: (delivery: LumoAuthDelivery) => void,
): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    res.writeHead(404).end();
    return;
  }
  const event = String(req.headers["x-lumoauth-event"] ?? "");
  const deliveryId = String(req.headers["x-lumoauth-delivery"] ?? "");
  enqueue({
    deliveryId,
    signedAt: Math.floor(Date.now() / 1000),
    event,
    tenant: process.env.LUMO_ORG ?? "",
    data: JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>,
  });
  res.writeHead(200).end();
}
```

Wire it into `server.ts` next to the production route:

```ts
if (req.method === "POST" && req.url === "/webhooks/lumoauth-dev") {
  const rawBody = await readBody(req);
  await handleTunnelRequest(req, res, rawBody, (delivery) => queue.push(delivery));
  return;
}
```

```bash
lumo tunnel --to http://localhost:3000/webhooks/lumoauth-dev --filter user.created
```

Never deploy a route that skips verification. The check on `NODE_ENV` in the function is a
second guard; the first guard is that production does not register the route.
