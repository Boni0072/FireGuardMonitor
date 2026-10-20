
import { createHash, timingSafeEqual } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  getFirestore,
} from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

initializeApp();

const db = getFirestore();
const REGION = "southamerica-east1";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const receiveEvent = onRequest(
  {
    region: REGION,
    cors: false,
    maxInstances: 10,
    timeoutSeconds: 15,
    memory: "256MiB",
  },
  async (req, res) => {
    res.set("Cache-Control", "no-store");

    if (req.method !== "POST") {
      res.set("Allow", "POST");
      res.status(405).json({ error: "method_not_allowed" });
      return;
    }

    const match = req.path.match(
      /^\/api\/v1\/devices\/([A-Za-z0-9_-]{1,64})\/events\/?$/
    );

    if (!match) {
      res.status(404).json({ error: "route_not_found" });
      return;
    }

    const deviceId = match[1];
    const authorization = req.get("authorization") ?? "";
    const tokenMatch = authorization.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/);

    if (!tokenMatch) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    if (!req.is("application/json")) {
      res.status(415).json({ error: "content_type_must_be_json" });
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      res.status(400).json({ error: "invalid_json_body" });
      return;
    }

    const allowedTypes = ["FIRE_ALARM", "FAULT", "HEARTBEAT", "CLEARED"];
    const type = body.type;
    const eventId = body.eventId;
    const occurredAt = body.occurredAt;

    if (
      typeof type !== "string" ||
      !allowedTypes.includes(type) ||
      typeof eventId !== "string" ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(eventId) ||
      typeof occurredAt !== "string" ||
      !Number.isFinite(Date.parse(occurredAt))
    ) {
      res.status(400).json({ error: "invalid_event_fields" });
      return;
    }

    const deviceRef = db.collection("devices").doc(deviceId);

    try {
      const deviceSnapshot = await deviceRef.get();

      if (!deviceSnapshot.exists) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      const device = deviceSnapshot.data()!;
      const providedHash = sha256(tokenMatch[1]);

      if (
        device.active !== true ||
        typeof device.tokenHash !== "string" ||
        !safeEqual(providedHash, device.tokenHash)
      ) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }

      if (typeof device.tenantId !== "string" || !device.tenantId) {
        logger.error("Device missing tenantId", { deviceId });
        res.status(500).json({ error: "device_configuration_error" });
        return;
      }

      const tenantId = device.tenantId;
      const currentDeviceRef = db
        .collection("tenants")
        .doc(tenantId)
        .collection("devices")
        .doc(deviceId);

      const eventRef = currentDeviceRef.collection("events").doc(eventId);
      const eventTime = Date.parse(occurredAt);
      const now = Date.now();

      // Reject timestamps too far in the future.
      if (eventTime > now + 5 * 60 * 1000) {
        res.status(400).json({ error: "event_time_in_future" });
        return;
      }

      const result = await db.runTransaction(async (tx) => {
        const existingEvent = await tx.get(eventRef);

        if (existingEvent.exists) {
          return { duplicate: true };
        }

        const currentSnapshot = await tx.get(currentDeviceRef);
        const current = currentSnapshot.data();
        const currentEventTime =
          typeof current?.lastEventAtMs === "number"
            ? current.lastEventAtMs
            : -1;

        tx.create(eventRef, {
          eventId,
          deviceId,
          tenantId,
          type,
          occurredAt: new Date(eventTime).toISOString(),
          receivedAt: FieldValue.serverTimestamp(),
          receivedAtMs: now,
          payload: {
            source: typeof body.source === "string"
              ? body.source.slice(0, 100)
              : null,
          },
        });

        const update: Record<string, unknown> = {
          deviceId,
          tenantId,
          lastSeenAt: FieldValue.serverTimestamp(),
          lastSeenAtMs: now,
          updatedAt: FieldValue.serverTimestamp(),
        };

        // Older events are stored for audit but cannot overwrite current state.
        if (eventTime >= currentEventTime) {
          update.lastEventAtMs = eventTime;
          update.lastEventType = type;

          if (type === "FIRE_ALARM") {
            update.alarmStatus = "ACTIVE";
          } else if (type === "CLEARED") {
            update.alarmStatus = "CLEARED";
          } else if (type === "FAULT") {
            update.faultStatus = "ACTIVE";
          } else if (type === "HEARTBEAT") {
            update.connectionStatus = "ONLINE";
          }
        }

        tx.set(currentDeviceRef, update, { merge: true });
        return { duplicate: false };
      });

      res.status(result.duplicate ? 200 : 202).json({
        ok: true,
        duplicate: result.duplicate,
        deviceId,
      });
    } catch (error) {
      logger.error("Failed to process device event", { deviceId, error });
      res.status(500).json({ error: "internal_error" });
    }
  }
);
