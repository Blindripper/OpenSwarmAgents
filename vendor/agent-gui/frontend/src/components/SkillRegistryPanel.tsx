import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { SkillRegistryOverview, SkillRegistryProvider } from "../types";

type Source = "all" | "local" | "federated";

const button = { height: 32, padding: "0 11px", borderRadius: 6, border: "1px solid #2a8c72", background: "#10251f", color: "#7ee0c2", fontSize: 11, fontWeight: 900, cursor: "pointer" } as const;
const field = { height: 34, borderRadius: 7, border: "1px solid #2a3558", background: "#111827", color: "#e5e7eb", fontSize: 12, padding: "0 10px", minWidth: 0 } as const;

function badge(state: string): import("react").CSSProperties {
  const palette = state === "local"
    ? ["#2563eb", "#10204a", "#bfdbfe"]
    : state === "verified"
      ? ["#2a8c72", "#0e2a17", "#7ee0c2"]
      : state === "stale"
        ? ["#a16207", "#2a210e", "#fde68a"]
        : state === "catalog"
          ? ["#64748b", "#111827", "#cbd5e1"]
          : ["#7f1d1d", "#2a1010", "#fca5a5"];
  return { padding: "3px 7px", borderRadius: 6, border: `1px solid ${palette[0]}`, background: palette[1], color: palette[2], fontSize: 10, fontWeight: 900, whiteSpace: "nowrap" };
}

function short(value?: string | null) {
  if (!value) return "none";
  return value.length > 26 ? `${value.slice(0, 12)}...${value.slice(-6)}` : value;
}

function evidence(provider: SkillRegistryProvider) {
  const counts = provider.reputation.counts;
  return counts.accepted_results + counts.verified_job_results + counts.claimed_deals + counts.refunded_deals + counts.disputed_deals;
}

function ProviderRow({ provider }: { provider: SkillRegistryProvider }) {
  const state = provider.verification.state;
  return <div style={{ display: "grid", gap: 6, padding: 9, border: "1px solid #1e2a45", borderRadius: 7, background: "#09111e", minWidth: 0 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ minWidth: 0 }}>
        <strong style={{ display: "block", color: provider.source === "local" ? "#93c5fd" : "#7ee0c2", fontSize: 13, overflowWrap: "anywhere" }}>{provider.name}</strong>
        <span style={{ color: "#64748b", fontSize: 10, overflowWrap: "anywhere" }}>{provider.agent_id} · {short(provider.did)}</span>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <span style={badge(provider.source === "local" ? "local" : "catalog")}>{provider.source === "local" ? "LOCAL" : "FEDERATED"}</span>
        <span style={badge(state)}>{provider.verification.label}</span>
      </div>
    </div>
    {provider.tagline && <div style={{ color: "#cbd5e1", fontSize: 11, lineHeight: 1.4, overflowWrap: "anywhere" }}>{provider.tagline}</div>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 5, color: "#94a3b8", fontSize: 10 }}>
      <span title={provider.node_id} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Node {short(provider.node_id)}</span>
      <span title={provider.provenance.payload_hash || ""} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Hash {short(provider.provenance.payload_hash)}</span>
      <span>{evidence(provider)} evidence refs</span>
    </div>
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      <span style={badge(provider.authority.kind === "local_workspace_profile" ? "local" : "catalog")}>{provider.authority.kind === "local_workspace_profile" ? "LOCAL SELECTABLE" : "CATALOG ONLY"}</span>
      <span style={badge("catalog")}>NO AUTO-BID</span>
      <span style={badge("catalog")}>NO EXECUTION</span>
    </div>
    {provider.verification.rejection_reason && <div style={{ color: "#fca5a5", fontSize: 10 }}>Rejected: {provider.verification.rejection_reason}</div>}
  </div>;
}

