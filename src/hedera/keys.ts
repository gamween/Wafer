import { PrivateKey } from "@hashgraph/sdk";

/**
 * Robustly parse a Hedera private key string in any common encoding.
 *
 * The funded testnet operator key is a **raw-hex ECDSA** key (GOAL §3), which
 * `PrivateKey.fromStringDer()` cannot read. We try ECDSA first, then fall back to
 * ED25519 and DER so the same code works no matter how a key was exported.
 *
 * Never log the input or the returned key — callers handle secrets.
 */
export function parsePrivateKey(raw: string): PrivateKey {
  const key = (raw ?? "").trim();
  if (!key) throw new Error("empty private key");

  const attempts: Array<[string, () => PrivateKey]> = [
    ["ECDSA", () => PrivateKey.fromStringECDSA(key)],
    ["ED25519", () => PrivateKey.fromStringED25519(key)],
    ["DER", () => PrivateKey.fromStringDer(key)],
  ];

  const errors: string[] = [];
  for (const [label, fn] of attempts) {
    try {
      return fn();
    } catch (e) {
      errors.push(`${label}: ${(e as Error).message}`);
    }
  }
  throw new Error(`could not parse private key (tried ECDSA/ED25519/DER) — ${errors.join("; ")}`);
}
