import { useEffect, useRef, useState } from "react";
import type { Session, Team } from "../types";
import { readStoredItem, writeStoredItem, removeStoredItems } from "../storageKeys";

export const SNAPSHOTS_KEY = "osa-snapshots";
export const SNAPSHOT_PREFIX = "osa-snapshot-";
export const WORKBENCH_KEY_V2 = "osa-workbench-v2";
const LEGACY_PREFIX = ["her", "mes"].join("");
const LEGACY_SNAPSHOTS_KEY = `${LEGACY_PREFIX}-snapshots`;
const LEGACY_SNAPSHOT_PREFIX = `${LEGACY_PREFIX}-snapshot-`;
const LEGACY_WORKBENCH_KEY_V2 = `${LEGACY_PREFIX}-workbench-v2`;

interface SessionSummary {
  id: string;
  title: string;
  workspacePath?: string | null;
}

export interface SnapshotMeta {
  name: string;
  savedAt: string;
  note?: string;
  sessions?: SessionSummary[];
}

export function loadSnapshotIndex(): SnapshotMeta[] {
  try {
    const raw = readStoredItem(SNAPSHOTS_KEY, [LEGACY_SNAPSHOTS_KEY]);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveIndex(index: SnapshotMeta[]) {
  writeStoredItem(SNAPSHOTS_KEY, JSON.stringify(index));
}

export function loadSnapshotWorkbench(name: string): string | null {
  return readStoredItem(SNAPSHOT_PREFIX + name, [LEGACY_SNAPSHOT_PREFIX + name]);
}

function buildSessionSummaries(teams: Team[], sessions: Session[]): SessionSummary[] {
  const sessionMap = new Map(sessions.map((s) => [s.id, s]));
  return teams
    .flatMap((t) => t.desks)
    .filter((d) => !("isPending" in d))
    .flatMap((d) => {
      const s = sessionMap.get((d as Session).id);
      if (!s) return [];
      const summary: SessionSummary = { id: s.id, title: s.title_summary || s.title || s.id };
      if (s.workspace_path) summary.workspacePath = s.workspace_path;
      return [summary];
    });
}

export function saveCurrentProjectSnapshot(
  teams: Team[],
  sessions: Session[],
  name: string,
  note = "",
): SnapshotMeta[] | null {
  const cleanName = name.trim();
  if (!cleanName) return null;
  const current = readStoredItem(WORKBENCH_KEY_V2, [LEGACY_WORKBENCH_KEY_V2]);
  if (!current) return null;
  writeStoredItem(SNAPSHOT_PREFIX + cleanName, current);
  const index = loadSnapshotIndex();
  const existing = index.findIndex((s) => s.name === cleanName);
  const meta: SnapshotMeta = {
    name: cleanName,
    savedAt: new Date().toISOString(),
    note: note.trim() || undefined,
    sessions: buildSessionSummaries(teams, sessions),
  };
  if (existing >= 0) index[existing] = meta;
  else index.unshift(meta);
  saveIndex(index);
  return index;
}

interface Props {
  teams: Team[];
  sessions: Session[];
  onLoadSnapshot: (name?: string) => void;
  onSnapshotsChange?: (snapshots: SnapshotMeta[]) => void;
}

export function SnapshotMenu({ teams, sessions, onLoadSnapshot, onSnapshotsChange }: Props) {
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [nameInput, setNameInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [expandedNote, setExpandedNote] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setSnapshots(loadSnapshotIndex());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDoc);
    return () => window.removeEventListener("mousedown", onDoc);
  }, [open]);

  function handleSave() {
    const name = nameInput.trim();
    if (!name) return;
    try {
      const index = saveCurrentProjectSnapshot(teams, sessions, name, noteInput.trim());
      if (!index) return;
      setSnapshots(index);
      onSnapshotsChange?.(index);
      setNameInput("");
      setNoteInput("");
    } catch {}
  }

  function handleLoad(name: string) {
    try {
      const raw = loadSnapshotWorkbench(name);
      if (!raw) return;
      writeStoredItem(WORKBENCH_KEY_V2, raw);
      setOpen(false);
      onLoadSnapshot(name);
    } catch {}
  }

  function handleDelete(name: string) {
    try {
      removeStoredItems(SNAPSHOT_PREFIX + name, [LEGACY_SNAPSHOT_PREFIX + name]);
      const index = loadSnapshotIndex().filter((s) => s.name !== name);
      saveIndex(index);
      setSnapshots(index);
      onSnapshotsChange?.(index);
    } catch {}
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Save the current OSA project or load a saved project"
        style={{
          height: 32, padding: "0 10px",
          background: open ? "var(--accent2)" : "rgba(255,255,255,0.06)",
          border: "1px solid var(--card-border)",
          borderRadius: 6, color: open ? "white" : "var(--text-dim)",
          fontSize: 11, display: "flex", alignItems: "center", gap: 5,
          cursor: "pointer",
        }}
      >
        <span style={{ fontSize: 13 }}>💾</span> Save Project
      </button>

      {open && (
        <div style={{
          position: "absolute", top: 38, right: 0, zIndex: 200, width: 320,
          background: "var(--bg2)", border: "1px solid var(--card-border)",
          borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.6)", padding: 12,
        }}>
          {/* ── Save form ── */}
          <div style={{
            fontSize: 10, fontWeight: 600, color: "var(--text-dim)",
            textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8,
          }}>
            Save current project
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              placeholder="Project save name..."
              style={{
                flex: 1,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid var(--card-border)",
                borderRadius: 6, padding: "5px 9px",
                color: "var(--text)", fontSize: 12, outline: "none",
              }}
              onFocus={(e) => (e.target.style.borderColor = "var(--accent2)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--card-border)")}
            />
            <button
              onClick={handleSave}
              disabled={!nameInput.trim()}
              style={{
                padding: "5px 11px", borderRadius: 6, fontSize: 12,
                cursor: nameInput.trim() ? "pointer" : "default",
                background: nameInput.trim() ? "var(--accent2)" : "rgba(255,255,255,0.04)",
                color: nameInput.trim() ? "white" : "var(--text-dim)",
                border: "1px solid var(--card-border)",
                flexShrink: 0,
              }}
            >
              Save
            </button>
          </div>
          <textarea
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            placeholder="Optional note…"
            rows={2}
            style={{
              width: "100%", boxSizing: "border-box",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--card-border)",
              borderRadius: 6, padding: "5px 9px",
              color: "var(--text)", fontSize: 11,
              resize: "none", outline: "none", fontFamily: "inherit",
            }}
            onFocus={(e) => (e.target.style.borderColor = "var(--accent2)")}
            onBlur={(e) => (e.target.style.borderColor = "var(--card-border)")}
          />

          {/* ── Saved project list ── */}
          {snapshots.length > 0 ? (
            <>
              <div style={{
                fontSize: 10, fontWeight: 600, color: "var(--text-dim)",
                textTransform: "uppercase", letterSpacing: "0.05em", margin: "14px 0 8px",
              }}>
                Saved projects
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {snapshots.map((s) => {
                  const expanded = expandedNote === s.name;
                  return (
                    <div
                      key={s.name}
                      style={{
                        borderRadius: 6,
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid var(--card-border)",
                        overflow: "hidden",
                      }}
                    >
                      {/* Header row */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 9px" }}>
                        <span style={{
                          flex: 1, fontSize: 12, fontWeight: 600, color: "var(--text)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {s.name}
                        </span>
                        <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>
                          {new Date(s.savedAt).toLocaleDateString()}
                        </span>
                        {(s.note || (s.sessions && s.sessions.length > 0)) && (
                          <button
                            onClick={() => setExpandedNote(expanded ? null : s.name)}
                            title={expanded ? "Collapse" : "Show details"}
                            style={{
                              padding: "2px 5px", borderRadius: 4, fontSize: 10, cursor: "pointer",
                              background: expanded ? "var(--accent2)" : "rgba(255,255,255,0.08)",
                              color: expanded ? "white" : "var(--text-dim)",
                              border: "1px solid var(--card-border)", flexShrink: 0,
                            }}
                          >
                            {expanded ? "▲" : "▼"}
                          </button>
                        )}
                        <button
                          onClick={() => handleLoad(s.name)}
                          title={`Load "${s.name}"`}
                          style={{
                            padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer",
                            background: "var(--accent2)", color: "white",
                            border: "1px solid transparent", flexShrink: 0,
                          }}
                        >
                          Load
                        </button>
                        <button
                          onClick={() => handleDelete(s.name)}
                          title={`Delete "${s.name}"`}
                          style={{
                            padding: "3px 6px", borderRadius: 4, fontSize: 10, cursor: "pointer",
                            background: "rgba(255,255,255,0.06)", color: "var(--text-dim)",
                            border: "1px solid var(--card-border)", flexShrink: 0,
                          }}
                        >
                          ✕
                        </button>
                      </div>

                      {/* Inline note preview (collapsed) */}
                      {!expanded && s.note && (
                        <div style={{
                          padding: "0 9px 6px",
                          fontSize: 11, color: "var(--text-dim)",
                          fontStyle: "italic",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {s.note}
                        </div>
                      )}

                      {/* Expanded detail panel */}
                      {expanded && (
                        <div style={{
                          borderTop: "1px solid var(--card-border)",
                          padding: "8px 9px",
                          display: "flex", flexDirection: "column", gap: 6,
                        }}>
                          {s.note && (
                            <div style={{ fontSize: 11, color: "var(--text)", lineHeight: 1.4 }}>
                              {s.note}
                            </div>
                          )}
                          {s.sessions && s.sessions.length > 0 && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              {s.sessions.map((sess) => (
                                <div key={sess.id} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                                  <span style={{ fontSize: 11, color: "var(--text)", fontWeight: 500,
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {sess.title}
                                  </span>
                                  {sess.workspacePath && (
                                    <span
                                      title={sess.workspacePath}
                                      style={{
                                        fontSize: 10, color: "var(--text-dim)", fontFamily: "monospace",
                                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                        direction: "rtl", textAlign: "left",
                                      }}
                                    >
                                      {sess.workspacePath}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 10, opacity: 0.7 }}>
              No saved projects yet.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
