import { useCallback, useMemo } from "react";
import { getContract, keccak256, toBytes, decodeEventLog, encodeAbiParameters } from "viem";
import {
  VAULT_ABI, IHRC719_ABI, HTS_ERC20_ABI, HTS_ERC721_ABI, DEVICE_NFT_ABI, SAUCER_FACTORY_ABI,
  SAUCER_PAIR_ABI, SAUCER_ROUTER_ABI,
} from "../lib/abi.js";
import { ADDRESSES, VAULT_CONFIGURED, ZERO_ADDRESS, MIRROR_NODE_URL } from "../lib/config.js";
import { ONE } from "../lib/format.js";

// Gas tuning. The Hedera testnet (Hashio) relay underestimates maxFeePerGas: it
// caches a baseFee a few blocks back and rejects with "max fee per gas less than
// block base fee". We read the live baseFee and pad it 5x + a small priority tip.
// Over-paying costs a fraction of a cent; under-paying blocks the tx.
const GAS_BASEFEE_MULTIPLIER = 5n;
const GAS_PRIORITY_FEE_WEI = 100_000_000n; // 0.1 gwei

// HTS-touching single-op calls (associate / approve / deposit / redeem) need a
// pinned gasLimit because Hashio mis-estimates precompile calls. ~1M is the floor
// for HTS transfer/mint/burn paths.
const HTS_GAS = 1_200_000n;
// Multi-HTS-op calls (financeClaim / settleRewards / markDefault: associate +
// transferNFT + mint/burn + HBAR pay) exhaust the 1.2M pin — pin them to 4M.
const HTS_GAS_HEAVY = 4_000_000n;
// createPool does 2 HTS token creates + dead-share seed — needs a big pin.
const HTS_GAS_CREATE = 10_000_000n;

// EVM <-> Hedera HBAR conversion: the contract accounts in tinybar (8 dp) but
// msg.value / eth_getBalance are in weibar (18 dp). 1 tinybar = 1e10 weibar.
const WEIBAR_PER_TINYBAR = 10_000_000_000n;

const isAddr = (a) => a && a !== ZERO_ADDRESS && /^0x[0-9a-fA-F]{40}$/.test(a);

