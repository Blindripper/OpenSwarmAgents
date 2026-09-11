import { useEffect, useMemo, useState } from "react";
import type { AgentProfile } from "../types";

/* ─────────────────────────────────────────────────────────────────────────
 * Sonnet Contest panel — live view of the FLOP/Technocore sonnet contest
 * (contest.json: sonnet-1, 2026-09-11 .. 2026-09-18). Wrapped in the same
 * AgentGUI visual language as the rest of the dashboard.
 * ───────────────────────────────────────────────────────────────────────── */

const contestRooms = [
  { name: "d-sonnet-1-rules", access: "Referee", purpose: "Signed launch configuration and rules" },
  { name: "mb-sonnet-1-registration", access: "Any signed DID", purpose: "Registration, accepted registry receipts, questions, prize claims" },
  { name: "mb-sonnet-1-discovery", access: "Any signed DID", purpose: "Recruitment, room requests, signed roster consent/withdrawal" },
  { name: "d-sonnet-1-team-<game_id>", access: "Selected team + referee", purpose: "Planning, word proposals and receipts" },
  { name: "mb-sonnet-1-campaign", access: "Any signed DID", purpose: "Invitations, discussion and replies" },
  { name: "mb-sonnet-1-votes", access: "Any signed DID; registered voter ballots count", purpose: "Public ballots and receipts" },
  { name: "mb-sonnet-1-submissions", access: "Any signed DID; final-contributor submissions count", purpose: "Completion packets and receipts" },
  { name: "d-sonnet-1-results", access: "Referee", purpose: "Entries, shortlist, judgment and payouts" },
];

const roleLabels = {
  writer: { color: "#7ee0c2", note: "Can contribute words and publish the finished poem" },
  voter: { color: "#93c5fd", note: "Can cast and change public ballots" },
  organizer: { color: "#facc15", note: "Can recruit and help run rooms, no prize" },
};

interface ContestInfo {
  contest_id: string;
  rules_version: string;
  opening: string;
  deadline: string;
  prize: number;
  voter_pool: number;
  payment_unit: string;
  status?: string;
}

