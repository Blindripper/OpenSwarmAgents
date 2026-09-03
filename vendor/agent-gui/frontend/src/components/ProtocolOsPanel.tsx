import { useCallback, useEffect, useState } from "react";
import type { NetworkEvent } from "../api/client";
import { api } from "../api/client";
import type { ProtocolLayerStatus, ProtocolOverview, ProtocolTimelineEntry, TclkOfferProjection } from "../types";
import { NetworkActivityPanel } from "./NetworkActivityPanel";

interface Props {
  events: NetworkEvent[];
  live: boolean;
  activityLoading?: boolean;
  onRefreshActivity: () => void;
  onOpenProject?: (projectId: string) => void;
}

function shortIdentity(value?: string | null): string {
  if (!value) return "Unavailable";
  return value.length > 30 ? `${value.slice(0, 18)}…${value.slice(-8)}` : value;
}

function layerColor(layer: ProtocolLayerStatus): string {
  if (["connected", "ready"].includes(layer.status)) return "#7ee0c2";
  if (["observer", "rehearsal", "local-rehearsal"].includes(layer.status)) return "#38bdf8";
  if (["paper-only", "paper-ready"].includes(layer.status)) return "#facc15";
  if (layer.status === "planned") return "#a78bfa";
  return "#94a3b8";
}

function deadlineLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function OfferCard({ offer, onAccept, onClaim, busy }: { offer: TclkOfferProjection; onAccept?: (offer: TclkOfferProjection) => void; onClaim?: (offer: TclkOfferProjection) => void; busy?: boolean }) {
  const status = offer.expired && offer.status === "proposed" ? "expired" : offer.status;
  const active = !offer.expired && ["proposed", "accepted", "locked"].includes(offer.status);
  const canAccept = !offer.expired && offer.status === "proposed" && Boolean(onAccept);
  const canClaim = offer.status === "accepted" && Boolean(onClaim);
  return (
    <article style={{
      border: `1px solid ${canAccept ? "#2a8c72" : "#273453"}`,
      borderRadius: 10,
      padding: 13,
      background: "linear-gradient(145deg, rgba(18,24,40,.96), rgba(10,18,31,.96))",
      display: "grid",
      gap: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 17 }}>{offer.amount} {offer.asset}</strong>
            <span style={{
              borderRadius: 999,
              padding: "2px 8px",
              border: `1px solid ${active ? "#2a8c72" : "#475569"}`,
              color: active ? "#7ee0c2" : "#cbd5e1",
              fontSize: 10,
              fontWeight: 900,
              textTransform: "uppercase",
            }}>{status}</span>
            <span style={{ color: "#7ee0c2", fontSize: 10, fontWeight: 900 }}>VERIFIED DID</span>
          </div>
          <div title={offer.from} style={{ marginTop: 5, color: "var(--text-dim)", fontSize: 11 }}>
            {offer.role} · {shortIdentity(offer.from)}
          </div>
        </div>
        <div style={{ textAlign: "right", color: "var(--text-dim)", fontSize: 10 }}>
          <div>seq {offer.sequence ?? "—"}</div>
          <div>{offer.lock.toUpperCase()}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {offer.rails.map((rail) => (
          <span key={rail} style={{ padding: "3px 7px", borderRadius: 5, background: "#172238", color: "#93c5fd", fontSize: 10, fontWeight: 800 }}>
            rail:{rail}
          </span>
        ))}
        {offer.job && (
          <span title={offer.job.id} style={{ padding: "3px 7px", borderRadius: 5, background: "#241b3d", color: "#c4b5fd", fontSize: 10, fontWeight: 800 }}>
            job:{offer.job.proto}/{offer.job.id.slice(0, 18)}{offer.job.id.length > 18 ? "…" : ""}
          </span>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8, color: "var(--text-dim)", fontSize: 10 }}>
        <div><b style={{ color: "#cbd5e1" }}>Expires</b><br />{deadlineLabel(offer.expires_at)}</div>
        <div><b style={{ color: "#cbd5e1" }}>Claim by</b><br />{deadlineLabel(offer.claim_by)}</div>
        <div><b style={{ color: "#cbd5e1" }}>Refund after</b><br />{deadlineLabel(offer.refund_after)}</div>
      </div>
      {offer.deal_room && (
        <div title={offer.contract_id || undefined} style={{ color: "#38bdf8", fontSize: 10, fontWeight: 800 }}>
          Deal room: #{offer.deal_room}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {canAccept && (
          <button type="button" disabled={busy} onClick={() => onAccept?.(offer)} style={{ height: 28, padding: "0 12px", borderRadius: 6, border: "1px solid #2a8c72", background: "#1a3a2a", color: "#7ee0c2", fontWeight: 900, fontSize: 10, cursor: busy ? "default" : "pointer" }}>
            {busy ? "Accepting…" : "Accept Offer"}
          </button>
        )}
        {canClaim && (
          <button type="button" disabled={busy} onClick={() => onClaim?.(offer)} style={{ height: 28, padding: "0 12px", borderRadius: 6, border: "1px solid #a16207", background: "#3b2b0d", color: "#fde68a", fontWeight: 900, fontSize: 10, cursor: busy ? "default" : "pointer" }}>
            {busy ? "Claiming…" : "Claim Reward"}
          </button>
        )}
      </div>
    </article>
  );
}

