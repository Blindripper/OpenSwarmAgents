import { useCallback, useEffect, useState } from "react";
import type { NetworkEvent } from "../api/client";
import { api } from "../api/client";
import type { ProtocolLayerStatus, ProtocolOverview, ProtocolPaperDeal, ProtocolTimelineEntry, TclkOfferProjection } from "../types";
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
      padding: 14,
      background: "linear-gradient(145deg, rgba(18,24,40,.96), rgba(10,18,31,.96))",
      display: "grid",
      gap: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 18 }}>{offer.amount} {offer.asset}</strong>
            <span style={{
              borderRadius: 999,
              padding: "3px 10px",
              border: `1px solid ${active ? "#2a8c72" : "#475569"}`,
              color: active ? "#7ee0c2" : "#cbd5e1",
              fontSize: 12,
              fontWeight: 900,
              textTransform: "uppercase",
            }}>{status}</span>
            <span style={{ color: "#7ee0c2", fontSize: 12, fontWeight: 900 }}>VERIFIED DID</span>
          </div>
          <div title={offer.from} style={{ marginTop: 6, color: "var(--text-dim)", fontSize: 13 }}>
            {offer.role} · {shortIdentity(offer.from)}
          </div>
        </div>
        <div style={{ textAlign: "right", color: "var(--text-dim)", fontSize: 12 }}>
          <div>seq {offer.sequence ?? "—"}</div>
          <div>{offer.lock.toUpperCase()}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {offer.rails.map((rail) => (
          <span key={rail} style={{ padding: "3px 8px", borderRadius: 6, background: "#172238", color: "#93c5fd", fontSize: 12, fontWeight: 800 }}>
            rail:{rail}
          </span>
        ))}
        {offer.job && (
          <span title={offer.job.id} style={{ padding: "3px 8px", borderRadius: 6, background: "#241b3d", color: "#c4b5fd", fontSize: 12, fontWeight: 800 }}>
            job:{offer.job.proto}/{offer.job.id.slice(0, 18)}{offer.job.id.length > 18 ? "…" : ""}
          </span>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8, color: "var(--text-dim)", fontSize: 13 }}>
        <div><b style={{ color: "#cbd5e1" }}>Expires</b><br />{deadlineLabel(offer.expires_at)}</div>
        <div><b style={{ color: "#cbd5e1" }}>Claim by</b><br />{deadlineLabel(offer.claim_by)}</div>
        <div><b style={{ color: "#cbd5e1" }}>Refund after</b><br />{deadlineLabel(offer.refund_after)}</div>
      </div>
      {offer.deal_room && (
        <div title={offer.contract_id || undefined} style={{ color: "#38bdf8", fontSize: 13, fontWeight: 800 }}>
          Deal room: #{offer.deal_room}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {canAccept && (
          <button type="button" disabled={busy} onClick={() => onAccept?.(offer)} style={{ height: 32, padding: "0 14px", borderRadius: 6, border: "1px solid #2a8c72", background: "#1a3a2a", color: "#7ee0c2", fontWeight: 900, fontSize: 12, cursor: busy ? "default" : "pointer" }}>
            {busy ? "Accepting…" : "Accept Offer"}
          </button>
        )}
        {canClaim && (
          <button type="button" disabled={busy} onClick={() => onClaim?.(offer)} style={{ height: 32, padding: "0 14px", borderRadius: 6, border: "1px solid #a16207", background: "#3b2b0d", color: "#fde68a", fontWeight: 900, fontSize: 12, cursor: busy ? "default" : "pointer" }}>
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
    <article style={{ border: "1px solid #273453", borderRadius: 8, padding: 12, background: "#0b1525", display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong style={{ fontSize: 14 }}>{record.frame_type || "non-protocol"}</strong>
          <span style={{ color: accepted ? "#7ee0c2" : "#fca5a5", fontSize: 11, fontWeight: 900 }}>
            {accepted ? "VERIFIED" : "REJECTED"}
          </span>
        </div>
        <span style={{ color: "var(--text-dim)", fontSize: 11 }}>gen {record.generation} · seq {record.sequence}</span>
      </div>
      <div title={record.from} style={{ color: "var(--text-dim)", fontSize: 13 }}>{shortIdentity(record.from)}</div>
      {record.object_id && <div title={record.object_id} style={{ color: "#93c5fd", fontSize: 12 }}>object {shortIdentity(record.object_id)}</div>}
      {!accepted && record.rejection && <div style={{ color: "#fca5a5", fontSize: 12 }}>{record.rejection}</div>}
      <div title={record.payload_hash} style={{ color: "#64748b", fontSize: 11 }}>
        sha256 {record.payload_hash.slice(0, 16)}… · {deadlineLabel(record.created_at)}
      </div>
    </article>
  );
}

function dealStatusColor(status: string): string {
  if (["claimed", "cancelled"].includes(status)) return "#7ee0c2";
  if (status === "locked") return "#facc15";
  if (status === "accepted") return "#38bdf8";
  if (status === "refunded") return "#fca5a5";
  return "#94a3b8";
}

function DealCard({ deal, onLock, onClaim, busy }: { deal: ProtocolPaperDeal; onLock?: (deal: ProtocolPaperDeal) => void; onClaim?: (deal: ProtocolPaperDeal) => void; busy?: boolean }) {
  const canLock = deal.status === "accepted" && deal.next_action === "lock" && Boolean(onLock);
  const canClaim = deal.status === "locked" && deal.next_action === "claim" && Boolean(onClaim);
  return (
    <article style={{
      border: `1px solid ${canLock ? "#2a8c72" : "#273453"}`,
      borderRadius: 10,
      padding: 14,
      background: "linear-gradient(145deg, rgba(18,24,40,.96), rgba(10,18,31,.96))",
      display: "grid",
      gap: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 18 }}>{deal.amount} {deal.asset}</strong>
            <span style={{
              borderRadius: 999,
              padding: "3px 10px",
              border: `1px solid ${dealStatusColor(deal.status)}`,
              color: dealStatusColor(deal.status),
              fontSize: 12,
              fontWeight: 900,
              textTransform: "uppercase",
            }}>{deal.status}</span>
            <span style={{ color: "#7ee0c2", fontSize: 12, fontWeight: 900 }}>PAPER RAIL</span>
          </div>
          <div style={{ marginTop: 6, color: "var(--text-dim)", fontSize: 13 }}>{deal.label}</div>
          <div title={deal.payer_did} style={{ marginTop: 4, color: "var(--text-dim)", fontSize: 12 }}>payer {shortIdentity(deal.payer_did)}</div>
          {deal.counterparty_did && <div title={deal.counterparty_did} style={{ marginTop: 2, color: "var(--text-dim)", fontSize: 12 }}>payee {shortIdentity(deal.counterparty_did)}</div>}
        </div>
        <div style={{ textAlign: "right", color: "var(--text-dim)", fontSize: 12 }}>
          <div>updated {deadlineLabel(deal.updated_at)}</div>
          {deal.next_action && <div style={{ marginTop: 4, color: "#fde047", fontWeight: 900, fontSize: 12, textTransform: "uppercase" }}>next: {deal.next_action}</div>}
        </div>
      </div>
      {(deal.contract_id || deal.deal_room) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {deal.contract_id && (
            <span title={deal.contract_id} style={{ padding: "3px 8px", borderRadius: 6, background: "#241b3d", color: "#c4b5fd", fontSize: 12, fontWeight: 800, fontFamily: "ui-monospace,monospace" }}>
              contract {shortIdentity(deal.contract_id)}
            </span>
          )}
          {deal.deal_room && (
            <span title={deal.deal_room_posted ? "Deal room announced on Technocore" : "Derived deal room name"} style={{ padding: "3px 8px", borderRadius: 6, background: "#172238", color: deal.deal_room_posted ? "#7ee0c2" : "#93c5fd", fontSize: 12, fontWeight: 800 }}>
              #{deal.deal_room_name || deal.deal_room}{deal.deal_room_posted ? " · posted" : ""}
            </span>
          )}
        </div>
      )}
      {(deal.timeline?.length || 0) > 0 && (
        <details style={{ border: "1px solid #1e2a47", borderRadius: 8, padding: "8px 10px", background: "#0b1525" }}>
          <summary style={{ cursor: "pointer", color: "#93c5fd", fontSize: 12, fontWeight: 800 }}>Timeline ({deal.timeline.length})</summary>
          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            {deal.timeline.map((entry, index) => (
              <div key={`${entry.stage}-${entry.at}-${index}`} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: "var(--text-dim)" }}>
                <span style={{ padding: "2px 7px", borderRadius: 5, background: "#172238", color: "#93c5fd", fontWeight: 800, textTransform: "uppercase", fontSize: 10, whiteSpace: "nowrap" }}>{entry.stage}</span>
                <span style={{ flex: 1 }}>{entry.detail} <span title={entry.actor} style={{ color: "#64748b" }}>· {shortIdentity(entry.actor)}</span></span>
                <span style={{ color: "#64748b", whiteSpace: "nowrap" }}>{deadlineLabel(entry.at)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {canLock && (
          <button type="button" disabled={busy} onClick={() => onLock?.(deal)} style={{ height: 32, padding: "0 14px", borderRadius: 6, border: "1px solid #a16207", background: "#3b2b0d", color: "#fde68a", fontWeight: 900, fontSize: 12, cursor: busy ? "default" : "pointer" }}>
            {busy ? "Locking…" : "🔒 Lock FLOP (PaperRail)"}
          </button>
        )}
        {canClaim && (
          <button type="button" disabled={busy} onClick={() => onClaim?.(deal)} style={{ height: 32, padding: "0 14px", borderRadius: 6, border: "1px solid #a16207", background: "#3b2b0d", color: "#fde68a", fontWeight: 900, fontSize: 12, cursor: busy ? "default" : "pointer" }}>
            {busy ? "Claiming…" : "Claim Reward"}
          </button>
        )}
      </div>
    </article>
  );
}


async function apiProtocolCreateOffer(body: { amount: string; label?: string; job_id?: string; context?: string; expires_minutes?: number }): Promise<any> {
  const res = await fetch("/api/protocol/offers/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const parsed = await res.json();
  if (parsed.ok && parsed.offer_id) return { ok: true, offer_id: parsed.offer_id, deal: parsed.deal };
  if (parsed.detail) return { ok: false, detail: parsed.detail };
  return { ok: false, detail: "Unexpected server response" };
}

async function apiProtocolAcceptOffer(offerId: string, agentId = "technocore-specialist"): Promise<any> {
  const res = await fetch("/api/protocol/offers/accept", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offer_id: offerId, agent_id: agentId })
  });
  const body = await res.json();
  if (body.id) { return { ok: true, deal: body, sessionId: body.workspace_session_id || null }; }
  if (body.detail) { return { ok: false, detail: body.detail }; }
  return { ok: false, detail: "Unexpected server response" };
}

async function apiProtocolClaimOffer(offerId: string): Promise<any> {
  const res = await fetch("/api/protocol/offers/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offer_id: offerId })
  });
  const body = await res.json();
  if (body.id) { return { ok: true, deal: body }; }
  if (body.detail) { return { ok: false, detail: body.detail }; }
  return { ok: false, detail: "Unexpected server response" };
}

async function apiProtocolLockOffer(offerId: string): Promise<any> {
  const res = await fetch("/api/protocol/offers/lock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offer_id: offerId })
  });
  const body = await res.json();
  if (body.id) { return { ok: true, deal: body }; }
  if (body.detail) { return { ok: false, detail: body.detail }; }
  return { ok: false, detail: "Unexpected server response" };
}

export function ProtocolOsPanel({ events, live, activityLoading = false, onRefreshActivity, onOpenProject }: Props) {
  const [view, setView] = useState<"protocols" | "activity">("protocols");
  const [overview, setOverview] = useState<ProtocolOverview | null>(null);
  const [protocolView, setProtocolView] = useState<"offers" | "dealbook" | "timeline">("offers");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acceptBusy, setAcceptBusy] = useState<string | null>(null);
  const [claimBusy, setClaimBusy] = useState<string | null>(null);
  const [lockBusy, setLockBusy] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createStatus, setCreateStatus] = useState<{ ok: boolean; message: string } | null>(null);

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

  const handleAccept = useCallback(async (offer: TclkOfferProjection) => {
    setAcceptBusy(offer.id);
    setError(null);
    try {
      const data = await apiProtocolAcceptOffer(offer.id);
      if (data.deal) {
        window.dispatchEvent(new CustomEvent("osa:claim-job", { detail: { sessionId: data.sessionId || data.deal.workspace_session_id, claim: { dealId: data.deal.id, offerId: offer.id } } }));
      }
      if (!data.ok) throw new Error(data.detail || "Accept failed");
      setTimeout(() => void refresh(), 2000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Accept failed");
    } finally {
      setAcceptBusy(null);
    }
  }, [refresh]);

  const handleCreateOffer = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateBusy(true);
    setCreateStatus(null);
    try {
      const form = new FormData(event.currentTarget);
      const body = {
        amount: String(form.get("amount") || "100").trim() || "100",
        label: String(form.get("label") || "").trim(),
        job_id: String(form.get("job_id") || "").trim(),
        context: String(form.get("context") || "").trim(),
        expires_minutes: Number(form.get("expires_minutes") || 15)
      };
      const data = await apiProtocolCreateOffer(body);
      if (!data.ok) throw new Error(data.detail || "Create failed");
      setCreateStatus({ ok: true, message: `Offer ${data.offer_id.slice(0, 12)}… published to tclk-offers ✅` });
      setTimeout(() => void refresh(), 2500);
    } catch (cause) {
      setCreateStatus({ ok: false, message: cause instanceof Error ? cause.message : "Create failed" });
    } finally {
      setCreateBusy(false);
    }
  }, [refresh]);

  const handleClaim = useCallback(async (offer: { id: string }) => {
    setClaimBusy(offer.id);
    setError(null);
    try {
      const data = await apiProtocolClaimOffer(offer.id);
      if (!data.ok) throw new Error(data.detail || "Claim failed");
      setTimeout(() => void refresh(), 2000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Claim failed");
    } finally {
      setClaimBusy(null);
    }
  }, [refresh]);

  const handleLock = useCallback(async (deal: ProtocolPaperDeal) => {
    setLockBusy(deal.id);
    setError(null);
    try {
      const data = await apiProtocolLockOffer(deal.id);
      if (!data.ok) throw new Error(data.detail || "Lock failed");
      setTimeout(() => void refresh(), 2000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lock failed");
    } finally {
      setLockBusy(null);
    }
  }, [refresh]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (view === "activity") {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "8px 18px 0", background: "#0d1724" }}>
          <button type="button" onClick={() => setView("protocols")} style={{ height: 30, padding: "0 12px", border: "1px solid #2a3558", borderRadius: 6, background: "#121828", color: "#93c5fd", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
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
            <button type="button" onClick={() => setView("activity")} style={{ height: 32, padding: "0 12px", borderRadius: 6, border: "1px solid #2a3558", background: "#121828", color: "#cbd5e1", cursor: "pointer", fontSize: 13, fontWeight: 800 }}>
              OSA Activity
            </button>
            <button type="button" onClick={() => void refresh()} disabled={loading} style={{ height: 32, padding: "0 12px", borderRadius: 6, border: "1px solid #2563eb", background: "#12213d", color: "#93c5fd", cursor: loading ? "default" : "pointer", fontSize: 13, fontWeight: 800 }}>
              {loading ? "Syncing" : "Refresh"}
            </button>
          </div>
        </header>

        {error && <div style={{ border: "1px solid #7f1d1d", background: "#2a1015", color: "#fca5a5", borderRadius: 8, padding: 12, fontSize: 14 }}>{error}</div>}

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
          {(overview?.layers || []).map((layer) => (
            <div key={layer.id} style={{ border: "1px solid #273453", background: "rgba(14,24,41,.9)", borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong style={{ fontSize: 14 }}>{layer.label}</strong>
                <span style={{ color: layerColor(layer), fontSize: 12, fontWeight: 900, textTransform: "uppercase" }}>{layer.status}</span>
              </div>
              <div style={{ marginTop: 6, color: "var(--text-dim)", fontSize: 13, lineHeight: 1.4 }}>{layer.role}</div>
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
              <span style={{ border: "1px solid #854d0e", background: "#2b210c", color: "#fde047", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 950 }}>PAPER / NO VALUE</span>
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
              {(["offers", "dealbook", "timeline"] as const).map((candidate) => (
                <button key={candidate} type="button" onClick={() => setProtocolView(candidate)} style={{ height: 30, padding: "0 10px", borderRadius: 6, border: `1px solid ${protocolView === candidate ? "#2563eb" : "#2a3558"}`, background: protocolView === candidate ? "#12213d" : "#101827", color: protocolView === candidate ? "#93c5fd" : "#94a3b8", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                  {candidate === "offers" ? "Offers" : candidate === "dealbook" ? "Deals" : "Timeline"}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 12, display: "grid", gap: 9 }}>
              {loading && !overview ? (
                <div style={{ minHeight: 180, display: "grid", placeItems: "center", color: "var(--text-dim)", fontSize: 14 }}>Loading protocol projection…</div>
              ) : protocolView === "timeline" ? (
                (overview?.timeline?.length || 0) === 0 ? (
                  <div style={{ minHeight: 180, display: "grid", placeItems: "center", textAlign: "center", color: "var(--text-dim)", fontSize: 14 }}>No archived protocol records yet.</div>
                ) : overview?.timeline?.map((record) => <TimelineRecord key={record.id} record={record} />)
              ) : protocolView === "dealbook" ? (
                (overview?.paper?.deals?.length || 0) === 0 ? (
                  <div style={{ minHeight: 180, display: "grid", placeItems: "center", textAlign: "center", color: "var(--text-dim)", fontSize: 14 }}>
                    No PaperRail deals yet. Accept an offer to start one.
                  </div>
                ) : overview?.paper?.deals.map((deal) => {
                  const nodeDid = overview?.identity?.node_did;
                  const isPayer = Boolean(nodeDid && deal.payer_did === nodeDid);
                  const isPayee = Boolean(deal.local_agent_did && deal.next_action === "claim");
                  return (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      onLock={isPayer ? handleLock : undefined}
                      onClaim={isPayee ? handleClaim : undefined}
                      busy={lockBusy === deal.id || claimBusy === deal.id}
                    />
                  );
                })
              ) : (overview?.tclk.offers.length || 0) === 0 ? (
                <div style={{ minHeight: 180, display: "grid", placeItems: "center", textAlign: "center", color: "var(--text-dim)", fontSize: 14 }}>
                  No verified TCLK offers are visible in the current room window.
                </div>
              ) : overview?.tclk.offers.map((offer) => (
                <OfferCard
                  key={`${offer.id}-${offer.sequence}`}
                  offer={offer}
                  onAccept={handleAccept}
                  onClaim={overview?.identity?.node_did && offer.from !== overview.identity.node_did ? handleClaim : undefined}
                  busy={acceptBusy === offer.id || claimBusy === offer.id}
                />
              ))}
            </div>
          </div>

          <aside style={{ display: "grid", gap: 10, alignContent: "start" }}>
            <div style={{ border: "1px solid #273453", borderRadius: 10, padding: 14, background: "rgba(12,20,34,.92)" }}>
              <div style={{ fontSize: 14, fontWeight: 900 }}>Node Identity</div>
              <div title={overview?.identity.node_did || undefined} style={{ marginTop: 7, color: "#7ee0c2", fontSize: 13, wordBreak: "break-all", fontFamily: "ui-monospace,monospace" }}>{shortIdentity(overview?.identity.node_did)}</div>
              <div style={{ marginTop: 8, color: "var(--text-dim)", fontSize: 13 }}>Signed transport: <b style={{ color: overview?.identity.signed_messages ? "#7ee0c2" : "#facc15" }}>{overview?.identity.signed_messages ? "ready" : "unavailable"}</b></div>
            </div>
            <div style={{ border: "1px solid #273453", borderRadius: 10, padding: 14, background: "rgba(12,20,34,.92)" }}>
              <div style={{ fontSize: 14, fontWeight: 900 }}>Observer Health</div>
              <div style={{ marginTop: 8, display: "grid", gap: 6, color: "var(--text-dim)", fontSize: 13 }}>
                <div>Room records: <b style={{ color: "#cbd5e1" }}>{overview?.tclk.observed_message_count ?? 0}</b></div>
                <div>Valid frames: <b style={{ color: "#7ee0c2" }}>{overview?.tclk.valid_frame_count ?? 0}</b></div>
                <div>Rejected frames: <b style={{ color: overview?.tclk.invalid_frame_count ? "#fca5a5" : "#cbd5e1" }}>{overview?.tclk.invalid_frame_count ?? 0}</b></div>
                <div>Archive: <b style={{ color: "#cbd5e1" }}>{overview?.archive?.record_count ?? 0}</b> / {overview?.archive?.limit ?? "—"}</div>
                <div>Cursor: <b style={{ color: "#cbd5e1" }}>gen {overview?.room_sync?.generation ?? 0} · seq {overview?.room_sync?.last_seq ?? 0}</b></div>
                <div>Source: <b style={{ color: overview?.room_sync?.stale ? "#facc15" : "#7ee0c2" }}>{overview?.room_sync?.source || "archive"}</b></div>
                {overview?.room_sync?.error && <div style={{ color: "#fca5a5" }}>{overview.room_sync.error}</div>}
              </div>
            </div>
            <div style={{ border: "1px solid #854d0e", borderRadius: 10, padding: 14, background: "rgba(43,33,12,.9)", color: "#fde68a", fontSize: 13, lineHeight: 1.5 }}>
              {overview?.tclk.warning || "Observer mode only. No settlement actions are available."}
            </div>
            <div style={{ border: "1px solid #273453", borderRadius: 10, padding: 14, background: "rgba(12,20,34,.92)" }}>
              <div style={{ fontSize: 14, fontWeight: 900 }}>📤 Publish TCLK Offer</div>
              <div style={{ marginTop: 4, color: "var(--text-dim)", fontSize: 12, lineHeight: 1.4 }}>Posts a signed offer frame to #{overview?.tclk.offer_room || "tclk-offers"}. Paper rail — no real value moves.</div>
              <form onSubmit={handleCreateOffer} style={{ marginTop: 10, display: "grid", gap: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 96px", gap: 8 }}>
                  <input name="label" placeholder="Label (optional)" disabled={createBusy} style={{ height: 36, padding: "0 10px", borderRadius: 6, border: "1px solid #2a3558", background: "#121828", color: "#e2e8f0", fontSize: 13, outline: "none" }} />
                  <input name="amount" defaultValue="100" placeholder="FLOP" disabled={createBusy} style={{ height: 36, padding: "0 10px", borderRadius: 6, border: "1px solid #2a3558", background: "#121828", color: "#e2e8f0", fontSize: 13, outline: "none" }} />
                </div>
                <input name="job_id" placeholder="A2A Job ID (optional)" disabled={createBusy} style={{ height: 36, padding: "0 10px", borderRadius: 6, border: "1px solid #2a3558", background: "#121828", color: "#e2e8f0", fontSize: 13, outline: "none" }} />
                <textarea name="context" placeholder="Job context — what should the agent do?" disabled={createBusy} rows={3} style={{ width: "100%", boxSizing: "border-box", padding: "10px", borderRadius: 6, border: "1px solid #2a3558", background: "#121828", color: "#e2e8f0", fontSize: 13, resize: "vertical", outline: "none" }} />
                <button type="submit" disabled={createBusy} style={{ height: 36, borderRadius: 6, border: "1px solid #2563eb", background: createBusy ? "#1a2640" : "#1e3a8a", color: "#93c5fd", fontSize: 14, fontWeight: 800, cursor: createBusy ? "default" : "pointer" }}>
                  {createBusy ? "Publishing…" : "🚀 Publish Offer"}
                </button>
                {createStatus && <div style={{ fontSize: 12, color: createStatus.ok ? "#7ee0c2" : "#fca5a5", lineHeight: 1.4 }}>{createStatus.message}</div>}
              </form>
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}