# Wafer — One-pager (Hedera)

> InfraFi liquidity for DePIN, on Hedera. HTS-native, zero Solidity.
> Track: Hedera — Tokenization ($3,000), plus No Solidity and (stretch) AI & Agentic Payments.

### The product

DePIN operators (compute and GPU, wireless, mapping, sensors, energy) must spend on hardware
today to earn on-chain rewards tomorrow. Wafer closes that cash-flow gap: an operator sells a
share of its future rewards for immediate liquidity, and investors hold tokenized exposure to a
basket of reward streams, tradable at any time. This is "InfraFi" — financing decentralized
physical infrastructure with its own on-chain revenue.

Example: a GPU operator expects about 10,000 USDC of rewards over 90 days. It receives 9,000
USDC today to deploy more hardware. Over the term, its rewards (10,000 USDC) flow into the
vault; the 1,000 USDC spread (about 11% over three months, illustrative) is the yield, shared
across pool holders.

### The architecture decision

One token per device would mean a thousand markets for a thousand devices: fragmented
liquidity, an unusable secondary market. Instead, reward streams are grouped into standardized
pools by network / category and risk class, and each pool issues a single fungible token. The
investor buys a share of a legible basket — network, risk — not a single device. The result
behaves like a tokenized short-term infrastructure-income fund.

Pools: e.g. GPU-A, WIFI-B, ENERGY-A (category + risk class). Maturity stays a property of each
claim (NFT) inside the vault, not a pool-splitting axis — the vault is permanent and never
closes.

### Lifecycle

1. An operator (or a fleet aggregator) requests financing against its future rewards.
2. The protocol assesses the claim (network, the device's reward history, uptime, credit risk).
3. The reward claim is tokenized as an HTS NFT (metadata: network, expected rewards, term,
   score, status). The NFT stays in the vault; it is not for investors.
4. The NFT is deposited into the matching vault (e.g. GPU-A), which advances liquidity (9,000
   USDC) to the operator.
5. The operator routes its on-chain rewards to the vault for the financing term.
6. The vault mints HTS fungible shares, which investors buy.
7. Shares trade on SaucerSwap against USDC (GPU-A / USDC pool).
8. As rewards arrive, the vault's net asset value (NAV) rises; when a claim reaches its term the
   NFT moves to Settled (or is burned) and is replaced by a new one.
9. Exit: the investor sells shares on SaucerSwap, or redeems them against the vault at NAV
   (their own shares are burned, their pro-rata USDC is paid out). The pool itself is permanent.

### Hedera stack

- HTS non-fungible token (NFT): a device's or fleet's reward claim, held in custody by the
  vault.
- HTS fungible token: the pool shares (GPU-A, WIFI-B, ENERGY-A), transferable and tradable.
- HTS KYC and freeze keys: token-level access control and compliance.
- HTS custom fees: a low protocol fee, kept off per-transfer where possible.
- HCS (Consensus Service): an immutable audit trail — NAV published periodically + lifecycle
  events.
- Scheduled Transactions (HIP-423): optional set-and-forget reward sweeps.
- Mirror Node REST: the read layer; the frontend recomputes NAV independently.

The entire product runs on native Hedera services driven by the JavaScript/TypeScript SDK, with
no Solidity contract.

### Settlement

DePIN rewards are paid on-chain in USDC. The operator routes its rewards to the vault for the
financing term; each payment updates the NAV. When a claim reaches its term the NFT is Settled.
On underperformance or if routing stops (default), the NFT moves to Defaulted, NAV drops and the
loss is borne by the vault, spread across all holders. No fiat bridge: the entire cash flow is
natively on-chain.

### Why Hedera

HTS provides native tokens (NFTs and fungibles) with built-in compliance controls (KYC,
freeze), low fees and fast finality — useful for an instrument whose NAV is updated
continuously by small reward payments. DePIN and real-world asset tokenization are a stated
focus for Hedera in 2026.
