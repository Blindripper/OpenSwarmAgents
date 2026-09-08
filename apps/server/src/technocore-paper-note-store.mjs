import { decodePaperRecord, encodePaperRecord } from "@flop-labs/tclk";

const NOTE_COMPONENT = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function createTechnocorePaperNoteStore({ request, mirror = null } = {}) {
  if (typeof request !== "function") throw new TypeError("Technocore PaperRail NoteStore requires a request function");

  return {
    async get(namespace, key) {
      const path = paperKvPath(namespace, key);
      const response = await request(path, {
        method: "GET",
        redirect: "error",
        cache: "no-store",
        headers: { accept: "text/plain" },
      });
      if (response.status === 404) return null;
      if (!response.ok) throw noteHttpError(namespace, key, response.status);
      const raw = await response.text();
      const line = raw.split("\n").find((candidate) => candidate.startsWith("tclkpaper1 ")) ?? null;
      if (line !== null) {
        requireCanonicalPaperRecord(line);
        await mirror?.(namespace, key, line);
      }
      return line;
    },

    async set(namespace, key, value, condition) {
      const canonical = requireCanonicalPaperRecord(value);
      const query = condition === undefined
        ? ""
        : Object.hasOwn(condition, "ifAbsent")
          ? "?if_absent=1"
          : Object.hasOwn(condition, "if")
            ? `?if=${encodeURIComponent(String(condition.if))}`
            : invalidCondition();
      if (condition && Object.hasOwn(condition, "if")) requireCanonicalPaperRecord(condition.if);
      const path = `${paperKvPath(namespace, key)}/set/${encodeURIComponent(canonical)}${query}`;
      const response = await request(path, {
        method: "GET",
        redirect: "error",
        cache: "no-store",
        headers: { accept: "text/plain" },
      });
      if (response.status === 409) return false;
      if (!response.ok) throw noteHttpError(namespace, key, response.status);
      await mirror?.(namespace, key, canonical);
      return true;
    },
  };
}

export function paperKvPath(namespace, key) {
  const ns = String(namespace || "");
  const noteKey = String(key || "");
  if (!NOTE_COMPONENT.test(ns) || !NOTE_COMPONENT.test(noteKey)) throw new Error("Invalid Technocore PaperRail note path");
  return `/kv/${ns}/${noteKey}`;
}

export function requireCanonicalPaperRecord(value) {
  const text = String(value ?? "");
  const decoded = decodePaperRecord(text);
  if (!decoded || encodePaperRecord(decoded) !== text) throw new Error("Invalid canonical PaperRail wire record");
  return text;
}

function noteHttpError(namespace, key, status) {
  const error = new Error(`Technocore PaperRail note ${namespace}/${key} returned ${status}`);
  error.statusCode = Number(status) || 502;
  error.technocoreStatus = Number(status) || 502;
  return error;
}

function invalidCondition() {
  throw new Error("Invalid Technocore PaperRail note condition");
}