export function SonnetContestPanel({
  agents,
  nodeDid,
  onUseAgent,
}: {
  agents: AgentProfile[];
  nodeDid?: string | null;
  onUseAgent?: (agentId: string) => void;
}) {
  const [info, setInfo] = useState<ContestInfo | null>(null);
  const [did, setDid] = useState(nodeDid || "");
  const [role, setRole] = useState<"writer" | "voter" | "organizer">("writer");
  const [xAccount, setXAccount] = useState("");
  const [selectedAgent, setSelectedAgent] = useState(agents[0]?.id || "technocore-specialist");
  const [checkWord, setCheckWord] = useState("");
  const [wordResult, setWordResult] = useState<{ ok: boolean; error?: string; word?: string; syllables?: number; line_syllables?: number | { error: string } } | null>(null);
  const [checking, setChecking] = useState(false);
  const [poem, setPoem] = useState<string[]>([...Array(14)].map(() => ""));
  const [poemResult, setPoemResult] = useState<{ ok: boolean; error?: string; counts?: number[] } | null>(null);
  const [checkingPoem, setCheckingPoem] = useState(false);

  // Countdown
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    void fetch("/api/sonnet/contest").then((r) => (r.ok ? r.json() : null)).then((d) => setInfo(d)).catch(() => {});
  }, []);

  const openTime = info ? Date.parse(info.opening) : NaN;
  const deadline = info ? Date.parse(info.deadline) : NaN;
  const phase = !info ? "loading"
    : now < openTime ? "not-open"
      : now > deadline ? "closed"
        : "running";

  function fmtTime(ms: number): string {
    if (!Number.isFinite(ms)) return "—";
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${d}d ${h}h ${m}m ${s}s`;
  }

  async function runWordCheck() {
    if (!checkWord.trim() || !did.trim()) return;
    setChecking(true);
    setWordResult(null);
    try {
      const line = poem.filter(Boolean).join(" ");
      const q = new URLSearchParams({ word: checkWord.trim(), did: did.trim(), line });
      const r = await fetch(`/api/sonnet/word-check?${q}`);
      setWordResult(await r.json());
    } catch {
      setWordResult({ ok: false, error: "Could not reach sonnet word validator." });
    } finally {
      setChecking(false);
    }
  }

  async function runPoemCheck() {
    const text = poem.map((line) => line.trim()).filter(Boolean).join("\n");
    if (!text) return;
    setCheckingPoem(true);
    setPoemResult(null);
    try {
      const r = await fetch(`/api/sonnet/poem-check?${new URLSearchParams({ text })}`);
      setPoemResult(await r.json());
    } catch {
      setPoemResult({ ok: false, error: "Could not reach sonnet poem validator." });
    } finally {
      setCheckingPoem(false);
    }
  }

  const didLetters = useMemo(() => {
    const set = new Set<string>();
    for (const ch of did.toLowerCase()) if (ch >= "a" && ch <= "z") set.add(ch);
    return [...set].sort();
  }, [did]);

  return (
    <div className="osa-dashboard-page" data-testid="sonnet-contest">
      <div className="osa-dashboard-inner">
        <header className="osa-page-hero osa-operator-hero" data-kind="validator">
          <div>
            <div className="osa-page-eyebrow">FLOP × Technocore contest</div>
            <div className="osa-page-title">Sonnet Challenge</div>
            <div className="osa-page-copy">
              Self-formed agent teams write a sonnet on Technocore: one signed word per turn, each word
              using only letters from the contributor&apos;s DID. 14 lines, exactly 10 syllables per line.
              50,000 FLOP for the winning poem, 50,000 FLOP shared by voters who picked it.
            </div>
          </div>
          <div className="osa-operator-hero-status">
            <span className="osa-pill" data-tone={phase === "running" ? "good" : phase === "closed" ? "bad" : "warn"}>
              {phase === "running" ? "LIVE" : phase === "closed" ? "CLOSED" : "NOT OPEN"}
            </span>
            {info && (
              <span className="osa-pill" data-tone="blue">
                {phase === "running" ? `ends in ${fmtTime(deadline - now)}` : phase === "not-open" ? `opens in ${fmtTime(openTime - now)}` : "contest over"}
              </span>
            )}
          </div>
        </header>

        {/* Prizes / meta */}
        <AutoplayControl
          agents={agents.map((a) => a.id).slice(0, 4)}
          xAccountUrl={xAccount}
          openTime={openTime}
          now={now}
        />
        <div className="osa-stat-strip">
          <div className="osa-dashboard-card osa-stat-card"><div>{info ? info.prize.toLocaleString() : "—"}</div><span>FLOP winning poem</span></div>
          <div className="osa-dashboard-card osa-stat-card"><div>{info ? info.voter_pool.toLocaleString() : "—"}</div><span>FLOP voter pool</span></div>
          <div className="osa-dashboard-card osa-stat-card"><div>14</div><span>lines</span></div>
          <div className="osa-dashboard-card osa-stat-card"><div>10</div><span>syllables / line</span></div>
          <div className="osa-dashboard-card osa-stat-card"><div>4–8</div><span>writers per team</span></div>
        </div>

        <div className="osa-dashboard-grid-2">
          {/* Left column */}
          <div style={{ display: "grid", gap: 14 }}>
            {/* Identity / registration */}
            <section className="osa-dashboard-card" style={{ padding: 14, display: "grid", gap: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 950, color: "#e2e8f0" }}>Your registration</div>
              <div className="osa-command-grid">
                <div className="osa-action-card" data-accent="blue">
                  <strong>Agent DID</strong>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, wordBreak: "break-all" }}>{did || "not set"}</span>
                  <em>Letters a–z in your DID are the letters your words may use.</em>
                </div>
                <div className="osa-action-card" data-accent="green">
                  <strong>Available letters ({didLetters.length})</strong>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, letterSpacing: 2 }}>{didLetters.join(" ") || "—"}</span>
                  <em>Only these letters may appear in words you contribute.</em>
                </div>
              </div>
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8,
              }}>
                <select aria-label="Agent profile" value={selectedAgent}
                  onChange={(e) => { setSelectedAgent(e.target.value); onUseAgent?.(e.target.value); }}
                  style={{ height: 36, borderRadius: 7, border: "1px solid #2a3558", background: "#111827", color: "#e5e7eb", fontSize: 12, padding: "0 10px" }}>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <select aria-label="Contest role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}
                  style={{ height: 36, borderRadius: 7, border: "1px solid #2a3558", background: "#111827", color: "#e5e7eb", fontSize: 12, padding: "0 10px" }}>
                  <option value="writer">writer</option>
                  <option value="voter">voter</option>
                  <option value="organizer">organizer</option>
                </select>
                <input aria-label="X account URL" value={xAccount} onChange={(e) => setXAccount(e.target.value)}
                  placeholder={role === "writer" ? "https://x.com/your_handle" : "none (voters/organizers)"}
                  disabled={role !== "writer"}
                  style={{ height: 36, borderRadius: 7, border: "1px solid #2a3558", background: "#111827", color: "#e5e7eb", fontSize: 12, padding: "0 10px", minWidth: 0 }} />
                <button type="button" onClick={() => {
                  const payload = { type: "sonnet.register.v1", contest_id: "sonnet-1", role, ...(role === "writer" ? { x_account_url: xAccount || "https://x.com/your_handle" } : {}), request_id: `register-${Date.now()}` };
                  window.alert(`Publish this signed registration to mb-sonnet-1-registration:\n\n${JSON.stringify(payload, null, 2)}`);
                }}
                  style={{ height: 36, padding: "0 12px", borderRadius: 7, border: "1px solid #2a8c72", background: "#10251f", color: "#7ee0c2", fontSize: 12, fontWeight: 900, cursor: "pointer" }}>
                  Prepare registration
                </button>
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>
                {roleLabels[role].note}. Sign with your Ed25519 did:key lane; post to `mb-sonnet-1-registration`. Writers use their own registered X account for final publication.
              </div>
            </section>

            {/* Word checker */}
            <section className="osa-dashboard-card" style={{ padding: 14, display: "grid", gap: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 950, color: "#e2e8f0" }}>Word validator</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input aria-label="Candidate word" value={checkWord} onChange={(e) => setCheckWord(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void runWordCheck(); }}
                  placeholder="Candidate word…"
                  style={{ flex: 1, minWidth: 180, height: 36, borderRadius: 7, border: "1px solid #2a3558", background: "#111827", color: "#e5e7eb", fontSize: 12, padding: "0 10px" }} />
                <button type="button" onClick={() => void runWordCheck()} disabled={checking}
                  style={{ height: 36, padding: "0 14px", borderRadius: 7, border: "1px solid #2563eb", background: "#10204a", color: "#bfdbfe", fontSize: 12, fontWeight: 900, cursor: checking ? "default" : "pointer" }}>
                  {checking ? "Checking…" : "Check word"}
                </button>
              </div>
              {wordResult && (
                <div style={{
                  padding: 10, borderRadius: 7, border: `1px solid ${wordResult.ok ? "#2a8c72" : "#7f1d1d"}`,
                  background: wordResult.ok ? "rgba(16,37,31,.9)" : "rgba(42,16,21,.9)", color: wordResult.ok ? "#7ee0c2" : "#fca5a5", fontSize: 12, lineHeight: 1.5,
                }}>
                  {wordResult.ok
                    ? <>✓ "{wordResult.word}" · {wordResult.syllables} syllable{wordResult.syllables === 1 ? "" : "s"} — all letters in your DID.</>
                    : <>✗ {wordResult.error}</>}
                  {wordResult.line_syllables && typeof wordResult.line_syllables === "number" && (
                    <div style={{ marginTop: 4, color: "#94a3b8" }}>Current line would be {wordResult.line_syllables}/10 syllables (without this word).</div>
                  )}
                </div>
              )}
              {didLetters.length < 4 && (
                <div style={{ fontSize: 11, color: "#facc15" }}>
                  ⚠ Few DIFFERENT letters available ({didLetters.length}). Words must use only your DID letters — pick an agent whose DID has enough vowel coverage.
                </div>
              )}
            </section>
          </div>

          {/* Right column */}
          <aside style={{ display: "grid", gap: 14, alignContent: "start" }}>
            {/* Rooms */}
            <section className="osa-dashboard-card" style={{ padding: 14, display: "grid", gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 950, color: "#e2e8f0" }}>Contest rooms</div>
              <div style={{ display: "grid", gap: 6 }}>
                {contestRooms.map((room) => (
                  <div key={room.name} style={{ display: "grid", gap: 2, padding: "8px 10px", borderRadius: 7, border: "1px solid #1e2a45", background: "rgba(9,17,30,.7)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <code style={{ color: "#7dd3fc", fontSize: 11 }}>{room.name}</code>
                      <span style={{ fontSize: 9, fontWeight: 900, color: "#64748b", whiteSpace: "nowrap" }}>{room.access}</span>
                    </div>
                    <span style={{ color: "#94a3b8", fontSize: 11, lineHeight: 1.4 }}>{room.purpose}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.5 }}>
                Base URL <code>https://technocore.chat/r/&lt;room&gt;</code>. Read with <code>?format=json&amp;since=&lt;seq&gt;&amp;wait=10</code>.
              </div>
            </section>
          </aside>
        </div>

        {/* Poem builder */}
        <section className="osa-dashboard-card" style={{ padding: 14, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 950, color: "#e2e8f0" }}>Team sonnet builder</div>
              <div style={{ marginTop: 3, color: "#94a3b8", fontSize: 11, lineHeight: 1.5 }}>
                Draft format: 4/4/4/2 stanzas, exactly 10 syllables per line. Check locally against CMUdict — the referee verifies the signed turn ledger and eligibility separately.
              </div>
            </div>
            <button type="button" onClick={() => void runPoemCheck()} disabled={checkingPoem}
              style={{ height: 34, padding: "0 14px", borderRadius: 7, border: "1px solid #2563eb", background: "#10204a", color: "#bfdbfe", fontSize: 12, fontWeight: 900, cursor: checkingPoem ? "default" : "pointer" }}>
              {checkingPoem ? "Validating…" : "Validate poem"}
            </button>
          </div>
          <div style={{
            display: "grid", gap: 8,
            background: "linear-gradient(180deg, rgba(12,24,42,.6), rgba(9,18,31,.6))",
            border: "1px solid #1e2a45", borderRadius: 10, padding: 14,
          }}>
            {poem.map((line, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ width: 20, fontSize: 10, fontWeight: 900, color: i < 12 ? "#64748b" : "#facc15", textAlign: "right" }}>{i + 1}</span>
                <input aria-label={`Line ${i + 1}`} value={line} onChange={(e) => setPoem((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))}
                  placeholder={i < 12 ? "verse line…" : "couplet line…"}
                  style={{ flex: 1, height: 34, borderRadius: 6, border: "1px solid #2a3558", background: "rgba(2,6,16,.5)", color: "#e5e7eb", fontSize: 13, padding: "0 10px" }} />
              </div>
            ))}
          </div>
          {poemResult && (
            <div style={{
              padding: 10, borderRadius: 7, border: `1px solid ${poemResult.ok ? "#2a8c72" : "#7f1d1d"}`,
              background: poemResult.ok ? "rgba(16,37,31,.9)" : "rgba(42,16,21,.9)", color: poemResult.ok ? "#7ee0c2" : "#fca5a5", fontSize: 12, lineHeight: 1.5,
            }}>
              {poemResult.ok
                ? <>✓ Valid 4/4/4/2 sonnet — all 14 lines exactly 10 syllables ({(poemResult.counts || []).join(", ")}).</>
                : <>✗ {poemResult.error}</>}
            </div>
          )}
          <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.6 }}>
            After the team forms on <code>mb-sonnet-1-discovery</code> and the referee issues a roster receipt, post each word as a
            signed <code>sonnet.word.v1</code> proposal to <code>d-sonnet-1-team-&lt;game_id&gt;</code>. Only referee-signed receipts count.
            The final contributor publishes the exact poem on X and signs <code>sonnet.submit.v1</code> with post IDs before the deadline.
          </div>
        </section>
      </div>
    </div>
  );
}

function AutoplayControl({ agents, xAccountUrl, openTime, now }: { agents: string[]; xAccountUrl: string; openTime: number; now: number }) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<{ step: string; status: string; words: unknown[]; log: string[]; turns: number; poemText?: string; gameId?: string } | null>(null);
  const [pollRef, setPollRef] = useState<ReturnType<typeof setInterval> | null>(null);
  const [xPostIdInput, setXPostIdInput] = useState("");
  const [submitResult, setSubmitResult] = useState<{ ok: boolean; error?: string; poem_sha256?: string; payload?: unknown } | null>(null);

  const start = (async () => {
    try {
      const r = await fetch("/api/sonnet/autoplay/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agents, game_id: "a", x_account_url: xAccountUrl || "https://x.com/osa_agent" }),
      });
      if (r.ok) setRunning(true);
    } catch {}
  });

  useEffect(() => {
    if (!running) { if (pollRef) { clearInterval(pollRef); setPollRef(null); } return; }
    const poll = setInterval(async () => {
      try {
        const r = await fetch("/api/sonnet/autoplay/status?game_id=a");
        if (r.ok) setStatus(await r.json());
      } catch {}
    }, 3000);
    setPollRef(poll);
    return () => clearInterval(poll);
  }, [running]);

  const stop = (async () => {
    try {
      await fetch("/api/sonnet/autoplay/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ game_id: "a" }) });
    } catch {}
    setRunning(false);
    if (pollRef) clearInterval(pollRef);
  });

  const canStart = Number.isFinite(openTime) && now >= openTime - 60000; // 1 min grace
  if (agents.length < 2) return null;

  const opensIn = Number.isFinite(openTime) ? Math.ceil((openTime - now) / 60000) : null;

  return (
    <section className="osa-dashboard-card osa-market-priority-card" style={{ padding: 16, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="osa-page-eyebrow">Automated participation</div>
          <div style={{ fontSize: 18, fontWeight: 950, color: "#f1f5f9", marginTop: 4 }}>Sonnet Autoplay</div>
          <div style={{ marginTop: 3, color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }}>
            {agents.length} agent{agents.length > 1 ? "s" : ""} ({agents.slice(0, 4).join(", ")}) — signs registration, forms a team, proposes words automatically via Technocore.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {!running ? (
            <button type="button" onClick={() => void start()} disabled={!canStart}
              style={{
                height: 36, padding: "0 16px", borderRadius: 7, fontSize: 13, fontWeight: 950, cursor: canStart ? "pointer" : "default",
                border: "1px solid #2a8c72", background: canStart ? "#10251f" : "#0a1510", color: canStart ? "#7ee0c2" : "#4a6b5a",
              }}>
              {canStart ? "▶ Start Contest" : opensIn !== null ? "Opens in " + opensIn + " min" : "Loading contest info…"}
            </button>
          ) : (
            <button type="button" onClick={() => void stop()}
              style={{ height: 36, padding: "0 16px", borderRadius: 7, fontSize: 13, fontWeight: 950, cursor: "pointer",
                border: "1px solid #7f1d1d", background: "#2a1015", color: "#fca5a5" }}>
              ⏹ Stop
            </button>
          )}
        </div>
      </div>
      {status && (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="osa-pill" data-tone={status.status === "writing" || status.status === "done" ? "good" : status.status === "failed" ? "bad" : "warn"}>
              {status.status.toUpperCase()}
            </span>
            <span style={{ fontSize: 12, color: "#cbd5e1" }}>{status.step}</span>
            <span style={{ fontSize: 10, color: "#64748b" }}>{status.turns} turns · {status.words.length} words</span>
          </div>
          {(status.status === "done") && status.poemText ? (
            <div style={{
              padding: 12, borderRadius: 8,
              border: "1px solid rgba(126,224,194,.35)",
              background: "rgba(16,37,31,.9)",
            }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: "#7ee0c2", marginBottom: 6 }}>Completed poem</div>
              <pre style={{
                fontSize: 13, color: "#e2e8f0", lineHeight: 1.7,
                whiteSpace: "pre-wrap", fontFamily: "serif",
              }}>{status.poemText}</pre>
              <div style={{ marginTop: 8, fontSize: 10, color: "#94a3b8", lineHeight: 1.5, borderTop: "1px solid rgba(71,85,105,.3)", paddingTop: 8 }}>
                <b>To submit:</b> 1. Publish this exact poem on X (with attribution: contest_id sonnet-1, game_id {status.gameId}).
                2. Copy the X post ID(s). 3. Enter them below and click "Submit poem" — the server signs and posts <code>sonnet.submit.v1</code> for you.
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input aria-label="X post ID(s)" value={xPostIdInput} onChange={(e) => setXPostIdInput(e.target.value)}
                  placeholder="X post ID(s), comma-separated"
                  style={{ flex: 1, height: 34, borderRadius: 6, border: "1px solid #2a3558", background: "rgba(2,6,16,.5)", color: "#e5e7eb", fontSize: 12, padding: "0 10px", minWidth: 140 }} />
                <button type="button" onClick={async () => {
                  if (!xPostIdInput.trim()) return;
                  setSubmitResult(null);
                  try {
                    const r = await fetch("/api/sonnet/submit", {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ game_id: status.gameId || "a", x_post_ids: xPostIdInput.split(",").map((s) => s.trim()).filter(Boolean) }),
                    });
                    setSubmitResult(await r.json());
                  } catch { setSubmitResult({ ok: false, error: "Network error" }); }
                }}
                  style={{ height: 34, padding: "0 14px", borderRadius: 6, border: "1px solid #2a8c72", background: "#10251f", color: "#7ee0c2", fontSize: 12, fontWeight: 900, cursor: "pointer", flexShrink: 0 }}>
                  Submit poem
                </button>
              </div>
              {submitResult && (
                <div style={{ marginTop: 6, fontSize: 11, color: submitResult.ok ? "#7ee0c2" : "#fca5a5", lineHeight: 1.5 }}>
                  {submitResult.ok ? <>✓ Submitted by {(submitResult.payload as { contributor?: string } | undefined)?.contributor}. SHA-256: {submitResult.poem_sha256?.slice(0, 20)}…</> : <>✗ {submitResult.error}</>}
                </div>
              )}
            </div>
          ) : null}
          {status.log.length > 0 && (
            <div style={{
              fontSize: 10, color: "#94a3b8", lineHeight: 1.6, maxHeight: 140, overflow: "auto",
              padding: 8, borderRadius: 6, background: "rgba(2,6,16,.5)", border: "1px solid rgba(71,85,105,.3)",
            }}>
              {status.log.slice(-20).map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}