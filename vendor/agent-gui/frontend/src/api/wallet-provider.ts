/**
 * EIP-6963 wallet provider detection.
 *
 * Phantom Wallet (evmAsk.js) hijacks window.ethereum and wraps its request()
 * method with a selectExtension flow that can throw "Unexpected error".
 * This module bypasses the wrapper by using EIP-6963 to discover the real
 * provider from each installed wallet directly.
 */

export interface WalletProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

/** Timeout (ms) for EIP-6963 provider discovery. */
const EIP6963_TIMEOUT_MS = 1500;

/**
 * Get an EVM wallet provider that the user can use to sign in.
 *
 * Priority:
 * 1. EIP-6963 – MetaMask (isMetaMask) providers
 * 2. EIP-6963 – any other real provider
 * 3. window.ethereum – if it's not a Phantom wrapper (no selectExtension)
 * 4. Phantom's selectExtension – as last resort
 */
export async function getWalletProvider(): Promise<WalletProvider> {
  // Step 1: EIP-6963 – collect real providers from all installed wallets.
  const providers = await eip6963Providers();
  const metaMask = providers.find((p) => (p as any).isMetaMask);
  if (metaMask) return metaMask;
  if (providers.length === 1) return providers[0];

  // Step 2: Fallback to window.ethereum.
  const eth = (window as unknown as Record<string, unknown>).ethereum as any;
  if (eth?.request) {
    // If selectExtension is present, it's a Phantom-style wrapper which
    // intercepts request() calls. Try to get the real provider via
    // selectExtension, or error with a helpful message.
    if (typeof eth.selectExtension !== "function") return eth as WalletProvider;
    try {
      const selected = await eth.selectExtension();
      if (selected?.request) return selected as WalletProvider;
    } catch {
      // selectExtension failed – fall through to error.
    }
  }

  throw new Error(
    "No EVM wallet found. Install MetaMask, or if you have Phantom installed, " +
    "set your default wallet in Phantom Settings → Preferences → Default App Wallet.",
  );
}

async function eip6963Providers(): Promise<WalletProvider[]> {
  return new Promise<WalletProvider[]>((resolve) => {
    const found: WalletProvider[] = [];
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      window.removeEventListener("eip6963:announceProvider", handler as any);
      resolve(found);
    };
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as any;
      if (detail?.provider?.request) {
        found.push(detail.provider as WalletProvider);
      }
    };
    window.addEventListener("eip6963:announceProvider", handler as any);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(finish, EIP6963_TIMEOUT_MS);
  });
}