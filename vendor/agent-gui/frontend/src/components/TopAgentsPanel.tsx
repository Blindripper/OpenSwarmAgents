import { useState } from "react";
import { api, type WalletSession } from "../api/client";
import type { TopAgent } from "../types";

interface Props {
  agents: TopAgent[];
  title?: string;
  subtitle?: string;
  emptyText?: string;
  entityLabel?: string;
  loading?: boolean;
  onRefresh: () => void;
  onCopy?: (sessionId: string) => void;
  onDonateRecorded?: () => void;
  onDetails?: (project: TopAgent) => void;
  onDelete?: (project: TopAgent) => void;
}

type WalletProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

const WALLET_STORAGE_KEY = "osa-wallet-session";

function readWalletSession(): WalletSession | null {
  try {
    const raw = localStorage.getItem(WALLET_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as WalletSession : null;
    return parsed?.verified === true && /^0x[a-fA-F0-9]{40}$/.test(parsed.address || "") ? parsed : null;
  } catch {
    return null;
  }
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function TopAgentsPanel({
  agents,
  title = "Top100 Projects",
  subtitle = "Ranked by copies. Copy a project into Home, donate USDC to its builder, or leave a review.",
  emptyText = "Share a project to start the chart.",
  entityLabel = "agent",
  loading = false,
  onRefresh,
  onCopy,
  onDonateRecorded,
  onDetails,
  onDelete,
}: Props) {
  const maxCopies = Math.max(1, ...agents.map((agent) => agent.copy_count));
  const [wallet, setWallet] = useState<WalletSession | null>(() => readWalletSession());
  const [donatingAgent, setDonatingAgent] = useState<TopAgent | null>(null);
  const [amountMode, setAmountMode] = useState<"1" | "5" | "custom">("1");
  const [customAmount, setCustomAmount] = useState("10");
  const [donationPending, setDonationPending] = useState(false);
  const [donationError, setDonationError] = useState<string | null>(null);
  const [donationStatus, setDonationStatus] = useState<string | null>(null);
  const [reviewingProject, setReviewingProject] = useState<TopAgent | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewTitle, setReviewTitle] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [reviewPending, setReviewPending] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<string | null>(null);
  const isProjectChart = entityLabel.toLowerCase() === "project";

  async function connectWallet(): Promise<WalletSession | null> {
    setDonationError(null);
    const provider = (window as typeof window & { ethereum?: WalletProvider }).ethereum;
    if (!provider) {
      setDonationError("No wallet found. Open OSA with MetaMask or another EVM wallet.");
      return null;
    }
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      const address = accounts[0];
      if (!address) throw new Error("No wallet account selected.");
      let chainId: string | null = null;
      try {
        chainId = await provider.request({ method: "eth_chainId" }) as string;
      } catch { /* wallet can still be used as identity */ }
      const challenge = await api.wallet.challenge({ address, chain_id: chainId });
      const signature = await provider.request({
        method: "personal_sign",
        params: [challenge.challenge.message, address],
      });
      if (typeof signature !== "string") throw new Error("Wallet did not return a login signature.");
      const result = await api.wallet.login({
        address,
        chain_id: chainId,
        challenge_id: challenge.challenge.id,
        message: challenge.challenge.message,
        signature,
      });
      localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(result.wallet));
      setWallet(result.wallet);
      return result.wallet;
    } catch (error) {
      setDonationError((error as Error).message || "Wallet connection failed.");
      return null;
    }
  }

  async function submitDonation() {
    if (!donatingAgent || donationPending) return;
    setDonationError(null);
    setDonationStatus(null);
    const amount = amountMode === "custom" ? Number(customAmount) : Number(amountMode);
    if (!Number.isFinite(amount) || amount <= 0) {
      setDonationError("Enter a USDC amount greater than zero.");
      return;
    }
    setDonationPending(true);
    try {
      const activeWallet = wallet || await connectWallet();
      if (!activeWallet) return;
      await api.donations.create({
        session_id: donatingAgent.id,
        target_type: donatingAgent.target_type,
        target_id: donatingAgent.target_id,
        amount,
        wallet_address: activeWallet.address,
        chain_id: activeWallet.chain_id,
      });
      setDonationStatus(`${amount} USDC donation intent saved.`);
      onDonateRecorded?.();
    } catch (error) {
      setDonationError((error as Error).message || "Donation failed.");
    } finally {
      setDonationPending(false);
    }
  }

  async function submitProjectReview() {
    if (!reviewingProject || reviewPending) return;
    setReviewError(null);
    setReviewStatus(null);
    const projectId = reviewingProject.target_id || reviewingProject.id.replace(/^public-project-/, "");
    if (!projectId) {
      setReviewError("Project id missing.");
      return;
    }
    setReviewPending(true);
    try {
      const activeWallet = wallet || await connectWallet();
      if (!activeWallet) return;
      await api.publicProjects.review(projectId, {
        wallet_address: activeWallet.address,
        rating: reviewRating,
        title: reviewTitle,
        comment: reviewComment,
      });
      setReviewStatus("Review saved.");
      onDonateRecorded?.();
    } catch (error) {
      setReviewError((error as Error).message || "Review failed.");
    } finally {
      setReviewPending(false);
    }
  }

  return (
    <div style={{
      flex: 1,
      overflow: "auto",
      background: "linear-gradient(180deg, #11182d 0%, #151126 52%, #0c1020 100%)",
      color: "var(--text)",
      padding: 18,
      boxSizing: "border-box",
    }}>
      <div style={{
        maxWidth: 1120,
        margin: "0 auto",
        display: "grid",
        gap: 12,
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          minHeight: 38,
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 0 }}>{title}</div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 3 }}>
              {subtitle}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={() => void connectWallet()}
              style={{
                height: 30,
                padding: "0 12px",
                borderRadius: 6,
                border: "1px solid #2a3558",
                background: wallet ? "#13251f" : "#121828",
                color: wallet ? "#7ee0c2" : "var(--text-dim)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              {wallet ? shortAddress(wallet.address) : "Connect Wallet"}
            </button>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              style={{
                height: 30,
                padding: "0 12px",
                borderRadius: 6,
                border: "1px solid #2a3558",
                background: "#121828",
                color: loading ? "var(--text-dim)" : "var(--accent2)",
                cursor: loading ? "default" : "pointer",
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              {loading ? "Loading" : "Refresh"}
            </button>
          </div>
        </div>

        {agents.length === 0 ? (
          <div style={{
            minHeight: 360,
            border: "1px dashed #2a3558",
            borderRadius: 8,
            display: "grid",
            placeItems: "center",
            color: "var(--text-dim)",
            fontSize: 13,
            textAlign: "center",
            padding: 24,
          }}>
            {emptyText}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {agents.map((agent) => {
              const pct = Math.max(4, Math.round((agent.copy_count / maxCopies) * 100));
              const canDelete = isProjectChart
                && Boolean(onDelete)
                && Boolean(wallet?.address)
                && String(agent.owner_wallet_address || "").toLowerCase() === String(wallet?.address || "").toLowerCase();
              return (
                <div
                  key={agent.id}
                  style={{
                    position: "relative",
                    overflow: "hidden",
                    minHeight: 76,
                    borderRadius: 8,
                    border: "1px solid #273453",
                    background: "#101827",
                    boxShadow: agent.rank <= 3 ? "0 0 22px rgba(34,211,238,0.12)" : "none",
                  }}
                >
                  <div style={{
                    position: "absolute",
                    inset: 0,
                    width: `${pct}%`,
                    background: "linear-gradient(90deg, rgba(34,211,238,0.24), rgba(124,58,237,0.12))",
                  }} />
                  <div style={{
                    position: "relative",
                    display: "grid",
                    gridTemplateColumns: isProjectChart ? "58px minmax(0, 1fr) 156px 68px 70px 74px 82px 70px" : "58px minmax(0, 1fr) 132px 74px 82px",
                    alignItems: "center",
                    gap: 12,
                    minHeight: 76,
                    padding: "10px 12px",
                    boxSizing: "border-box",
                  }}>
                    <div style={{
                      fontSize: 18,
                      fontWeight: 900,
                      color: agent.rank <= 3 ? "var(--accent2)" : "var(--text)",
                      fontVariantNumeric: "tabular-nums",
                    }}>
                      #{agent.rank}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: 13,
                        fontWeight: 800,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }} title={agent.title}>
                        {agent.title}
                      </div>
                      <div style={{
                        marginTop: 4,
                        fontSize: 11,
                        color: "var(--text-dim)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }} title={agent.summary}>
                        {agent.agent} - {agent.model}
                      </div>
                    </div>
                    <div style={{
                      justifySelf: "end",
                      display: "grid",
                      gap: 2,
                      textAlign: "right",
                      fontSize: 11,
                      fontWeight: 800,
                      color: "var(--text)",
                      fontVariantNumeric: "tabular-nums",
                    }}>
                      <span>{agent.copy_count} copies</span>
                      <span style={{ color: "var(--text-dim)", fontWeight: 700 }}>
                        {Number(agent.donation_total_usdc || 0)} USDC earned
                      </span>
                      {isProjectChart && (
                        <span style={{ color: "#facc15", fontWeight: 800 }}>
                          {agent.review_count ? `${Number(agent.rating_avg || 0).toFixed(1)} stars` : "No reviews"}
                        </span>
                      )}
                    </div>
                    {isProjectChart && (
                      <button
                        type="button"
                        onClick={() => onDetails?.(agent)}
                        disabled={!onDetails}
                        style={{
                          height: 30,
                          borderRadius: 6,
                          border: "1px solid #2a3558",
                          background: "#121828",
                          color: onDetails ? "var(--accent2)" : "var(--text-dim)",
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: onDetails ? "pointer" : "default",
                        }}
                      >
                        Details
                      </button>
                    )}
                    {isProjectChart && (
                      <button
                        type="button"
                        onClick={() => {
                          setReviewingProject(agent);
                          setReviewRating(5);
                          setReviewTitle("");
                          setReviewComment("");
                          setReviewError(null);
                          setReviewStatus(null);
                        }}
                        style={{
                          height: 30,
                          borderRadius: 6,
                          border: "1px solid #7a6420",
                          background: "#241f10",
                          color: "#facc15",
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                      >
                        Review
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onCopy?.(agent.id)}
                      disabled={!onCopy}
                      style={{
                        height: 30,
                        borderRadius: 6,
                        border: "1px solid var(--card-border)",
                        background: "var(--accent2)",
                        color: "white",
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: onCopy ? "pointer" : "default",
                      }}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDonatingAgent(agent);
                        setAmountMode("1");
                        setDonationError(null);
                        setDonationStatus(null);
                      }}
                      style={{
                        height: 30,
                        borderRadius: 6,
                        border: "1px solid #2a8c72",
                        background: "#10251f",
                        color: "#7ee0c2",
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      Donate
                    </button>
                    {isProjectChart && canDelete && (
                      <button
                        type="button"
                        onClick={() => onDelete?.(agent)}
                        style={{
                          height: 30,
                          borderRadius: 6,
                          border: "1px solid #7f1d1d",
                          background: "#2a1015",
                          color: "#fca5a5",
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {donatingAgent && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Donate to ${donatingAgent.title}`}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 3000,
            display: "grid",
            placeItems: "center",
            background: "rgba(4,8,18,0.72)",
            padding: 18,
          }}
          onClick={() => setDonatingAgent(null)}
        >
          <div
            style={{
              width: "min(420px, 100%)",
              borderRadius: 8,
              border: "1px solid #273453",
              background: "#101827",
              boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
              padding: 16,
              boxSizing: "border-box",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 900 }}>Donate USDC</div>
                <div style={{
                  marginTop: 4,
                  fontSize: 12,
                  color: "var(--text-dim)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }} title={donatingAgent.title}>
                  #{donatingAgent.rank} {entityLabel}: {donatingAgent.title}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDonatingAgent(null)}
                title="Close"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: "1px solid var(--card-border)",
                  background: "#121828",
                  color: "var(--text)",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                x
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 14 }}>
              {(["1", "5", "custom"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAmountMode(value)}
                  style={{
                    height: 34,
                    borderRadius: 6,
                    border: amountMode === value ? "1px solid var(--accent2)" : "1px solid var(--card-border)",
                    background: amountMode === value ? "rgba(34,211,238,0.18)" : "#121828",
                    color: amountMode === value ? "var(--accent2)" : "var(--text)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {value === "custom" ? "Custom" : `${value} USDC`}
                </button>
              ))}
            </div>

            {amountMode === "custom" && (
              <input
                value={customAmount}
                onChange={(e) => setCustomAmount(e.currentTarget.value)}
                inputMode="decimal"
                placeholder="USDC amount"
                style={{
                  marginTop: 10,
                  width: "100%",
                  height: 36,
                  borderRadius: 6,
                  border: "1px solid var(--card-border)",
                  background: "#0b1020",
                  color: "var(--text)",
                  padding: "0 10px",
                  boxSizing: "border-box",
                }}
              />
            )}

            <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4 }}>
              Wallet pubkeys identify OSA project donors and can later power decentralized owner/reputation views.
              OSA keeps 5% for development and running costs, also known as the tiny infrastructure coffee tax.
            </div>
            {wallet && (
              <div style={{ marginTop: 8, fontSize: 11, color: "#7ee0c2", fontFamily: "ui-monospace, monospace" }}>
                {shortAddress(wallet.address)}
              </div>
            )}
            {donationError && (
              <div style={{ marginTop: 10, fontSize: 12, color: "#ff8a8a" }}>{donationError}</div>
            )}
            {donationStatus && (
              <div style={{ marginTop: 10, fontSize: 12, color: "#7ee0c2" }}>{donationStatus}</div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button
                type="button"
                onClick={() => void connectWallet()}
                style={{
                  height: 34,
                  padding: "0 12px",
                  borderRadius: 6,
                  border: "1px solid #2a3558",
                  background: "#121828",
                  color: wallet ? "#7ee0c2" : "var(--text)",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                {wallet ? "Wallet Connected" : "Connect Wallet"}
              </button>
              <button
                type="button"
                onClick={() => void submitDonation()}
                disabled={donationPending}
                style={{
                  height: 34,
                  padding: "0 14px",
                  borderRadius: 6,
                  border: "1px solid #2a8c72",
                  background: donationPending ? "#18251f" : "#16a37b",
                  color: "white",
                  cursor: donationPending ? "default" : "pointer",
                  fontSize: 12,
                  fontWeight: 900,
                }}
              >
                {donationPending ? "Saving" : "Donate"}
              </button>
            </div>
          </div>
        </div>
      )}
      {reviewingProject && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Review ${reviewingProject.title}`}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 3000,
            display: "grid",
            placeItems: "center",
            background: "rgba(4,8,18,0.72)",
            padding: 18,
          }}
          onClick={() => setReviewingProject(null)}
        >
          <div
            style={{
              width: "min(480px, 100%)",
              borderRadius: 8,
              border: "1px solid #273453",
              background: "#101827",
              boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
              padding: 16,
              boxSizing: "border-box",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 900 }}>Project Review</div>
                <div style={{
                  marginTop: 4,
                  fontSize: 12,
                  color: "var(--text-dim)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }} title={reviewingProject.title}>
                  {reviewingProject.title}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReviewingProject(null)}
                title="Close"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: "1px solid var(--card-border)",
                  background: "#121828",
                  color: "var(--text)",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                x
              </button>
            </div>

            <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setReviewRating(star)}
                  title={`${star} star${star === 1 ? "" : "s"}`}
                  style={{
                    width: 36,
                    height: 34,
                    borderRadius: 6,
                    border: star <= reviewRating ? "1px solid #facc15" : "1px solid var(--card-border)",
                    background: star <= reviewRating ? "#2a230f" : "#121828",
                    color: star <= reviewRating ? "#facc15" : "var(--text-dim)",
                    cursor: "pointer",
                    fontSize: 18,
                    lineHeight: 1,
                  }}
                >
                  ★
                </button>
              ))}
            </div>

            <input
              value={reviewTitle}
              onChange={(e) => setReviewTitle(e.currentTarget.value)}
              placeholder="Short headline"
              maxLength={120}
              style={{
                marginTop: 12,
                width: "100%",
                height: 36,
                borderRadius: 6,
                border: "1px solid var(--card-border)",
                background: "#0b1020",
                color: "var(--text)",
                padding: "0 10px",
                boxSizing: "border-box",
              }}
            />
            <textarea
              value={reviewComment}
              onChange={(e) => setReviewComment(e.currentTarget.value)}
              placeholder="What worked, what was useful, what should be improved?"
              maxLength={2000}
              rows={5}
              style={{
                marginTop: 10,
                width: "100%",
                borderRadius: 6,
                border: "1px solid var(--card-border)",
                background: "#0b1020",
                color: "var(--text)",
                padding: 10,
                boxSizing: "border-box",
                resize: "vertical",
              }}
            />

            <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4 }}>
              Reviews are tied to your wallet pubkey so project feedback can become part of OSA reputation instead of disposable noise.
            </div>
            {reviewError && (
              <div style={{ marginTop: 10, fontSize: 12, color: "#ff8a8a" }}>{reviewError}</div>
            )}
            {reviewStatus && (
              <div style={{ marginTop: 10, fontSize: 12, color: "#7ee0c2" }}>{reviewStatus}</div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button
                type="button"
                onClick={() => void connectWallet()}
                style={{
                  height: 34,
                  padding: "0 12px",
                  borderRadius: 6,
                  border: "1px solid #2a3558",
                  background: "#121828",
                  color: wallet ? "#7ee0c2" : "var(--text)",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                {wallet ? "Wallet Connected" : "Connect Wallet"}
              </button>
              <button
                type="button"
                onClick={() => void submitProjectReview()}
                disabled={reviewPending}
                style={{
                  height: 34,
                  padding: "0 14px",
                  borderRadius: 6,
                  border: "1px solid #7a6420",
                  background: reviewPending ? "#262115" : "#b98b14",
                  color: "white",
                  cursor: reviewPending ? "default" : "pointer",
                  fontSize: 12,
                  fontWeight: 900,
                }}
              >
                {reviewPending ? "Saving" : "Save Review"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