function TimelineRecord({ record }: { record: ProtocolTimelineEntry }) {
  const accepted = record.valid && record.verified;
  return (
    <article style={{ border: "1px solid #273453", borderRadius: 8, padding: 11, background: "#0b1525", display: "grid", gap: 7 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
          <strong style={{ fontSize: 11 }}>{record.frame_type || "non-protocol"}</strong>
          <span style={{ color: accepted ? "#7ee0c2" : "#fca5a5", fontSize: 9, fontWeight: 900 }}>
            {accepted ? "VERIFIED" : "REJECTED"}
          </span>
        </div>
        <span style={{ color: "var(--text-dim)", fontSize: 9 }}>gen {record.generation} · seq {record.sequence}</span>
      </div>
      <div title={record.from} style={{ color: "var(--text-dim)", fontSize: 10 }}>{shortIdentity(record.from)}</div>
      {record.object_id && <div title={record.object_id} style={{ color: "#93c5fd", fontSize: 9 }}>object {shortIdentity(record.object_id)}</div>}
      {!accepted && record.rejection && <div style={{ color: "#fca5a5", fontSize: 9 }}>{record.rejection}</div>}
      <div title={record.payload_hash} style={{ color: "#64748b", fontSize: 9 }}>
        sha256 {record.payload_hash.slice(0, 16)}… · {deadlineLabel(record.created_at)}
      </div>
    </article>
  );
}


export function ProtocolOsPanel({ events, live, activityLoading = false, onRefreshActivity, onOpenProject }: Props) {
  const [view, setView] = useState<"protocols" | "activity">("protocols");
  const [overview, setOverview] = useState<ProtocolOverview | null>(null);
  const [protocolView, setProtocolView] = useState<"offers" | "timeline">("offers");
  // Paper rehearsal removed — only TCLK Observer remains
  // TCLK Offer Observer — read-only, no accept/claim (pure observation)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await api.protocol.overview());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Protocol overview unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Paper rehearsal actions removed — only TCLK Observer remains

  // Accept/claim removed — TCLK offers are read-only observer for now

  if (view === "activity") {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "8px 18px 0", background: "#0d1724" }}>
          <button type="button" onClick={() => setView("protocols")} style={{ height: 28, border: "1px solid #2a3558", borderRadius: 6, background: "#121828", color: "#93c5fd", fontWeight: 800, cursor: "pointer" }}>
            ← Protocol Objects
          </button>
        </div>
        <NetworkActivityPanel events={events} live={live} loading={activityLoading} onRefresh={onRefreshActivity} onOpenProject={onOpenProject} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: "auto", background: "linear-gradient(180deg, #07131f 0%, #101827 48%, #090e1a 100%)", color: "var(--text)", padding: 18, boxSizing: "border-box" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gap: 14 }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 950 }}>Technocore Protocol OS</div>
            <div style={{ marginTop: 4, maxWidth: 760, color: "var(--text-dim)", fontSize: 13, lineHeight: 1.5 }}>
              Verified public TCLK protocol projection. Signed frames from Technocore rooms are observed and validated locally.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => setView("activity")} style={{ height: 30, padding: "0 11px", borderRadius: 6, border: "1px solid #2a3558", background: "#121828", color: "#cbd5e1", cursor: "pointer", fontSize: 11, fontWeight: 800 }}>
              OSA Activity
            </button>
            <button type="button" onClick={() => void refresh()} disabled={loading} style={{ height: 30, padding: "0 11px", borderRadius: 6, border: "1px solid #2563eb", background: "#12213d", color: "#93c5fd", cursor: loading ? "default" : "pointer", fontSize: 11, fontWeight: 800 }}>
              {loading ? "Syncing" : "Refresh"}
            </button>
          </div>
        </header>

        {error && <div style={{ border: "1px solid #7f1d1d", background: "#2a1015", color: "#fca5a5", borderRadius: 8, padding: 12, fontSize: 12 }}>{error}</div>}

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
          {(overview?.layers || []).map((layer) => (
            <div key={layer.id} style={{ border: "1px solid #273453", background: "rgba(14,24,41,.9)", borderRadius: 9, padding: 11 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong style={{ fontSize: 12 }}>{layer.label}</strong>
                <span style={{ color: layerColor(layer), fontSize: 9, fontWeight: 900, textTransform: "uppercase" }}>{layer.status}</span>
              </div>
              <div style={{ marginTop: 5, color: "var(--text-dim)", fontSize: 10, lineHeight: 1.35 }}>{layer.role}</div>
            </div>
          ))}
        </section>



        <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(230px, 320px)", gap: 12 }}>
          <div style={{ border: "1px solid #273453", borderRadius: 10, padding: 14, background: "rgba(12,20,34,.92)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 900 }}>TCLK Offer Observer</div>
                <div style={{ marginTop: 3, color: "var(--text-dim)", fontSize: 12 }}>Signed and structurally valid frames from #{overview?.tclk.offer_room || "tclk-offers"}</div>
              </div>
              <span style={{ border: "1px solid #854d0e", background: "#2b210c", color: "#fde047", borderRadius: 999, padding: "4px 9px", fontSize: 9, fontWeight: 950 }}>PAPER / NO VALUE</span>
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
              {(["offers", "timeline"] as const).map((candidate) => (
                <button key={candidate} type="button" onClick={() => setProtocolView(candidate)} style={{ height: 27, padding: "0 10px", borderRadius: 6, border: `1px solid ${protocolView === candidate ? "#2563eb" : "#2a3558"}`, background: protocolView === candidate ? "#12213d" : "#101827", color: protocolView === candidate ? "#93c5fd" : "#94a3b8", fontSize: 10, fontWeight: 800, cursor: "pointer" }}>
                  {candidate === "offers" ? "Offers" : "Protocol Timeline"}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 12, display: "grid", gap: 9 }}>
              {loading && !overview ? (
                <div style={{ minHeight: 180, display: "grid", placeItems: "center", color: "var(--text-dim)", fontSize: 12 }}>Loading protocol projection…</div>
              ) : protocolView === "timeline" ? (
                (overview?.timeline?.length || 0) === 0 ? (
                  <div style={{ minHeight: 180, display: "grid", placeItems: "center", textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>No archived protocol records yet.</div>
                ) : overview?.timeline?.map((record) => <TimelineRecord key={record.id} record={record} />)
              ) : (overview?.tclk.offers.length || 0) === 0 ? (
                <div style={{ minHeight: 180, display: "grid", placeItems: "center", textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>
                  No verified TCLK offers are visible in the current room window.
                </div>
              ) : overview?.tclk.offers.map((offer) => <OfferCard key={`${offer.id}-${offer.sequence}`} offer={offer} busy={false} />)}
            </div>
          </div>

          <aside style={{ display: "grid", gap: 10, alignContent: "start" }}>
            <div style={{ border: "1px solid #273453", borderRadius: 10, padding: 13, background: "rgba(12,20,34,.92)" }}>
              <div style={{ fontSize: 12, fontWeight: 900 }}>Node Identity</div>
              <div title={overview?.identity.node_did || undefined} style={{ marginTop: 7, color: "#7ee0c2", fontSize: 10, wordBreak: "break-all" }}>{shortIdentity(overview?.identity.node_did)}</div>
              <div style={{ marginTop: 8, color: "var(--text-dim)", fontSize: 10 }}>Signed transport: {overview?.identity.signed_messages ? "ready" : "unavailable"}</div>
            </div>
            <div style={{ border: "1px solid #273453", borderRadius: 10, padding: 13, background: "rgba(12,20,34,.92)" }}>
              <div style={{ fontSize: 12, fontWeight: 900 }}>Observer Health</div>
              <div style={{ marginTop: 8, display: "grid", gap: 5, color: "var(--text-dim)", fontSize: 10 }}>
                <div>Room records: <b style={{ color: "#cbd5e1" }}>{overview?.tclk.observed_message_count ?? 0}</b></div>
                <div>Valid frames: <b style={{ color: "#7ee0c2" }}>{overview?.tclk.valid_frame_count ?? 0}</b></div>
                <div>Rejected frames: <b style={{ color: overview?.tclk.invalid_frame_count ? "#fca5a5" : "#cbd5e1" }}>{overview?.tclk.invalid_frame_count ?? 0}</b></div>
                <div>Archive: <b style={{ color: "#cbd5e1" }}>{overview?.archive?.record_count ?? 0}</b> / {overview?.archive?.limit ?? "—"}</div>
                <div>Cursor: <b style={{ color: "#cbd5e1" }}>gen {overview?.room_sync?.generation ?? 0} · seq {overview?.room_sync?.last_seq ?? 0}</b></div>
                <div>Source: <b style={{ color: overview?.room_sync?.stale ? "#facc15" : "#7ee0c2" }}>{overview?.room_sync?.source || "archive"}</b></div>
                {overview?.room_sync?.error && <div style={{ color: "#fca5a5" }}>{overview.room_sync.error}</div>}
              </div>
            </div>
            <div style={{ border: "1px solid #854d0e", borderRadius: 10, padding: 13, background: "rgba(43,33,12,.9)", color: "#fde68a", fontSize: 10, lineHeight: 1.45 }}>
              {overview?.tclk.warning || "Observer mode only. No settlement actions are available."}
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}
