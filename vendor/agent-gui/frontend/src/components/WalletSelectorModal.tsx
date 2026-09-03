import { useState } from "react";
import { type WalletInfo, type WalletProvider } from "../api/wallet-provider";

interface Props {
  wallets: WalletInfo[];
  onSelect: (provider: WalletProvider, info: WalletInfo) => void;
  onCancel: () => void;
}

export function WalletSelectorModal({ wallets, onSelect, onCancel }: Props) {
  const [error, setError] = useState<string | null>(null);

  async function handlePick(w: WalletInfo) {
    try {
      onSelect(w.provider, w);
    } catch (err: any) {
      setError(`"${w.name}" did not respond. Try another wallet.`);
    }
  }

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.65)",
    backdropFilter: "blur(4px)",
  };

  const modalStyle: React.CSSProperties = {
    background: "#161b2e",
    border: "1px solid #2a3558",
    borderRadius: 12,
    padding: "24px 28px",
    minWidth: 320,
    maxWidth: 400,
    color: "#e0e0e0",
    fontFamily: "system-ui, sans-serif",
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 16,
    fontWeight: 700,
    marginBottom: 4,
    color: "#fff",
  };

  const subtitleStyle: React.CSSProperties = {
    fontSize: 12,
    color: "#8892b0",
    marginBottom: 20,
  };

  const walletBtnStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    padding: "12px 16px",
    marginBottom: 8,
    background: "#1e2538",
    border: "1px solid #2a3558",
    borderRadius: 8,
    color: "#e0e0e0",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    textAlign: "left",
    transition: "background 0.15s",
  };

  const iconStyle: React.CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: 6,
    flexShrink: 0,
    background: "#2a3558",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 16,
    overflow: "hidden",
  };

  const cancelStyle: React.CSSProperties = {
    display: "block",
    marginTop: 12,
    padding: "8px 0",
    width: "100%",
    background: "none",
    border: "none",
    color: "#8892b0",
    fontSize: 12,
    cursor: "pointer",
    textAlign: "center",
  };

  const errorStyle: React.CSSProperties = {
    color: "#f48771",
    fontSize: 12,
    marginBottom: 12,
    padding: "8px 12px",
    background: "rgba(244,135,113,0.1)",
    borderRadius: 6,
    border: "1px solid rgba(244,135,113,0.3)",
  };

  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        {error && <div style={errorStyle}>{error}</div>}
        <div style={titleStyle}>Connect a Wallet</div>
        <div style={subtitleStyle}>
          {wallets.length} wallet{wallets.length > 1 ? "s" : ""} detected
        </div>
        {wallets.map((w) => (
          <button
            key={w.uuid}
            style={walletBtnStyle}
            onClick={() => handlePick(w)}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#252d45")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#1e2538")}
          >
            <div style={iconStyle}>
              {w.icon ? (
                <img src={w.icon} alt={w.name} style={{ width: 28, height: 28 }} />
              ) : (
                w.name === "MetaMask" ? "🦊" : "👛"
              )}
            </div>
            <span>{w.name}</span>
          </button>
        ))}
        <button style={cancelStyle} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}