export function SkillRegistryPanel() {
  const [view, setView] = useState<SkillRegistryOverview | null>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<Source>("all");
  const [includeUnsafe, setIncludeUnsafe] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextQuery = query, nextSource = source, nextUnsafe = includeUnsafe) => {
    setLoading(true);
    setError(null);
    try {
      setView(await api.skillRegistry.overview({ skill: nextQuery, source: nextSource, include_stale: nextUnsafe, include_untrusted: nextUnsafe, limit: 24, provider_limit: 6 }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Skill Registry unavailable");
    } finally {
      setLoading(false);
    }
  }, [includeUnsafe, query, source]);

  useEffect(() => { void load("", "all", false); }, []);

  const hidden = (view?.status.excluded.stale || 0) + (view?.status.excluded.untrusted || 0);
  const skills = useMemo(() => view?.skills || [], [view]);

  return <section data-testid="skill-registry" style={{ border: "1px solid #2a8c72", borderRadius: 10, padding: 14, background: "rgba(9,24,28,.96)", display: "grid", gap: 12 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div>
        <strong style={{ fontSize: 17 }}>Skill Registry</strong>
        <div style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>Machine-readable skill catalog derived from signed Capability Registry records.</div>
      </div>
      <button type="button" onClick={() => void load()} style={button}>{loading ? "Loading..." : "Refresh"}</button>
    </div>
    <form onSubmit={(event) => { event.preventDefault(); void load(); }} style={{ display: "grid", gridTemplateColumns: "minmax(180px,1fr) minmax(125px,170px) auto", gap: 8, alignItems: "center" }}>
      <input aria-label="Registry skill filter" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="coding or security_review" list="osa-skill-registry-options" style={field} />
      <datalist id="osa-skill-registry-options">{(view?.available_skills || []).map((skill) => <option key={skill} value={skill}>{skill.replace(/_/g, " ")}</option>)}</datalist>
      <select aria-label="Registry source" value={source} onChange={(event) => { const next = event.target.value as Source; setSource(next); void load(query, next, includeUnsafe); }} style={field}>
        <option value="all">Local + federated</option>
        <option value="local">Local only</option>
        <option value="federated">Federated only</option>
      </select>
      <button type="submit" style={button}>Filter</button>
    </form>
    <label style={{ display: "flex", gap: 7, alignItems: "center", width: "fit-content", color: "#94a3b8", fontSize: 11 }}>
      <input type="checkbox" checked={includeUnsafe} onChange={(event) => { const next = event.target.checked; setIncludeUnsafe(next); void load(query, source, next); }} />
      Include stale and untrusted skill claims
    </label>
    {error && <div role="alert" style={{ color: "#fca5a5", fontSize: 12 }}>{error}</div>}
    {(view?.status.capability_error || view?.status.reputation_error) && <div style={{ color: "#fde68a", fontSize: 11 }}>Cached registry context: {view.status.capability_error || view.status.reputation_error}</div>}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <span style={badge("verified")}>{view?.status.skill_count || 0} skills</span>
      <span style={badge("catalog")}>{view?.status.provider_count || 0} providers</span>
      {hidden > 0 && <span style={badge("stale")}>{hidden} hidden stale/untrusted</span>}
    </div>
    {!loading && !skills.length && <div style={{ padding: 12, border: "1px dashed #334155", borderRadius: 8, color: "#94a3b8", fontSize: 12 }}>No skill descriptors match the current filter.</div>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,360px),1fr))", gap: 10 }}>
      {skills.map((skill) => <article key={skill.id} style={{ display: "grid", gap: 9, padding: 12, border: "1px solid #1f3f3a", borderRadius: 8, background: "rgba(15,23,42,.66)", minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ color: "#7ee0c2", fontSize: 15, overflowWrap: "anywhere" }}>{skill.label}</strong>
            <div style={{ color: "#64748b", fontSize: 10 }}>{skill.skill}</div>
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span style={badge("verified")}>{skill.eligible_provider_count} eligible</span>
            <span style={badge("catalog")}>{skill.provider_count} total</span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 5, color: "#94a3b8", fontSize: 10 }}>
          <span>{skill.local_provider_count} local</span>
          <span>{skill.federated_provider_count} federated</span>
          <span>{skill.stale_provider_count} stale</span>
          <span>{skill.untrusted_provider_count} untrusted</span>
        </div>
        <div style={{ display: "grid", gap: 7 }}>{skill.providers.map((provider) => <ProviderRow key={`${skill.id}:${provider.id}`} provider={provider} />)}</div>
      </article>)}
    </div>
  </section>;
}
