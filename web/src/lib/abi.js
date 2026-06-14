// Wafer contract interfaces — mirrors the DEPLOYED WaferVault.sol exactly
// (artifacts/contracts/WaferVault.sol/WaferVault.json on Hedera testnet
// 0x162e20B4...). Types match the contract so viem computes selectors and decodes
// events/structs correctly.
//
// Money: HBAR and shares are 8-dp integer units (tinybar). Settlement is native
// HBAR — deposit is `payable` (msg.value). Internal accounting is uint256
// (downcast to int64 only at HTS boundaries inside the contract). navPerShare,
// previewDeposit/Redeem, totalAssets, etc. return uint256 tinybar.
//
// enums (uint8): Category{GPU,Wireless,Mapping,Energy,Storage}
//                RiskClass{A,B,C}
//                DealStatus{Proposed,Approved,Rejected,Financed,Repaid,Defaulted}
//                ClaimStatus{Active,Repaid,Defaulted}  PoolStatus{Active,Paused}

export const VAULT_ABI = [
  // ---- Ownable2Step ----
  { name: "owner", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "pendingOwner", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "transferOwnership", type: "function", stateMutability: "nonpayable", inputs: [{ name: "newOwner", type: "address" }], outputs: [] },
  { name: "acceptOwnership", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },

  // ---- Counts ----
  { name: "poolCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { name: "dealCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "claimCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "queueLength", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "timelockDelay", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },

  // ---- Struct getters (auto-generated public mapping getters) ----
  // pools(poolId) → Pool
  {
    name: "pools", type: "function", stateMutability: "view",
    inputs: [{ name: "poolId", type: "uint32" }],
    outputs: [
      { name: "shareToken", type: "address" },
      { name: "claimNft", type: "address" },
      { name: "category", type: "uint8" },
      { name: "class", type: "uint8" },
      { name: "idleTinybar", type: "uint256" },
      { name: "receivableTinybar", type: "uint256" },
      { name: "totalShares", type: "uint256" },
      { name: "queuedShares", type: "uint256" },
      { name: "minBufferBps", type: "uint16" },
      { name: "status", type: "uint8" },
    ],
  },
  // deals(dealId) → Deal
  {
    name: "deals", type: "function", stateMutability: "view",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [
      { name: "operator", type: "address" },
      { name: "detailsHash", type: "bytes32" },
      { name: "advanceTinybar", type: "uint256" },
      { name: "expectedTinybar", type: "uint256" },
      { name: "termSeconds", type: "uint64" },
      { name: "category", type: "uint8" },
      { name: "class", type: "uint8" },
      { name: "poolId", type: "uint32" },
      { name: "deviceNft", type: "address" },
      { name: "deviceSerial", type: "int64" },
      { name: "status", type: "uint8" },
      { name: "claimId", type: "uint256" },
    ],
  },
  // claims(claimId) → Claim
  {
    name: "claims", type: "function", stateMutability: "view",
    inputs: [{ name: "claimId", type: "uint256" }],
    outputs: [
      { name: "poolId", type: "uint32" },
      { name: "operator", type: "address" },
      { name: "advanceTinybar", type: "uint256" },
      { name: "expectedTinybar", type: "uint256" },
      { name: "carryTinybar", type: "uint256" },
      { name: "settledTinybar", type: "uint256" },
      { name: "startTime", type: "uint64" },
      { name: "termSeconds", type: "uint64" },
      { name: "nftSerial", type: "int64" },
      { name: "deviceNft", type: "address" },
      { name: "deviceSerial", type: "int64" },
      { name: "status", type: "uint8" },
    ],
  },
  // redemptionQueue(requestId) → RedemptionRequest
  {
    name: "redemptionQueue", type: "function", stateMutability: "view",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [
      { name: "investor", type: "address" },
      { name: "poolId", type: "uint32" },
      { name: "assetsTinybar", type: "uint256" },
      { name: "ts", type: "uint64" },
      { name: "filled", type: "bool" },
    ],
  },
  { name: "isOperator", type: "function", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ type: "bool" }] },
  { name: "isKyced", type: "function", stateMutability: "view", inputs: [{ name: "", type: "uint32" }, { name: "", type: "address" }], outputs: [{ type: "bool" }] },
  { name: "claimSettler", type: "function", stateMutability: "view", inputs: [{ name: "", type: "uint256" }, { name: "", type: "address" }], outputs: [{ type: "bool" }] },
  { name: "pendingAfter", type: "function", stateMutability: "view", inputs: [{ name: "", type: "bytes32" }], outputs: [{ type: "uint64" }] },

  // ---- Secondary-market config (SaucerSwap V1, SPEC §10) ----
  { name: "saucerRouter", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "saucerWhbar", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "saucerFactory", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "secondaryPair", type: "function", stateMutability: "view", inputs: [{ name: "poolId", type: "uint32" }], outputs: [{ type: "address" }] },

  // ---- Derived views (all 8-dp tinybar) ----
  { name: "navPerShare", type: "function", stateMutability: "view", inputs: [{ name: "poolId", type: "uint32" }], outputs: [{ type: "uint256" }] },
  { name: "totalAssets", type: "function", stateMutability: "view", inputs: [{ name: "poolId", type: "uint32" }], outputs: [{ type: "uint256" }] },
  { name: "netAssets", type: "function", stateMutability: "view", inputs: [{ name: "poolId", type: "uint32" }], outputs: [{ type: "uint256" }] },
  { name: "liquidAssets", type: "function", stateMutability: "view", inputs: [{ name: "poolId", type: "uint32" }], outputs: [{ type: "uint256" }] },
  { name: "maxRedeem", type: "function", stateMutability: "view", inputs: [{ name: "poolId", type: "uint32" }, { name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { name: "previewDeposit", type: "function", stateMutability: "view", inputs: [{ name: "poolId", type: "uint32" }, { name: "assetsTinybar", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { name: "previewRedeem", type: "function", stateMutability: "view", inputs: [{ name: "poolId", type: "uint32" }, { name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },

  // ---- Investor writes ----
  { name: "deposit", type: "function", stateMutability: "payable", inputs: [{ name: "poolId", type: "uint32" }], outputs: [{ name: "sharesMinted", type: "uint256" }] },
  { name: "redeem", type: "function", stateMutability: "nonpayable", inputs: [{ name: "poolId", type: "uint32" }, { name: "shares", type: "uint256" }], outputs: [{ name: "filled", type: "uint256" }, { name: "queued", type: "uint256" }] },
  { name: "claimRedemption", type: "function", stateMutability: "nonpayable", inputs: [{ name: "requestId", type: "uint256" }], outputs: [] },

  // ---- Operator writes ----
  { name: "proposeDeal", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "category", type: "uint8" },
    { name: "advance", type: "uint256" },
    { name: "expected", type: "uint256" },
    { name: "term", type: "uint64" },
    { name: "detailsHash", type: "bytes32" },
    { name: "deviceNft", type: "address" },
    { name: "deviceSerial", type: "int64" },
  ], outputs: [{ name: "dealId", type: "uint256" }] },

  // ---- Admin / owner writes ----
  { name: "createPool", type: "function", stateMutability: "payable", inputs: [
    { name: "category", type: "uint8" }, { name: "riskClass", type: "uint8" },
    { name: "name", type: "string" }, { name: "symbol", type: "string" },
  ], outputs: [{ name: "poolId", type: "uint32" }, { name: "shareToken", type: "address" }, { name: "claimNft", type: "address" }] },
  { name: "approveDeal", type: "function", stateMutability: "nonpayable", inputs: [{ name: "dealId", type: "uint256" }, { name: "riskClass", type: "uint8" }, { name: "poolId", type: "uint32" }], outputs: [] },
  { name: "rejectDeal", type: "function", stateMutability: "nonpayable", inputs: [{ name: "dealId", type: "uint256" }], outputs: [] },
  { name: "financeClaim", type: "function", stateMutability: "nonpayable", inputs: [{ name: "dealId", type: "uint256" }], outputs: [{ name: "claimId", type: "uint256" }, { name: "serial", type: "int64" }] },
  { name: "markDefault", type: "function", stateMutability: "nonpayable", inputs: [{ name: "claimId", type: "uint256" }], outputs: [] },
  { name: "settleRewards", type: "function", stateMutability: "payable", inputs: [{ name: "poolId", type: "uint32" }, { name: "claimId", type: "uint256" }], outputs: [] },
  { name: "setAuthorizedSettler", type: "function", stateMutability: "nonpayable", inputs: [{ name: "claimId", type: "uint256" }, { name: "settler", type: "address" }, { name: "allowed", type: "bool" }], outputs: [] },
  { name: "registerOperator", type: "function", stateMutability: "nonpayable", inputs: [{ name: "operator", type: "address" }, { name: "allowed", type: "bool" }], outputs: [] },
  { name: "adminGrantKyc", type: "function", stateMutability: "nonpayable", inputs: [{ name: "poolId", type: "uint32" }, { name: "investor", type: "address" }], outputs: [] },
  { name: "adminRevokeKyc", type: "function", stateMutability: "nonpayable", inputs: [{ name: "poolId", type: "uint32" }, { name: "investor", type: "address" }], outputs: [] },
  { name: "pausePool", type: "function", stateMutability: "nonpayable", inputs: [{ name: "poolId", type: "uint32" }], outputs: [] },
  { name: "unpausePool", type: "function", stateMutability: "nonpayable", inputs: [{ name: "poolId", type: "uint32" }], outputs: [] },
  { name: "freeze", type: "function", stateMutability: "nonpayable", inputs: [{ name: "poolId", type: "uint32" }, { name: "account", type: "address" }], outputs: [] },
  { name: "unfreeze", type: "function", stateMutability: "nonpayable", inputs: [{ name: "poolId", type: "uint32" }, { name: "account", type: "address" }], outputs: [] },
  { name: "setMinBuffer", type: "function", stateMutability: "nonpayable", inputs: [{ name: "poolId", type: "uint32" }, { name: "bps", type: "uint16" }], outputs: [] },
  { name: "setTimelockDelay", type: "function", stateMutability: "nonpayable", inputs: [{ name: "delay", type: "uint64" }], outputs: [] },
  { name: "cancelTimelock", type: "function", stateMutability: "nonpayable", inputs: [{ name: "action", type: "bytes32" }], outputs: [] },
  { name: "setSecondaryConfig", type: "function", stateMutability: "nonpayable", inputs: [{ name: "router", type: "address" }, { name: "whbar", type: "address" }, { name: "factory", type: "address" }], outputs: [] },
  { name: "enableSecondaryMarket", type: "function", stateMutability: "payable", inputs: [
    { name: "poolId", type: "uint32" },
    { name: "shareLiquidity", type: "uint256" },
    { name: "hbarLiquidityTinybar", type: "uint256" },
    { name: "pairCreateFeeTinybar", type: "uint256" },
  ], outputs: [{ name: "pair", type: "address" }] },

  // ---- Events (read by Activity / screens via Mirror Node) ----
  { type: "event", name: "PoolCreated", inputs: [
    { name: "poolId", type: "uint32", indexed: true },
    { name: "shareToken", type: "address", indexed: false },
    { name: "claimNft", type: "address", indexed: false },
    { name: "category", type: "uint8", indexed: false },
    { name: "riskClass", type: "uint8", indexed: false },
    { name: "name", type: "string", indexed: false },
    { name: "symbol", type: "string", indexed: false },
  ] },
  { type: "event", name: "OperatorRegistered", inputs: [
    { name: "operator", type: "address", indexed: true },
    { name: "allowed", type: "bool", indexed: false },
  ] },
  { type: "event", name: "DealProposed", inputs: [
    { name: "dealId", type: "uint256", indexed: true },
    { name: "operator", type: "address", indexed: true },
    { name: "category", type: "uint8", indexed: false },
    { name: "advance", type: "uint256", indexed: false },
    { name: "expected", type: "uint256", indexed: false },
    { name: "term", type: "uint64", indexed: false },
    { name: "detailsHash", type: "bytes32", indexed: false },
    { name: "deviceNft", type: "address", indexed: false },
    { name: "deviceSerial", type: "int64", indexed: false },
  ] },
  { type: "event", name: "DealApproved", inputs: [
    { name: "dealId", type: "uint256", indexed: true },
    { name: "riskClass", type: "uint8", indexed: false },
    { name: "poolId", type: "uint32", indexed: false },
  ] },
  { type: "event", name: "DealRejected", inputs: [{ name: "dealId", type: "uint256", indexed: true }] },
  { type: "event", name: "ClaimFinanced", inputs: [
    { name: "claimId", type: "uint256", indexed: true },
    { name: "dealId", type: "uint256", indexed: true },
    { name: "poolId", type: "uint32", indexed: true },
    { name: "operator", type: "address", indexed: false },
    { name: "advance", type: "uint256", indexed: false },
    { name: "expected", type: "uint256", indexed: false },
    { name: "term", type: "uint64", indexed: false },
    { name: "serial", type: "int64", indexed: false },
    { name: "deviceNft", type: "address", indexed: false },
    { name: "deviceSerial", type: "int64", indexed: false },
  ] },
  { type: "event", name: "RewardRouted", inputs: [
    { name: "claimId", type: "uint256", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
    { name: "newCarry", type: "uint256", indexed: false },
    { name: "settled", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "ClaimRepaid", inputs: [
    { name: "claimId", type: "uint256", indexed: true },
    { name: "serial", type: "int64", indexed: false },
  ] },
  { type: "event", name: "ClaimDefaulted", inputs: [
    { name: "claimId", type: "uint256", indexed: true },
    { name: "loss", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "Deposit", inputs: [
    { name: "poolId", type: "uint32", indexed: true },
    { name: "investor", type: "address", indexed: true },
    { name: "assetsTinybar", type: "uint256", indexed: false },
    { name: "sharesMinted", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "Redeem", inputs: [
    { name: "poolId", type: "uint32", indexed: true },
    { name: "investor", type: "address", indexed: true },
    { name: "sharesBurned", type: "uint256", indexed: false },
    { name: "assetsTinybar", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "RedemptionQueued", inputs: [
    { name: "requestId", type: "uint256", indexed: true },
    { name: "investor", type: "address", indexed: true },
    { name: "poolId", type: "uint32", indexed: true },
    { name: "assetsTinybar", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "RedemptionFilled", inputs: [
    { name: "requestId", type: "uint256", indexed: true },
    { name: "investor", type: "address", indexed: true },
    { name: "assetsTinybar", type: "uint256", indexed: false },
  ] },
  { type: "event", name: "KycGranted", inputs: [
    { name: "poolId", type: "uint32", indexed: true },
    { name: "investor", type: "address", indexed: true },
  ] },
  { type: "event", name: "KycRevoked", inputs: [
    { name: "poolId", type: "uint32", indexed: true },
    { name: "investor", type: "address", indexed: true },
  ] },
  { type: "event", name: "Paused", inputs: [
    { name: "poolId", type: "uint32", indexed: true },
    { name: "paused", type: "bool", indexed: false },
  ] },
  { type: "event", name: "Frozen", inputs: [
    { name: "poolId", type: "uint32", indexed: true },
    { name: "account", type: "address", indexed: true },
    { name: "frozen", type: "bool", indexed: false },
  ] },
  { type: "event", name: "SettlerAuthorized", inputs: [
    { name: "claimId", type: "uint256", indexed: true },
    { name: "settler", type: "address", indexed: true },
    { name: "allowed", type: "bool", indexed: false },
  ] },
  { type: "event", name: "MinBufferSet", inputs: [
    { name: "poolId", type: "uint32", indexed: true },
    { name: "bps", type: "uint16", indexed: false },
  ] },
  { type: "event", name: "ActionQueued", inputs: [
    { name: "actionHash", type: "bytes32", indexed: true },
    { name: "executeAfter", type: "uint64", indexed: false },
  ] },
  { type: "event", name: "TimelockDelaySet", inputs: [{ name: "delay", type: "uint64", indexed: false }] },
  { type: "event", name: "SecondaryConfigSet", inputs: [
    { name: "router", type: "address", indexed: false },
    { name: "whbar", type: "address", indexed: false },
    { name: "factory", type: "address", indexed: false },
  ] },
  { type: "event", name: "SecondaryMarketEnabled", inputs: [
    { name: "poolId", type: "uint32", indexed: true },
    { name: "pair", type: "address", indexed: false },
    { name: "shareLiquidity", type: "uint256", indexed: false },
    { name: "hbarLiquidity", type: "uint256", indexed: false },
  ] },
];

// HTS ERC-20 facade — every HTS fungible token EVM address answers the standard
// ERC-20 read/write selectors (HIP-376). The vault's redeem() pulls shares from
// the investor, so the front approve(vault, shares) on the SHARE TOKEN'S own EVM
// address before redeeming. balanceOf/allowance/decimals are reads. (8-dp shares.)
export const HTS_ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

// IHRC719 association facade — every HTS token EVM address exposes these. An
// account must associate a token before it can hold it.
export const IHRC719_ABI = [
  { name: "associate", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [{ name: "responseCode", type: "int64" }] },
  { name: "dissociate", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [{ name: "responseCode", type: "int64" }] },
  { name: "isAssociated", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
];

// MockDeviceNFT helper (operator collateral). createCollection (once) → mintTo
// (operator gets a device serial) → operator approve(vault, serial) on the
// collection's ERC-721 facade → vault.financeClaim pulls it into escrow.
export const DEVICE_NFT_ABI = [
  { name: "createCollection", type: "function", stateMutability: "payable", inputs: [{ name: "name", type: "string" }, { name: "symbol", type: "string" }], outputs: [{ name: "created", type: "address" }] },
  { name: "mintTo", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "metaHash", type: "bytes32" }], outputs: [{ name: "serial", type: "int64" }] },
  { name: "token", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "minted", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { name: "deployer", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  // DeviceMinted carries the authoritative serial for THIS mint (parse it, don't trust minted()).
  { type: "event", name: "DeviceMinted", inputs: [
    { name: "to", type: "address", indexed: true },
    { name: "serial", type: "int64", indexed: false },
    { name: "metaHash", type: "bytes32", indexed: false },
  ] },
];

// HTS ERC-721 facade — used to approve(vault, serial) on the device NFT collection
// so the vault can pull it on finance.
export const HTS_ERC721_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "tokenId", type: "uint256" }], outputs: [] },
  { name: "getApproved", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { name: "ownerOf", type: "function", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { name: "setApprovalForAll", type: "function", stateMutability: "nonpayable", inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }], outputs: [] },
];

// SaucerSwap V1 RouterV3 (testnet 0x...4b40) — HBAR-paired liquidity (SPEC §10).
// addLiquidityETHNewPool is payable; router wraps HBAR→WHBAR internally.
// swapExactETHForTokens (WHBAR→share) is payable; the in-app buy on the Secondary
// screen uses the [WHBAR, share] path. getAmountsOut quotes the share output for a
// given HBAR input from the live reserves. swapExactTokensForTokens (share→WHBAR)
// needs an ERC-20 approve(router, shareIn) on the share token first.
export const SAUCER_ROUTER_ABI = [
  { name: "addLiquidityETHNewPool", type: "function", stateMutability: "payable", inputs: [
    { name: "token", type: "address" },
    { name: "amountTokenDesired", type: "uint256" },
    { name: "amountTokenMin", type: "uint256" },
    { name: "amountETHMin", type: "uint256" },
    { name: "to", type: "address" },
    { name: "deadline", type: "uint256" },
  ], outputs: [{ name: "amountToken", type: "uint256" }, { name: "amountETH", type: "uint256" }, { name: "liquidity", type: "uint256" }] },
  { name: "swapExactETHForTokens", type: "function", stateMutability: "payable", inputs: [
    { name: "amountOutMin", type: "uint256" },
    { name: "path", type: "address[]" },
    { name: "to", type: "address" },
    { name: "deadline", type: "uint256" },
  ], outputs: [{ name: "amounts", type: "uint256[]" }] },
  { name: "swapExactTokensForTokens", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "amountIn", type: "uint256" },
    { name: "amountOutMin", type: "uint256" },
    { name: "path", type: "address[]" },
    { name: "to", type: "address" },
    { name: "deadline", type: "uint256" },
  ], outputs: [{ name: "amounts", type: "uint256[]" }] },
  { name: "getAmountsOut", type: "function", stateMutability: "view", inputs: [
    { name: "amountIn", type: "uint256" },
    { name: "path", type: "address[]" },
  ], outputs: [{ name: "amounts", type: "uint256[]" }] },
];

// SaucerSwap Factory — pairCreateFee (tinycents) + getPair lookup post-create.
export const SAUCER_FACTORY_ABI = [
  { name: "pairCreateFee", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "getPair", type: "function", stateMutability: "view", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }], outputs: [{ type: "address" }] },
];

// SaucerSwap V1 pair (UniswapV2-style). getReserves() returns the live reserves in
// token0/token1 order (token0/token1 are address-sorted); the front reads token0()
// to map (reserve0, reserve1) → (share, WHBAR) and derive the price. Reserves are in
// each token's native units: shares are 8dp (tinybar-style), WHBAR is 8dp on Hedera.
export const SAUCER_PAIR_ABI = [
  { name: "getReserves", type: "function", stateMutability: "view", inputs: [], outputs: [
    { name: "reserve0", type: "uint112" },
    { name: "reserve1", type: "uint112" },
    { name: "blockTimestampLast", type: "uint32" },
  ] },
  { name: "token0", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "token1", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];
