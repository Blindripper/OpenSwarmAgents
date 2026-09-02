import { useCallback, useEffect, useState } from "react";
import type { NetworkEvent } from "../api/client";
import { api } from "../api/client";
import type { ProtocolLayerStatus, ProtocolOverview, TclkOfferProjection } from "../types";
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
  if (layer.status === "observer") return "#38bdf8";
  if (layer.status === "paper-only") return "#facc15";
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

function OfferCard({ offer }: { offer: TclkOfferProjection }) {
  const status = offer.expired && offer.status === "proposed" ? "expired" : offer.status;
  const active = !offer.expired && ["proposed", "accepted", "locked"].includes(offer.status);
  return (
    <article style={{
      border: "1px solid #273453",
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
    </article>
  );
}

export function ProtocolOsPanel({ events, live, activityLoading = false, onRefreshActivity, onOpenProject }: Props) {
  const [view, setView] = useState<"protocols" | "activity">("protocols");
  const [overview, setOverview] = useState<ProtocolOverview | null>(null);
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
            <div style={{ fontSize: 20, fontWeight: 950 }}>Technocore Protocol OS</div>
            <div style={{ marginTop: 4, maxWidth: 760, color: "var(--text-dim)", fontSize: 11, lineHeight: 1.5 }}>
              Read-only control-plane projection. Technocore transports signed events; OSA validates protocols and keeps local execution, policies, artifacts, keys, and secrets private.
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
                <div style={{ fontSize: 15, fontWeight: 900 }}>TCLK Offer Observer</div>
                <div style={{ marginTop: 3, color: "var(--text-dim)", fontSize: 10 }}>Signed and structurally valid frames from #{overview?.tclk.offer_room || "tclk-offers"}</div>
              </div>
              <span style={{ border: "1px solid #854d0e", background: "#2b210c", color: "#fde047", borderRadius: 999, padding: "4px 9px", fontSize: 9, fontWeight: 950 }}>PAPER / NO VALUE</span>
            </div>
            <div style={{ marginTop: 12, display: "grid", gap: 9 }}>
              {loading && !overview ? (
                <div style={{ minHeight: 180, display: "grid", placeItems: "center", color: "var(--text-dim)", fontSize: 12 }}>Loading protocol projection…</div>
              ) : (overview?.tclk.offers.length || 0) === 0 ? (
                <div style={{ minHeight: 180, display: "grid", placeItems: "center", textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>
                  No verified TCLK offers are visible in the current room window.
                </div>
              ) : overview?.tclk.offers.map((offer) => <OfferCard key={`${offer.id}-${offer.sequence}`} offer={offer} />)}
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