export function useContracts(walletClient, publicClient, account) {
  // ---- viem contract wrappers ----
  const vaultContract = useCallback((readonly = false) => {
    if (!VAULT_CONFIGURED || !publicClient) return null;
    if (!readonly && !walletClient) return null;
    return getContract({
      address: ADDRESSES.vault,
      abi: VAULT_ABI,
      client: readonly ? { public: publicClient } : { public: publicClient, wallet: walletClient },
    });
  }, [walletClient, publicClient]);

  const hrc719Contract = useCallback((tokenAddr) => {
    if (!walletClient || !publicClient) return null;
    return getContract({ address: tokenAddr, abi: IHRC719_ABI, client: { public: publicClient, wallet: walletClient } });
  }, [walletClient, publicClient]);

  const htsErc20Contract = useCallback((tokenAddr, readonly = false) => {
    if (!publicClient) return null;
    if (!readonly && !walletClient) return null;
    return getContract({
      address: tokenAddr, abi: HTS_ERC20_ABI,
      client: readonly ? { public: publicClient } : { public: publicClient, wallet: walletClient },
    });
  }, [walletClient, publicClient]);

  // ---- gas + tx helpers ----
  const getGasOverrides = useCallback(async (gasLimit) => {
    const overrides = {};
    if (gasLimit) overrides.gas = gasLimit;
    if (!publicClient) return overrides;
    try {
      let baseFee;
      try {
        const block = await publicClient.getBlock({ blockTag: "latest" });
        baseFee = block?.baseFeePerGas;
      } catch {}
      if (!baseFee || baseFee === 0n) {
        try { baseFee = await publicClient.getGasPrice(); } catch {}
      }
      if (baseFee && baseFee > 0n) {
        overrides.maxPriorityFeePerGas = GAS_PRIORITY_FEE_WEI;
        overrides.maxFeePerGas = baseFee * GAS_BASEFEE_MULTIPLIER + GAS_PRIORITY_FEE_WEI;
      }
    } catch {
      // Fall through with whatever overrides we have.
    }
    return overrides;
  }, [publicClient]);

  // Throw on revert — viem's waitForTransactionReceipt resolves regardless of
  // execution status. Re-simulate on revert to surface the on-chain reason.
  const waitTx = useCallback(async (hash, simContext) => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "success") return receipt;
    let detail = "";
    if (simContext) {
      try {
        await publicClient.simulateContract({ ...simContext, account });
      } catch (simErr) {
        const reason = simErr?.shortMessage ?? simErr?.cause?.shortMessage ?? simErr?.message?.split("\n")[0] ?? "";
        if (reason) detail = ` — ${reason.slice(0, 200)}`;
      }
    }
    throw new Error(`Transaction reverted on-chain (tx ${hash.slice(0, 10)}…)${detail}`);
  }, [publicClient, account]);

  const assertAccountSync = useCallback(async () => {
    if (!account || typeof window === "undefined" || !window.ethereum) return;
    try {
      const live = (await window.ethereum.request({ method: "eth_accounts" }))?.[0];
      if (live && live.toLowerCase() !== account.toLowerCase()) {
        throw new Error("MetaMask account changed since this page loaded. Refresh and reconnect to the account you want to use.");
      }
    } catch (e) {
      if (e?.message?.startsWith("MetaMask account")) throw e;
    }
  }, [account]);

  // Generic owner/operator write helper: simulate-free, gas-pinned, revert-aware.
  const writeVault = useCallback(async (functionName, args, { gas = HTS_GAS, value } = {}) => {
    await assertAccountSync();
    const vault = vaultContract();
    if (!vault) throw new Error("Wallet not connected — please connect first.");
    const overrides = await getGasOverrides(gas);
    if (value != null) overrides.value = value;
    const hash = await vault.write[functionName](args, overrides);
    await waitTx(hash, { address: ADDRESSES.vault, abi: VAULT_ABI, functionName, args, ...(value != null ? { value } : {}) });
    return hash;
  }, [vaultContract, getGasOverrides, waitTx, assertAccountSync]);

  // ---- POOL READS ----
  const getPools = useCallback(async () => {
    const vault = vaultContract(true);
    if (!vault) return [];
    try {
      const count = Number(await vault.read.poolCount());
      const ids = Array.from({ length: count }, (_, i) => i);
      return await Promise.all(ids.map(async (poolId) => {
        const [pool, nav, ta, liquid] = await Promise.all([
          vault.read.pools([poolId]),
          vault.read.navPerShare([poolId]).catch(() => ONE),
          vault.read.totalAssets([poolId]).catch(() => 0n),
          vault.read.liquidAssets([poolId]).catch(() => 0n),
        ]);
        // Pool → (shareToken, claimNft, category, class, idle, receivable,
        //         totalShares, queuedShares, minBufferBps, status)
        const [shareToken, claimNft, category, riskClass, idle, receivable, totalShares, queuedShares, minBufferBps, status] = pool;
        return {
          poolId,
          shareToken,
          claimNft,
          category: Number(category),
          class: Number(riskClass),
          idle: BigInt(idle),
          receivable: BigInt(receivable),
          totalShares: BigInt(totalShares),
          queuedShares: BigInt(queuedShares),
          minBufferBps: Number(minBufferBps),
          status: Number(status),
          navPerShare: BigInt(nav),
          totalAssets: BigInt(ta),
          liquidAssets: BigInt(liquid),
        };
      }));
    } catch {
      return [];
    }
  }, [vaultContract]);

  const getNavPerShare = useCallback(async (poolId) => {
    const vault = vaultContract(true);
    if (!vault) return ONE;
    try { return BigInt(await vault.read.navPerShare([poolId])); } catch { return ONE; }
  }, [vaultContract]);

  const getMaxRedeem = useCallback(async (poolId, shares) => {
    const vault = vaultContract(true);
    if (!vault) return 0n;
    try { return BigInt(await vault.read.maxRedeem([poolId, BigInt(shares)])); } catch { return 0n; }
  }, [vaultContract]);

  // Share balance from the pool's share-token ERC-20 facade (no vault view).
  const getShareBalance = useCallback(async (shareToken) => {
    if (!account || !isAddr(shareToken)) return null;
    const token = htsErc20Contract(shareToken, true);
    if (!token) return null;
    try { return BigInt(await token.read.balanceOf([account])); } catch { return null; }
  }, [htsErc20Contract, account]);

  const getHbarBalance = useCallback(async () => {
    if (!account || !publicClient) return null;
    try {
      const weibar = await publicClient.getBalance({ address: account });
      return weibar / WEIBAR_PER_TINYBAR;
    } catch { return null; }
  }, [publicClient, account]);

  // KYC + association status for a pool's share token (D2 allowlist surfacing).
  const getKycStatus = useCallback(async (poolId, shareToken) => {
    if (!account) return { associated: false, kycGranted: false };
    const vault = vaultContract(true);
    let kycGranted = false;
    if (vault) {
      try { kycGranted = await vault.read.isKyced([poolId, account]); } catch {}
    }
    let associated = false;
    if (isAddr(shareToken)) {
      const token = hrc719Contract(shareToken);
      if (token) { try { associated = await token.read.isAssociated(); } catch {} }
    }
    return { associated, kycGranted };
  }, [vaultContract, hrc719Contract, account]);

  // ---- DEALS / CLAIMS READS ----
  const getDeals = useCallback(async () => {
    const vault = vaultContract(true);
    if (!vault) return [];
    try {
      const count = Number(await vault.read.dealCount());
      const ids = Array.from({ length: count }, (_, i) => i); // dealIds are 0-based (dealId = dealCount++)
      return await Promise.all(ids.map(async (dealId) => {
        const d = await vault.read.deals([BigInt(dealId)]);
        // (operator, detailsHash, advance, expected, term, category, class,
        //  poolId, deviceNft, deviceSerial, status, claimId)
        return {
          dealId,
          operator: d[0],
          detailsHash: d[1],
          advance: BigInt(d[2]),
          expected: BigInt(d[3]),
          term: BigInt(d[4]),
          category: Number(d[5]),
          class: Number(d[6]),
          poolId: Number(d[7]),
          deviceNft: d[8],
          deviceSerial: BigInt(d[9]),
          status: Number(d[10]),
          claimId: BigInt(d[11]),
        };
      }));
    } catch { return []; }
  }, [vaultContract]);

  const getClaims = useCallback(async () => {
    const vault = vaultContract(true);
    if (!vault) return [];
    try {
      const count = Number(await vault.read.claimCount());
      const ids = Array.from({ length: count }, (_, i) => i); // claimIds are 0-based (claimId = claimCount++)
      return await Promise.all(ids.map(async (claimId) => {
        const c = await vault.read.claims([BigInt(claimId)]);
        // (poolId, operator, advance, expected, carry, settled, startTime, term,
        //  nftSerial, deviceNft, deviceSerial, status)
        return {
          claimId,
          poolId: Number(c[0]),
          operator: c[1],
          advance: BigInt(c[2]),
          expected: BigInt(c[3]),
          carry: BigInt(c[4]),
          settled: BigInt(c[5]),
          startTime: BigInt(c[6]),
          term: BigInt(c[7]),
          nftSerial: BigInt(c[8]),
          deviceNft: c[9],
          deviceSerial: BigInt(c[10]),
          status: Number(c[11]),
        };
      }));
    } catch { return []; }
  }, [vaultContract]);

  // Redemption queue (all requests; screens filter by investor).
  const getRedemptionQueue = useCallback(async () => {
    const vault = vaultContract(true);
    if (!vault) return [];
    try {
      const len = Number(await vault.read.queueLength());
      const ids = Array.from({ length: len }, (_, i) => i);
      return await Promise.all(ids.map(async (requestId) => {
        const q = await vault.read.redemptionQueue([BigInt(requestId)]);
        // (investor, poolId, assetsTinybar, ts, filled)
        return {
          requestId,
          investor: q[0],
          poolId: Number(q[1]),
          assets: BigInt(q[2]),
          ts: BigInt(q[3]),
          filled: q[4],
        };
      }));
    } catch { return []; }
  }, [vaultContract]);

  // Owner / operator role flags for the connected account.
  const getRoles = useCallback(async () => {
    const vault = vaultContract(true);
    if (!vault || !account) return { isOwner: false, isOperator: false };
    try {
      const [owner, isOp] = await Promise.all([
        vault.read.owner().catch(() => ZERO_ADDRESS),
        vault.read.isOperator([account]).catch(() => false),
      ]);
      return {
        isOwner: owner?.toLowerCase?.() === account.toLowerCase(),
        isOperator: !!isOp,
        owner,
      };
    } catch { return { isOwner: false, isOperator: false }; }
  }, [vaultContract, account]);

  const getTimelockDelay = useCallback(async () => {
    const vault = vaultContract(true);
    if (!vault) return 0n;
    try { return BigInt(await vault.read.timelockDelay()); } catch { return 0n; }
  }, [vaultContract]);

  // ---- ASSOCIATION / ALLOWANCE prerequisites ----
  const ensureAssociated = useCallback(async (tokenAddr) => {
    if (!isAddr(tokenAddr)) return;
    await assertAccountSync();
    const token = hrc719Contract(tokenAddr);
    if (!token) throw new Error("Wallet not connected — please connect first.");
    try { if (await token.read.isAssociated()) return; } catch {}
    const overrides = await getGasOverrides(HTS_GAS);
    const hash = await token.write.associate(overrides);
    await waitTx(hash, { address: tokenAddr, abi: IHRC719_ABI, functionName: "associate", args: [] });
  }, [hrc719Contract, getGasOverrides, waitTx, assertAccountSync]);

  const ensureShareAllowance = useCallback(async (shareToken, shares) => {
    if (!isAddr(shareToken)) throw new Error("Share token address unavailable — reload the pool and retry.");
    await assertAccountSync();
    const amount = BigInt(shares);
    const tokenRead = htsErc20Contract(shareToken, true);
    try {
      const current = await tokenRead.read.allowance([account, ADDRESSES.vault]);
      if (BigInt(current) >= amount) return;
    } catch {}
    const token = htsErc20Contract(shareToken);
    if (!token) throw new Error("Wallet not connected — please connect first.");
    const overrides = await getGasOverrides(HTS_GAS);
    const hash = await token.write.approve([ADDRESSES.vault, amount], overrides);
    await waitTx(hash, { address: shareToken, abi: HTS_ERC20_ABI, functionName: "approve", args: [ADDRESSES.vault, amount] });
  }, [htsErc20Contract, getGasOverrides, waitTx, assertAccountSync, account]);

  // ---- INVESTOR: deposit / redeem / claimRedemption ----
  const deposit = useCallback(async (poolId, assets, shareToken) => {
    await assertAccountSync();
    const tinybar = BigInt(assets);
    if (tinybar <= 0n) throw new Error("Amount must be greater than 0.");
    if (isAddr(shareToken)) await ensureAssociated(shareToken);
    const value = tinybar * WEIBAR_PER_TINYBAR;
    return writeVault("deposit", [poolId], { gas: HTS_GAS, value });
  }, [writeVault, ensureAssociated, assertAccountSync]);

  const redeem = useCallback(async (poolId, shares, shareToken) => {
    await assertAccountSync();
    const amount = BigInt(shares);
    if (amount <= 0n) throw new Error("Amount must be greater than 0.");
    const token = isAddr(shareToken) ? shareToken : ADDRESSES.shareToken;
    await ensureShareAllowance(token, amount);
    return writeVault("redeem", [poolId, amount], { gas: HTS_GAS });
  }, [writeVault, ensureShareAllowance, assertAccountSync]);

  const claimRedemption = useCallback(async (requestId) =>
    writeVault("claimRedemption", [BigInt(requestId)], { gas: HTS_GAS }),
  [writeVault]);

  // ---- OPERATOR: device-NFT mint + escrow approve + proposeDeal ----
  // Mint a collateral device NFT to the operator via MockDeviceNFT, returning the
  // new serial. metaHash defaults to a keccak of the device label.
  const mintDeviceNft = useCallback(async (label) => {
    await assertAccountSync();
    if (!isAddr(ADDRESSES.deviceNft)) throw new Error("Device-NFT helper not configured.");
    const device = getContract({ address: ADDRESSES.deviceNft, abi: DEVICE_NFT_ABI, client: { public: publicClient, wallet: walletClient } });
    const collection = await device.read.token();
    // Operator must be associated with the device collection to receive the serial.
    if (isAddr(collection)) await ensureAssociated(collection);
    const metaHash = keccak256(toBytes(label || `device-${Date.now()}`));
    const overrides = await getGasOverrides(HTS_GAS_HEAVY);
    const hash = await device.write.mintTo([account, metaHash], overrides);
    const receipt = await waitTx(hash, { address: ADDRESSES.deviceNft, abi: DEVICE_NFT_ABI, functionName: "mintTo", args: [account, metaHash] });
    // Parse the AUTHORITATIVE serial from the DeviceMinted event in THIS tx's receipt — not the
    // global minted() counter (which is race-prone: a concurrent mint would skew it and the wrong
    // serial would be escrowed / financed). Fall back to minted() only if the event is absent.
    let serial = 0n;
    const devAddrLc = ADDRESSES.deviceNft.toLowerCase();
    for (const log of receipt?.logs ?? []) {
      if (log.address?.toLowerCase?.() !== devAddrLc) continue;
      try {
        const parsed = decodeEventLog({ abi: DEVICE_NFT_ABI, data: log.data, topics: log.topics });
        if (parsed.eventName === "DeviceMinted") { serial = BigInt(parsed.args.serial); break; }
      } catch { /* not our event */ }
    }
    if (serial === 0n) {
      try { serial = BigInt(await device.read.minted()); } catch {}
    }
    return { serial, collection, txHash: hash, receipt };
  }, [publicClient, walletClient, getGasOverrides, waitTx, ensureAssociated, assertAccountSync, account]);

  // Approve the vault to pull a device serial (ERC-721 facade on the collection).
  const approveDeviceEscrow = useCallback(async (collection, serial) => {
    await assertAccountSync();
    if (!isAddr(collection)) throw new Error("Device collection address unavailable.");
    const c = getContract({ address: collection, abi: HTS_ERC721_ABI, client: { public: publicClient, wallet: walletClient } });
    const overrides = await getGasOverrides(HTS_GAS);
    const hash = await c.write.approve([ADDRESSES.vault, BigInt(serial)], overrides);
    await waitTx(hash, { address: collection, abi: HTS_ERC721_ABI, functionName: "approve", args: [ADDRESSES.vault, BigInt(serial)] });
    return hash;
  }, [publicClient, walletClient, getGasOverrides, waitTx, assertAccountSync]);

  // proposeDeal(category, advance, expected, term, detailsHash, deviceNft, deviceSerial)
  // detailsHash = keccak256 of the canonical deal JSON (company/description/...).
  const proposeDeal = useCallback(async ({ category, advance, expected, term, details, deviceNft, deviceSerial }) => {
    await assertAccountSync();
    const detailsHash = keccak256(toBytes(typeof details === "string" ? details : JSON.stringify(details ?? {})));
    const args = [
      Number(category),
      BigInt(advance),
      BigInt(expected),
      BigInt(term),
      detailsHash,
      isAddr(deviceNft) ? deviceNft : ZERO_ADDRESS,
      BigInt(deviceSerial ?? 0),
    ];
    return writeVault("proposeDeal", args, { gas: HTS_GAS });
  }, [writeVault, assertAccountSync]);

  // ---- ADMIN / OWNER ----
  const createPool = useCallback(async ({ category, riskClass, name, symbol, valueWeibar }) => {
    return writeVault("createPool", [Number(category), Number(riskClass), name, symbol], {
      gas: HTS_GAS_CREATE,
      value: valueWeibar != null ? BigInt(valueWeibar) : undefined,
    });
  }, [writeVault]);

  const approveDeal = useCallback(async (dealId, riskClass, poolId) =>
    writeVault("approveDeal", [BigInt(dealId), Number(riskClass), Number(poolId)], { gas: HTS_GAS }),
  [writeVault]);

  const rejectDeal = useCallback(async (dealId) =>
    writeVault("rejectDeal", [BigInt(dealId)], { gas: HTS_GAS }),
  [writeVault]);

  // financeClaim is timelocked + multi-HTS-op → heavy gas.
  const financeClaim = useCallback(async (dealId) =>
    writeVault("financeClaim", [BigInt(dealId)], { gas: HTS_GAS_HEAVY }),
  [writeVault]);

  const markDefault = useCallback(async (claimId) =>
    writeVault("markDefault", [BigInt(claimId)], { gas: HTS_GAS_HEAVY }),
  [writeVault]);

  const settleRewards = useCallback(async (poolId, claimId, assetsTinybar) =>
    writeVault("settleRewards", [Number(poolId), BigInt(claimId)], {
      gas: HTS_GAS_HEAVY,
      value: BigInt(assetsTinybar) * WEIBAR_PER_TINYBAR,
    }),
  [writeVault]);

  const registerOperator = useCallback(async (operator, allowed) =>
    writeVault("registerOperator", [operator, !!allowed], { gas: HTS_GAS }),
  [writeVault]);

  const setAuthorizedSettler = useCallback(async (claimId, settler, allowed) =>
    writeVault("setAuthorizedSettler", [BigInt(claimId), settler, !!allowed], { gas: HTS_GAS }),
  [writeVault]);

  const adminGrantKyc = useCallback(async (poolId, investor) =>
    writeVault("adminGrantKyc", [Number(poolId), investor], { gas: HTS_GAS }),
  [writeVault]);

  const adminRevokeKyc = useCallback(async (poolId, investor) =>
    writeVault("adminRevokeKyc", [Number(poolId), investor], { gas: HTS_GAS }),
  [writeVault]);

  const pausePool = useCallback(async (poolId) => writeVault("pausePool", [Number(poolId)], { gas: HTS_GAS }), [writeVault]);
  const unpausePool = useCallback(async (poolId) => writeVault("unpausePool", [Number(poolId)], { gas: HTS_GAS }), [writeVault]);
  const freeze = useCallback(async (poolId, account_) => writeVault("freeze", [Number(poolId), account_], { gas: HTS_GAS }), [writeVault]);
  const unfreeze = useCallback(async (poolId, account_) => writeVault("unfreeze", [Number(poolId), account_], { gas: HTS_GAS }), [writeVault]);
  const setMinBuffer = useCallback(async (poolId, bps) => writeVault("setMinBuffer", [Number(poolId), Number(bps)], { gas: HTS_GAS }), [writeVault]);
  const setTimelockDelay = useCallback(async (delay) => writeVault("setTimelockDelay", [BigInt(delay)], { gas: HTS_GAS }), [writeVault]);

  // Owner-side helper to whitelist (KYC-grant) any address (e.g. an allowlisted
  // LP counterparty) for a pool's share token. Implemented as adminGrantKyc.
  const grantKycToAddress = useCallback(async (poolId, addr) =>
    writeVault("adminGrantKyc", [Number(poolId), addr], { gas: HTS_GAS }),
  [writeVault]);

  // ---- SECONDARY MARKET (SaucerSwap V1, SPEC §10, D4) ----
  // Read the on-chain SaucerSwap config + a pool's created pair (0x0 until enabled).
  const getSecondaryConfig = useCallback(async () => {
    const vault = vaultContract(true);
    if (!vault) return { router: ZERO_ADDRESS, whbar: ZERO_ADDRESS, factory: ZERO_ADDRESS };
    try {
      const [router, whbar, factory] = await Promise.all([
        vault.read.saucerRouter().catch(() => ZERO_ADDRESS),
        vault.read.saucerWhbar().catch(() => ZERO_ADDRESS),
        vault.read.saucerFactory().catch(() => ZERO_ADDRESS),
      ]);
      return { router, whbar, factory };
    } catch { return { router: ZERO_ADDRESS, whbar: ZERO_ADDRESS, factory: ZERO_ADDRESS }; }
  }, [vaultContract]);

  const getSecondaryPair = useCallback(async (poolId) => {
    const vault = vaultContract(true);
    if (!vault) return ZERO_ADDRESS;
    try { return await vault.read.secondaryPair([Number(poolId)]); } catch { return ZERO_ADDRESS; }
  }, [vaultContract]);

  // Owner: wire the SaucerSwap addresses on-chain (one-time, post-deploy).
  const setSecondaryConfig = useCallback(async (router, whbar, factory) =>
    writeVault("setSecondaryConfig", [router, whbar, factory], { gas: HTS_GAS }),
  [writeVault]);

  // Owner: stand up the share/WHBAR market in ONE call — KYC-grant router, create the
  // pair + seed liquidity at NAV, read the new pair, KYC-grant it (SPEC §10 steps 1-4).
  // The pair-create fee is read live from the factory (tinycents) and converted to tinybar
  // via the Mirror Node exchange rate (+buffer); never hardcoded.
  const enableSecondaryMarket = useCallback(async ({ poolId, shareLiquidity8dp, hbarLiquidityTinybar, pairCreateFeeTinybar }) => {
    const fee = BigInt(pairCreateFeeTinybar);
    const hbarLiq = BigInt(hbarLiquidityTinybar);
    const valueTinybar = fee + hbarLiq;
    return writeVault(
      "enableSecondaryMarket",
      [Number(poolId), BigInt(shareLiquidity8dp), hbarLiq, fee],
      { gas: HTS_GAS_CREATE, value: valueTinybar * WEIBAR_PER_TINYBAR },
    );
  }, [writeVault]);

  // Read the live SaucerSwap pair-create fee (tinycents) and convert to tinybar via the Mirror
  // Node exchange rate (+ buffer). SPEC §10: never hardcode the HBAR fee.
  const getPairCreateFeeTinybar = useCallback(async (factoryAddr, buffer = 115n) => {
    if (!publicClient || !isAddr(factoryAddr)) return 0n;
    try {
      const factory = getContract({ address: factoryAddr, abi: SAUCER_FACTORY_ABI, client: { public: publicClient } });
      const tinycents = BigInt(await factory.read.pairCreateFee());
      // Mirror Node current rate: cent_equivalent / hbar_equivalent.
      const res = await fetch(`${MIRROR_NODE_URL}/api/v1/network/exchangerate`);
      const data = await res.json();
      const rate = data?.current_rate;
      const centEq = BigInt(rate?.cent_equivalent ?? 0);
      const hbarEq = BigInt(rate?.hbar_equivalent ?? 0);
      if (centEq === 0n) return 0n;
      // tinycents -> tinybar: tinybar = tinycents * hbar_equivalent / cent_equivalent.
      const tinybar = (tinycents * hbarEq) / centEq;
      return (tinybar * buffer) / 100n; // +buffer% headroom for rate drift
    } catch { return 0n; }
  }, [publicClient]);

  // Read a SaucerSwap pair's live reserves and map them to (share, WHBAR) using
  // token0(). Returns { reserveShare, reserveWhbar, token0, blockTs } in raw units
  // (shares 8dp, WHBAR 8dp on Hedera). Null on any read failure.
  const getPairReserves = useCallback(async (pairAddr, shareToken) => {
    if (!publicClient || !isAddr(pairAddr)) return null;
    try {
      const pair = getContract({ address: pairAddr, abi: SAUCER_PAIR_ABI, client: { public: publicClient } });
      const [reserves, token0] = await Promise.all([
        pair.read.getReserves(),
        pair.read.token0().catch(() => ZERO_ADDRESS),
      ]);
      const r0 = BigInt(reserves[0]);
      const r1 = BigInt(reserves[1]);
      const blockTs = BigInt(reserves[2]);
      const shareIsToken0 = isAddr(shareToken) && token0?.toLowerCase?.() === shareToken.toLowerCase();
      return {
        token0,
        reserveShare: shareIsToken0 ? r0 : r1,
        reserveWhbar: shareIsToken0 ? r1 : r0,
        blockTs,
      };
    } catch { return null; }
  }, [publicClient]);

  // Quote share output for a given HBAR input on the [WHBAR, share] path. Reads the
  // router's getAmountsOut against live reserves. Returns 0n on failure.
  const quoteBuyShares = useCallback(async (routerAddr, whbar, shareToken, hbarInTinybar) => {
    if (!publicClient || !isAddr(routerAddr) || !isAddr(whbar) || !isAddr(shareToken)) return 0n;
    const amountIn = BigInt(hbarInTinybar);
    if (amountIn <= 0n) return 0n;
    try {
      const router = getContract({ address: routerAddr, abi: SAUCER_ROUTER_ABI, client: { public: publicClient } });
      const amounts = await router.read.getAmountsOut([amountIn, [whbar, shareToken]]);
      return BigInt(amounts[amounts.length - 1]);
    } catch { return 0n; }
  }, [publicClient]);

  // In-app BUY: swap HBAR -> share on the [WHBAR, share] path via the router
  // (swapExactETHForTokens, payable). The buyer must be ASSOCIATED with the share
  // token and KYC-granted (the share is KYC-keyed) — the screen gates on that.
  // amountOutMin applies a slippage tolerance to the live quote (bps).
  const swapBuyShares = useCallback(async ({ routerAddr, whbar, shareToken, hbarInTinybar, slippageBps = 100n }) => {
    await assertAccountSync();
    if (!walletClient) throw new Error("Wallet not connected — please connect first.");
    if (!isAddr(routerAddr) || !isAddr(whbar) || !isAddr(shareToken)) throw new Error("Secondary market not configured.");
    const amountIn = BigInt(hbarInTinybar);
    if (amountIn <= 0n) throw new Error("Amount must be greater than 0.");
    // Buyer must hold the share token: associate first (idempotent).
    await ensureAssociated(shareToken);
    const quoted = await quoteBuyShares(routerAddr, whbar, shareToken, amountIn);
    const minOut = quoted > 0n ? (quoted * (10_000n - BigInt(slippageBps))) / 10_000n : 0n;
    const router = getContract({ address: routerAddr, abi: SAUCER_ROUTER_ABI, client: { public: publicClient, wallet: walletClient } });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
    const overrides = await getGasOverrides(HTS_GAS_HEAVY);
    overrides.value = amountIn * WEIBAR_PER_TINYBAR;
    const hash = await router.write.swapExactETHForTokens([minOut, [whbar, shareToken], account, deadline], overrides);
    await waitTx(hash, {
      address: routerAddr, abi: SAUCER_ROUTER_ABI, functionName: "swapExactETHForTokens",
      args: [minOut, [whbar, shareToken], account, deadline], value: amountIn * WEIBAR_PER_TINYBAR,
    });
    return { hash, quoted, minOut };
  }, [publicClient, walletClient, getGasOverrides, waitTx, assertAccountSync, ensureAssociated, quoteBuyShares, account]);

  // ---- TIMELOCK pending-action introspection (D9) ----
  // Compute the action hash exactly like the contract: keccak256(abi.encode(name, id)).
  const financeActionHash = useCallback((dealId) =>
    keccak256(encodeAbiParameters([{ type: "string" }, { type: "uint256" }], ["financeClaim", BigInt(dealId)])),
  []);
  const defaultActionHash = useCallback((claimId) =>
    keccak256(encodeAbiParameters([{ type: "string" }, { type: "uint256" }], ["markDefault", BigInt(claimId)])),
  []);
  const getPendingAfter = useCallback(async (actionHash) => {
    const vault = vaultContract(true);
    if (!vault) return 0n;
    try { return BigInt(await vault.read.pendingAfter([actionHash])); } catch { return 0n; }
  }, [vaultContract]);
  const cancelTimelock = useCallback(async (actionHash) =>
    writeVault("cancelTimelock", [actionHash], { gas: HTS_GAS }),
  [writeVault]);

  return useMemo(() => ({
    configured: VAULT_CONFIGURED,
    // reads
    getPools, getNavPerShare, getMaxRedeem, getShareBalance, getHbarBalance, getKycStatus,
    getDeals, getClaims, getRedemptionQueue, getRoles, getTimelockDelay,
    getSecondaryConfig, getSecondaryPair, getPairCreateFeeTinybar,
    getPairReserves, quoteBuyShares, swapBuyShares,
    getPendingAfter, financeActionHash, defaultActionHash,
    // prerequisites
    ensureAssociated, ensureShareAllowance,
    // investor
    deposit, redeem, claimRedemption,
    // operator
    mintDeviceNft, approveDeviceEscrow, proposeDeal,
    // admin
    createPool, approveDeal, rejectDeal, financeClaim, markDefault, settleRewards,
    registerOperator, setAuthorizedSettler, adminGrantKyc, adminRevokeKyc,
    pausePool, unpausePool, freeze, unfreeze, setMinBuffer, setTimelockDelay, grantKycToAddress,
    setSecondaryConfig, enableSecondaryMarket, cancelTimelock,
  }), [
    getPools, getNavPerShare, getMaxRedeem, getShareBalance, getHbarBalance, getKycStatus,
    getDeals, getClaims, getRedemptionQueue, getRoles, getTimelockDelay,
    getSecondaryConfig, getSecondaryPair, getPairCreateFeeTinybar,
    getPairReserves, quoteBuyShares, swapBuyShares,
    getPendingAfter, financeActionHash, defaultActionHash,
    ensureAssociated, ensureShareAllowance,
    deposit, redeem, claimRedemption,
    mintDeviceNft, approveDeviceEscrow, proposeDeal,
    createPool, approveDeal, rejectDeal, financeClaim, markDefault, settleRewards,
    registerOperator, setAuthorizedSettler, adminGrantKyc, adminRevokeKyc,
    pausePool, unpausePool, freeze, unfreeze, setMinBuffer, setTimelockDelay, grantKycToAddress,
    setSecondaryConfig, enableSecondaryMarket, cancelTimelock,
  ]);
}
