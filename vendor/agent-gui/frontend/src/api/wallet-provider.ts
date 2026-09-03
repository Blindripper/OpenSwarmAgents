/**
 * EIP-6963 wallet provider detection.
 *
 * Phantom Wallet (evmAsk.js) hijacks window.ethereum and wraps its request()
 * method with a selectExtension flow that can throw "Unexpected error".
 * This module bypasses the wrapper by discovering real providers directly
 * from each installed wallet via EIP-6963.
 */

export interface WalletProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

export interface WalletInfo {
  name: string;
  icon: string | null;  // data URI (base64 SVG/PNG)
  uuid: string;
  rdns?: string;
  provider: WalletProvider;
  providerType: "eip6963" | "legacy" | "selected";
}

/** Timeout (ms) for EIP-6963 provider discovery. */
const EIP6963_TIMEOUT_MS = 2000;

/**
 * Detect all available EVM wallet providers.
 *
 * Returns a list of detected wallets with their names and icons from EIP-6963.
 * Also checks window.ethereum.providers (MetaMask's fallback array) for wallets
 * that may have been missed. Phantom wrappers (isPhantom) are excluded since
 * their request() method throws "Unexpected error".
 */
export async function detectWallets(): Promise<WalletInfo[]> {
  const seen = new Set<any>();
  const wallets: WalletInfo[] = [];

  // Step 1 — EIP-6963: collect real providers.
  const eip6963 = await eip6963Discover();
  for (const w of eip6963) {
    if (seen.has(w.provider)) continue;
    seen.add(w.provider);
    wallets.push(w);
  }

  // Step 2 — window.ethereum.providers[] (MetaMask stores all providers here
  // even when another wallet claims window.ethereum).
  const eth = (window as unknown as Record<string, unknown>).ethereum as any;
  const providersList = Array.isArray(eth?.providers) ? eth.providers : [];
  for (const p of providersList) {
    if (!p?.request || seen.has(p)) continue;
    seen.add(p);
    wallets.push({
      name: (p as any).isMetaMask ? "MetaMask" : (p as any).isPhantom ? "Phantom" : `Wallet (${p.constructor?.name || "unknown"})`,
      icon: null,
      uuid: `providers-${wallets.length}`,
      provider: p as WalletProvider,
      providerType: "legacy",
    });
  }

  // Step 3 — window.ethereum if it's a standalone provider (not the Phantom wrapper).
  if (eth?.request && !seen.has(eth)) {
    const isPhantom = typeof eth.selectExtension === "function";
    if (!isPhantom) {
      seen.add(eth);
      wallets.push({
        name: (eth as any).isMetaMask ? "MetaMask" : "EVM Wallet",
        icon: null,
        uuid: "window-ethereum",
        provider: eth as WalletProvider,
        providerType: "legacy",
      });
    }
  }

  return wallets;
}

/**
 * Select a wallet provider.
 *
 * Auto-selects if only one real wallet is found. If multiple wallets are
 * detected, returns all of them; the caller (UI) should show a picker and
 * call selectWallet() again with the chosen WalletInfo.
 */
export async function selectWallet(): Promise<WalletInfo> {
  const wallets = await detectWallets();

  if (wallets.length === 0) {
    throw new Error(
      "No EVM wallet found. Install MetaMask or another EVM wallet browser extension.",
    );
  }

  if (wallets.length === 1) {
    return wallets[0];
  }

  // Multiple wallets — return a special signal by throwing a typed error.
  const err = new Error("MULTIPLE_WALLETS") as any;
  err.wallets = wallets;
  err.code = "MULTIPLE_WALLETS";
  throw err;
}

// ── EIP-6963 discovery ──────────────────────────────────────────────────────

interface Eip6963Announcement {
  info: {
    uuid: string;
    name: string;
    icon: string;
    rdns?: string;
  };
  provider: WalletProvider;
}

async function eip6963Discover(): Promise<WalletInfo[]> {
  return new Promise<WalletInfo[]>((resolve) => {
    const found: Map<string, WalletInfo> = new Map();
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      window.removeEventListener("eip6963:announceProvider", handler as any);
      resolve(Array.from(found.values()));
    };

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as Eip6963Announcement | undefined;
      if (!detail?.provider?.request || !detail?.info?.uuid) return;
      const key = detail.info.uuid;
      if (found.has(key)) return;
      // Exclude Phantom (isPhantom) — its request() throws from evmAsk.js.
      if ((detail.provider as any).isPhantom) return;
      if (detail.info.name?.toLowerCase().includes("phantom")) return;
      found.set(key, {
        name: detail.info.name || "Unknown Wallet",
        icon: detail.info.icon || null,
        uuid: detail.info.uuid,
        rdns: detail.info.rdns,
        provider: detail.provider as WalletProvider,
        providerType: "eip6963",
      });
    };

    window.addEventListener("eip6963:announceProvider", handler as any);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(finish, EIP6963_TIMEOUT_MS);
  });
}