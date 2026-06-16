// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@hiero-ledger/hiero-contracts/token-service/HederaTokenService.sol";
import "@hiero-ledger/hiero-contracts/token-service/IHederaTokenService.sol";
import "@hiero-ledger/hiero-contracts/token-service/KeyHelper.sol";
import "@hiero-ledger/hiero-contracts/token-service/ExpiryHelper.sol";
import "@hiero-ledger/hiero-contracts/common/HederaResponseCodes.sol";
import "@hiero-ledger/hiero-contracts/schedule-service/HederaScheduleService.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Minimal SaucerSwap V1 surface used by enableSecondaryMarket (SPEC §10). RouterV3 is the
///      HBAR-paired liquidity router (wraps HBAR->WHBAR internally); Factory exposes the create fee
///      and the post-create pair lookup.
interface ISaucerRouter {
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);
}

interface ISaucerFactory {
    function pairCreateFee() external view returns (uint256); // tinycents
    function getPair(address tokenA, address tokenB) external view returns (address);
    function createPair(address tokenA, address tokenB) external payable returns (address);
}

interface IShareApprove {
    function approve(address spender, uint256 amount) external returns (bool);
}

/**
 * @title WaferVault
 * @notice InfraFi liquidity vault for DePIN reward streams on Hedera (HSCS), settled in native HBAR.
 *
 * DESIGN (locked, SPEC §5): amortized-cost NAV accounting.
 *   totalAssets(pool) = idleTinybar + receivableTinybar  (DERIVED, never stored — can't drift).
 *   financeClaim keeps NAV FLAT: it moves `advance` from idle -> receivable and seeds the claim's
 *   carry at `advance`. settleRewards accretes ONLY the realized spread toward `expected` over the
 *   term; the receivable lifts by the carry delta, never by principal (kills the double-count bug).
 *   markDefault writes down the CARRY (not the advance) so realized income is preserved.
 *
 * UNITS (SPEC §3, verified live on testnet — NOT assumed):
 *   Inside the Hedera EVM everything is TINYBAR (1 HBAR = 1e8). `msg.value`,
 *   `address(this).balance`, and `call{value:}` are all tinybar. ONE = 1e8, share decimals = 8.
 *   The JSON-RPC boundary uses weibar (the relay divides tx value by 1e10 -> tinybar) — the
 *   contract NEVER hand-scales. Money is uint256 internally; we downcast to int64 ONLY at the HTS
 *   boundary and require(msg.value <= type(uint64).max) on every payable entrypoint.
 *
 * HTS RESPONSE CODES (SPEC §3): a low-level call to the 0x167 precompile returns success=true even
 *   on HTS business errors (KYC not granted, frozen, ...). We therefore check responseCode == 22
 *   (SUCCESS) on EVERY HTS call and revert otherwise.
 */
contract WaferVault is HederaTokenService, HederaScheduleService, KeyHelper, ExpiryHelper, Ownable2Step, ReentrancyGuard {
    // --- constants -----------------------------------------------------------
    uint256 internal constant ONE = 1e8; // 1.0 in tinybar / share micro-units (8 dp)
    int32 internal constant SHARE_DECIMALS = 8;
    uint256 internal constant SUCCESS = uint256(int256(HederaResponseCodes.SUCCESS)); // 22

    int64 internal constant AUTO_RENEW_PERIOD = 7776000; // 90 days

    // HTS token amounts are int64; the safe universal ceiling for any amount minted/transferred/burned
    // via the precompile. Guarding `msg.value <= uint64.max` is NOT enough for DERIVED share amounts
    // (e.g. `deposit` shares = assets*totalShares/netAssets can exceed int64.max once NAV < 1), so every
    // value that crosses the HTS boundary as an int64 is bounded by this instead of type(uint64).max.
    uint256 internal constant MAX_HTS_AMOUNT = uint256(uint64(type(int64).max)); // 2^63 - 1

    // Anti first-depositor inflation (Uniswap-V2 MINIMUM_LIQUIDITY style): at createPool the vault
    // mints DEAD_SHARES to itself AND seeds an equal DEAD_SHARES tinybar of idle cash, so genesis
    // NAV == ONE exactly (DEAD_SHARES shares <-> DEAD_SHARES tinybar). The dead position is
    // permanently locked (vault-held, never an investor balance, never redeemable), so the pool can
    // never be empty and the first real depositor can't manipulate the share price. No separate
    // "virtual offset" is needed — the seeded dead position is the on-balance-sheet equivalent.
    uint256 internal constant DEAD_SHARES = 1000; // 0.00001000 share, permanently locked
    uint256 internal constant DEAD_SEED_TINYBAR = 1000; // 0.00001000 HBAR backing the dead shares

    // Timelock window for financeClaim / markDefault (SPEC §7, D9).
    uint64 public timelockDelay = 0; // seconds; 0 = execute-now (set >0 in prod via setTimelockDelay)

    // Gas budget for the HIP-1215 scheduled `releaseAdvance` execution (one state write + one payout).
    uint256 internal constant RELEASE_ADVANCE_GAS = 400_000;

    // HIP-1215 "locked transfer": if advanceLockSeconds > 0, financeClaim LOCKS the advance in the
    // vault and schedules a Hedera Schedule Service (HSS, 0x16b) call that auto-releases it to the
    // operator after the window — no keeper. 0 = pay the advance immediately at finance (default).
    uint64 public advanceLockSeconds = 0;
    uint256 public pendingAdvanceTinybar; // Σ advances scheduled-but-not-yet-released (excluded from surplus)
    mapping(uint256 => uint64) public advanceUnlockTime; // claimId => unix unlock (0 = none / paid immediately)
    mapping(uint256 => bool) public advanceReleased; // claimId => scheduled advance already paid out

    // --- types ---------------------------------------------------------------
    enum DealStatus {
        Proposed,
        Approved,
        Rejected,
        Financed,
        Repaid,
        Defaulted
    }
    enum ClaimStatus {
        Active,
        Repaid,
        Defaulted
    }
    enum PoolStatus {
        Active,
        Paused
    }
    enum Category {
        GPU,
        Wireless,
        Mapping,
        Energy,
        Storage
    }
    enum RiskClass {
        A,
        B,
        C
    }

    struct Pool {
        address shareToken; // HTS fungible, 8dp, supply+KYC+freeze+wipe+pause keys = vault
        address claimNft; // HTS NFT collection (the receipts), supply/wipe = vault
        Category category;
        RiskClass class;
        uint256 idleTinybar; // on-hand HBAR cash backing shares (CASH leg)
        uint256 receivableTinybar; // Σ carry of Active claims (ACCRUAL leg)
        uint256 totalShares; // mirrors HTS supply, 8dp (incl. dead shares)
        uint256 queuedShares; // SENIOR LIABILITY: HBAR (tinybar) owed to queued redeemers, netted
                              // out of NAV/asset base so remaining holders don't inherit the backing
        uint16 minBufferBps; // min idle reserve kept free for redemptions (default 0)
        PoolStatus status;
    }

    struct Deal {
        address operator;
        bytes32 detailsHash; // keccak of canonical off-chain JSON (company/description/...)
        uint256 advanceTinybar; // requested upfront
        uint256 expectedTinybar; // total repayment target (expected >= advance)
        uint64 termSeconds;
        Category category; // proposed
        RiskClass class; // ASSIGNED by admin on approve
        uint32 poolId; // ASSIGNED by admin on approve
        address deviceNft; // collateral collection (escrowed at finance)
        int64 deviceSerial;
        DealStatus status;
        uint256 claimId; // set once financed
    }

    struct Claim {
        uint32 poolId;
        address operator;
        uint256 advanceTinybar; // initial carrying cost
        uint256 expectedTinybar; // face / repayment target
        uint256 carryTinybar; // current amortized book value (→0 at Repaid/Default)
        uint256 settledTinybar; // cumulative reward HBAR routed in
        uint64 startTime; // accretion clock start (= finance time)
        uint64 termSeconds;
        int64 nftSerial; // claim-NFT serial held by vault
        address deviceNft; // escrowed collateral, returned on Repaid
        int64 deviceSerial;
        ClaimStatus status;
    }

    struct RedemptionRequest {
        address investor;
        uint32 poolId;
        uint256 assetsTinybar; // remaining HBAR owed
        uint64 ts;
        bool filled;
    }

    // --- storage -------------------------------------------------------------
    mapping(uint32 => Pool) public pools;
    uint32 public poolCount;

    mapping(uint256 => Deal) public deals;
    uint256 public dealCount;

    mapping(uint256 => Claim) public claims;
    uint256 public claimCount;

    mapping(address => bool) public isOperator; // operator whitelist (D9)
    mapping(uint256 => mapping(address => bool)) public claimSettler; // per-claim allowlist (D8)
    mapping(uint32 => mapping(address => bool)) public isKyced; // admin KYC allowlist mirror (D2)
    mapping(address => bool) internal _associatedDevice; // device collection escrow association cache

    RedemptionRequest[] public redemptionQueue;

    // timelock: action hash => earliest execution timestamp (0 = not queued)
    mapping(bytes32 => uint64) public pendingAfter;

    // SaucerSwap V1 secondary-market config (SPEC §10, D4). Owner-set so the live testnet
    // addresses are wired without redeploying. The created share/WHBAR pair per pool is recorded.
    address public saucerRouter;
    address public saucerWhbar;
    address public saucerFactory;
    mapping(uint32 => address) public secondaryPair; // poolId => created LP pair (0 until enabled)

    // --- events --------------------------------------------------------------
    event PoolCreated(uint32 indexed poolId, address shareToken, address claimNft, Category category, RiskClass riskClass, string name, string symbol);
    event OperatorRegistered(address indexed operator, bool allowed);
    event DealProposed(uint256 indexed dealId, address indexed operator, Category category, uint256 advance, uint256 expected, uint64 term, bytes32 detailsHash, address deviceNft, int64 deviceSerial);
    event DealApproved(uint256 indexed dealId, RiskClass riskClass, uint32 poolId);
    event DealRejected(uint256 indexed dealId);
    event ClaimFinanced(uint256 indexed claimId, uint256 indexed dealId, uint32 indexed poolId, address operator, uint256 advance, uint256 expected, uint64 term, int64 serial, address deviceNft, int64 deviceSerial);
    event RewardRouted(uint256 indexed claimId, uint256 amount, uint256 newCarry, uint256 settled);
    event ClaimRepaid(uint256 indexed claimId, int64 serial);
    event ClaimDefaulted(uint256 indexed claimId, uint256 loss);
    event Deposit(uint32 indexed poolId, address indexed investor, uint256 assetsTinybar, uint256 sharesMinted);
    event Redeem(uint32 indexed poolId, address indexed investor, uint256 sharesBurned, uint256 assetsTinybar);
    event RedemptionQueued(uint256 indexed requestId, address indexed investor, uint32 indexed poolId, uint256 assetsTinybar);
    event RedemptionFilled(uint256 indexed requestId, address indexed investor, uint256 assetsTinybar);
    event KycGranted(uint32 indexed poolId, address indexed investor);
    event KycRevoked(uint32 indexed poolId, address indexed investor);
    event Paused(uint32 indexed poolId, bool paused);
    event Frozen(uint32 indexed poolId, address indexed account, bool frozen);
    event SettlerAuthorized(uint256 indexed claimId, address indexed settler, bool allowed);
    event MinBufferSet(uint32 indexed poolId, uint16 bps);
    event TimelockDelaySet(uint64 delay);
    event ActionQueued(bytes32 indexed actionHash, uint64 executeAfter);
    event SecondaryConfigSet(address router, address whbar, address factory);
    event SecondaryMarketEnabled(uint32 indexed poolId, address pair, uint256 shareLiquidity, uint256 hbarLiquidity);
    event SurplusWithdrawn(address indexed to, uint256 amount);
    event AdvanceLockSet(uint64 lockSeconds);
    event AdvanceScheduled(uint256 indexed claimId, address indexed operator, uint256 amount, uint64 unlockAt, address schedule);
    event AdvanceReleased(uint256 indexed claimId, address indexed operator, uint256 amount);

    // --- modifiers -----------------------------------------------------------
    modifier onlyOperator() {
        require(isOperator[msg.sender], "NOT_OPERATOR");
        _;
    }

    modifier onlyClaimSettler(uint256 claimId) {
        require(claimSettler[claimId][msg.sender], "NOT_SETTLER");
        _;
    }

    constructor() Ownable(msg.sender) {}

    /// @dev Ownable2Step on Hedera: ownership must be transferred via accept; renounce is disabled
    ///      so the vault can never be left without an admin (KYC/freeze/supply keys are the vault's).
    function renounceOwnership() public view override onlyOwner {
        revert("RENOUNCE_DISABLED");
    }

    // =========================================================================
    //                              ADMIN CONFIG
    // =========================================================================

    function setTimelockDelay(uint64 delay) external onlyOwner {
        timelockDelay = delay;
        emit TimelockDelaySet(delay);
    }

    /// @notice Set the advance-payout lock window (HIP-1215). 0 = pay the advance immediately at
    ///         finance (default). >0 = lock the advance in the vault and schedule its auto-release to
    ///         the operator after `lockSeconds` (e.g. 10 in demo, days in prod) — no keeper.
    function setAdvanceLock(uint64 lockSeconds) external onlyOwner {
        advanceLockSeconds = lockSeconds;
        emit AdvanceLockSet(lockSeconds);
    }

    function registerOperator(address operator, bool allowed) external onlyOwner {
        require(operator != address(0), "ZERO_OPERATOR");
        isOperator[operator] = allowed;
        emit OperatorRegistered(operator, allowed);
    }

    function setAuthorizedSettler(uint256 claimId, address settler, bool allowed) external onlyOwner {
        require(claimId < claimCount, "NO_CLAIM");
        require(settler != address(0), "ZERO_SETTLER");
        claimSettler[claimId][settler] = allowed;
        emit SettlerAuthorized(claimId, settler, allowed);
    }

    function setMinBuffer(uint32 poolId, uint16 bps) external onlyOwner {
        require(pools[poolId].shareToken != address(0), "NO_POOL");
        require(bps <= 10000, "BPS_RANGE");
        pools[poolId].minBufferBps = bps;
        emit MinBufferSet(poolId, bps);
    }

    /// @notice Wire the SaucerSwap V1 addresses (RouterV3, WHBAR token, Factory) used by
    ///         enableSecondaryMarket (SPEC §10). Owner-set so live testnet ids are configured
    ///         post-deploy without a redeploy.
    function setSecondaryConfig(address router, address whbar, address factory) external onlyOwner {
        require(router != address(0) && whbar != address(0) && factory != address(0), "ZERO_SECONDARY");
        saucerRouter = router;
        saucerWhbar = whbar;
        saucerFactory = factory;
        emit SecondaryConfigSet(router, whbar, factory);
    }

    /// @notice Withdraw protocol-owned surplus HBAR — contract balance not backing any pool's idle.
    /// @dev `createPool` over-funds the two HTS creates (the 0x167 precompile refunds the excess to
    ///      the contract) and that surplus is otherwise unrecoverable. Surplus = balance − Σ pool idle;
    ///      every pool's idle (the CASH leg backing live + queued shares) is preserved, so I1 holds.
    function ownerWithdrawSurplus(address payable to) external onlyOwner nonReentrant returns (uint256 amount) {
        require(to != address(0), "ZERO_TO");
        // Backed HBAR = every pool's idle (CASH leg) PLUS advances locked-but-not-yet-released to
        // operators (pendingAdvanceTinybar) — both are obligations, never sweepable surplus.
        uint256 backed = pendingAdvanceTinybar;
        for (uint32 i = 0; i < poolCount; i++) backed += pools[i].idleTinybar;
        uint256 bal = address(this).balance;
        require(bal > backed, "NO_SURPLUS");
        amount = bal - backed;
        emit SurplusWithdrawn(to, amount);
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "WITHDRAW_FAIL");
    }

    // =========================================================================
    //                              KYC ALLOWLIST (D2)
    // =========================================================================

    /// @notice Admin grants an investor KYC on a pool's share token (allowlist; NO auto-grant on deposit).
    /// @dev The investor must already be ASSOCIATED with the share token (IHRC719 from the front).
    function adminGrantKyc(uint32 poolId, address investor) external onlyOwner {
        Pool storage p = pools[poolId];
        require(p.shareToken != address(0), "NO_POOL");
        int64 rc = grantTokenKyc(p.shareToken, investor);
        require(uint256(int256(rc)) == SUCCESS, "GRANT_KYC_FAIL");
        isKyced[poolId][investor] = true;
        emit KycGranted(poolId, investor);
    }

    function adminRevokeKyc(uint32 poolId, address investor) external onlyOwner {
        Pool storage p = pools[poolId];
        require(p.shareToken != address(0), "NO_POOL");
        int64 rc = revokeTokenKyc(p.shareToken, investor);
        require(uint256(int256(rc)) == SUCCESS, "REVOKE_KYC_FAIL");
        isKyced[poolId][investor] = false;
        emit KycRevoked(poolId, investor);
    }

    // =========================================================================
    //                              COMPLIANCE (D10)
    // =========================================================================

    /// @notice Pause a pool: flips the contract-level value-flow gate (deposit/redeem/claimRedemption)
    ///         AND pauses the HTS share token itself, so ALL share transfers halt — including
    ///         peer-to-peer and the SaucerSwap secondary (a real regulator-style freeze, D10).
    function pausePool(uint32 poolId) external onlyOwner {
        Pool storage p = pools[poolId];
        require(p.shareToken != address(0), "NO_POOL");
        p.status = PoolStatus.Paused;
        int256 rc = pauseToken(p.shareToken);
        require(uint256(rc) == SUCCESS, "PAUSE_FAIL");
        emit Paused(poolId, true);
    }

    function unpausePool(uint32 poolId) external onlyOwner {
        Pool storage p = pools[poolId];
        require(p.shareToken != address(0), "NO_POOL");
        p.status = PoolStatus.Active;
        int256 rc = unpauseToken(p.shareToken);
        require(uint256(rc) == SUCCESS, "UNPAUSE_FAIL");
        emit Paused(poolId, false);
    }

    function freeze(uint32 poolId, address account) external onlyOwner {
        Pool storage p = pools[poolId];
        require(p.shareToken != address(0), "NO_POOL");
        int64 rc = freezeToken(p.shareToken, account);
        require(uint256(int256(rc)) == SUCCESS, "FREEZE_FAIL");
        emit Frozen(poolId, account, true);
    }

    function unfreeze(uint32 poolId, address account) external onlyOwner {
        Pool storage p = pools[poolId];
        require(p.shareToken != address(0), "NO_POOL");
        int64 rc = unfreezeToken(p.shareToken, account);
        require(uint256(int256(rc)) == SUCCESS, "UNFREEZE_FAIL");
        emit Frozen(poolId, account, false);
    }

    // =========================================================================
    //                              POOL CREATION (SPEC §7, §8)
    // =========================================================================

    /**
     * @notice Create a pool: an HTS fungible share token (NO custom fee, D11) + an HTS claim-NFT
     *         collection. Seeds DEAD_SHARES to the vault (anti-inflation) and self-grants the vault
     *         KYC so it can hold/transfer shares. The share token carries supply+KYC+freeze+wipe+pause
     *         keys (all = vault) so KYC, per-account freeze, and token-level pause are real levers (D10).
     * @dev payable — attach ~100 HBAR; the 0x167 precompile refunds create excess to the contract,
     *      so we forward the full balance to each of the two creates (create #2 sees create #1's refund).
     */
    function createPool(Category category, RiskClass riskClass, string memory name, string memory symbol)
        external
        payable
        onlyOwner
        returns (uint32 poolId, address shareToken, address claimNft)
    {
        require(msg.value <= type(uint64).max, "VALUE_TOO_LARGE");

        shareToken = _createShareToken(name, symbol, address(this).balance);
        claimNft = _createClaimNft(name, symbol, address(this).balance);

        // Vault self-grants KYC so it can hold its own (dead) shares and route transfers.
        int64 grc = grantTokenKyc(shareToken, address(this));
        require(uint256(int256(grc)) == SUCCESS, "GRANT_KYC_SELF");

        poolId = poolCount++;
        pools[poolId] = Pool({
            shareToken: shareToken,
            claimNft: claimNft,
            category: category,
            class: riskClass,
            idleTinybar: 0,
            receivableTinybar: 0,
            totalShares: 0,
            queuedShares: 0,
            minBufferBps: 0,
            status: PoolStatus.Active
        });

        // Seed dead shares to the vault treasury, backed by an equal idle seed -> genesis NAV == ONE.
        // The vault keeps the dead shares (never redeemable); the tiny seed comes from the create
        // refund balance the precompile returned to the contract (require it covers the seed).
        require(address(this).balance >= DEAD_SEED_TINYBAR, "SEED_HBAR_SHORT");
        (int256 mrc, , ) = mintToken(shareToken, int64(uint64(DEAD_SHARES)), new bytes[](0));
        require(uint256(mrc) == SUCCESS, "SEED_MINT_FAIL");
        pools[poolId].totalShares = DEAD_SHARES; // vault holds them, never an investor balance
        pools[poolId].idleTinybar = DEAD_SEED_TINYBAR; // 1:1 backing -> genesis NAV == ONE

        emit PoolCreated(poolId, shareToken, claimNft, category, riskClass, name, symbol);
    }

    function _createShareToken(string memory name, string memory symbol, uint256 value)
        internal
        returns (address shareToken)
    {
        // 5 keys (all = vault contract): SUPPLY (mint/burn), KYC (allowlist), FREEZE (per-account),
        // WIPE (clawback), PAUSE (token-level halt). Matches SPEC §8 minus FEE_SCHEDULE (D11: no fee).
        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](5);
        keys[0] = getSingleKey(KeyType.SUPPLY, KeyValueType.CONTRACT_ID, address(this));
        keys[1] = getSingleKey(KeyType.KYC, KeyValueType.CONTRACT_ID, address(this));
        keys[2] = getSingleKey(KeyType.FREEZE, KeyValueType.CONTRACT_ID, address(this));
        keys[3] = getSingleKey(KeyType.WIPE, KeyValueType.CONTRACT_ID, address(this));
        keys[4] = getSingleKey(KeyType.PAUSE, KeyValueType.CONTRACT_ID, address(this));

        IHederaTokenService.HederaToken memory token;
        token.name = name;
        token.symbol = symbol;
        token.treasury = address(this);
        token.memo = "Wafer pool share";
        token.tokenSupplyType = false; // INFINITE supply
        token.maxSupply = 0;
        token.freezeDefault = false;
        token.tokenKeys = keys;
        token.expiry = createAutoRenewExpiry(address(this), AUTO_RENEW_PERIOD);

        // NO custom fee: a tradeable pool-share must transfer freely. On Hedera a fractional fee is
        // assessed on every NON-collector transfer; that path reverts INVALID_ACCOUNT_ID and breaks
        // BOTH redeem (operator->vault) and any AMM/secondary transfer (operator->pair). So the share
        // ships as a plain fungible token (freely transferable, redeem-safe, SaucerSwap-compatible).
        // (A compliant fee would require a permissioned-transfer design — out of scope.)
        IHederaTokenService.FixedFee[] memory fixedFees = new IHederaTokenService.FixedFee[](0);
        IHederaTokenService.FractionalFee[] memory fractionalFees = new IHederaTokenService.FractionalFee[](0);

        (bool ok, bytes memory result) = precompileAddress.call{value: value}(
            abi.encodeWithSelector(
                IHederaTokenService.createFungibleTokenWithCustomFees.selector,
                token,
                int64(0),
                SHARE_DECIMALS,
                fixedFees,
                fractionalFees
            )
        );
        int256 rc;
        (rc, shareToken) = ok ? abi.decode(result, (int32, address)) : (int256(HederaResponseCodes.UNKNOWN), address(0));
        require(uint256(rc) == SUCCESS, "CREATE_SHARE_FAIL");
    }

    function _createClaimNft(string memory name, string memory symbol, uint256 value)
        internal
        returns (address claimNft)
    {
        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](2);
        keys[0] = getSingleKey(KeyType.SUPPLY, KeyValueType.CONTRACT_ID, address(this));
        keys[1] = getSingleKey(KeyType.WIPE, KeyValueType.CONTRACT_ID, address(this));

        IHederaTokenService.HederaToken memory token;
        token.name = string.concat(name, " Claim");
        token.symbol = string.concat(symbol, "CLAIM");
        token.treasury = address(this);
        token.memo = "Wafer reward claim";
        token.tokenSupplyType = false; // INFINITE
        token.maxSupply = 0;
        token.freezeDefault = false;
        token.tokenKeys = keys;
        token.expiry = createAutoRenewExpiry(address(this), AUTO_RENEW_PERIOD);

        (bool ok, bytes memory result) = precompileAddress.call{value: value}(
            abi.encodeWithSelector(IHederaTokenService.createNonFungibleToken.selector, token)
        );
        int256 rc;
        (rc, claimNft) = ok ? abi.decode(result, (int32, address)) : (int256(HederaResponseCodes.UNKNOWN), address(0));
        require(uint256(rc) == SUCCESS, "CREATE_NFT_FAIL");
    }

    // =========================================================================
    //                         DEAL PROPOSAL WORKFLOW (SPEC §6, D7)
    // =========================================================================

    /// @notice Operator proposes a deal. class+pool are assigned later by the admin on approve.
    function proposeDeal(
        Category category,
        uint256 advance,
        uint256 expected,
        uint64 term,
        bytes32 detailsHash,
        address deviceNft,
        int64 deviceSerial
    ) external onlyOperator returns (uint256 dealId) {
        require(expected >= advance, "EXPECTED_LT_ADVANCE");
        require(advance > 0, "ZERO_ADVANCE");
        require(term > 0, "ZERO_TERM");
        require(expected <= type(uint64).max, "VALUE_TOO_LARGE");
        require(deviceNft != address(0), "ZERO_DEVICE");

        dealId = dealCount++;
        deals[dealId] = Deal({
            operator: msg.sender,
            detailsHash: detailsHash,
            advanceTinybar: advance,
            expectedTinybar: expected,
            termSeconds: term,
            category: category,
            class: RiskClass.A, // placeholder until approve
            poolId: 0, // placeholder until approve
            deviceNft: deviceNft,
            deviceSerial: deviceSerial,
            status: DealStatus.Proposed,
            claimId: 0
        });

        emit DealProposed(dealId, msg.sender, category, advance, expected, term, detailsHash, deviceNft, deviceSerial);
    }

    /// @notice Admin approves a deal, assigning risk class and target pool (category must match).
    function approveDeal(uint256 dealId, RiskClass riskClass, uint32 poolId) external onlyOwner {
        Deal storage d = deals[dealId];
        require(d.operator != address(0), "NO_DEAL");
        require(d.status == DealStatus.Proposed, "NOT_PROPOSED");
        Pool storage p = pools[poolId];
        require(p.shareToken != address(0), "NO_POOL");
        require(p.category == d.category, "CATEGORY_MISMATCH");

        d.class = riskClass;
        d.poolId = poolId;
        d.status = DealStatus.Approved;
        emit DealApproved(dealId, riskClass, poolId);
    }

    function rejectDeal(uint256 dealId) external onlyOwner {
        Deal storage d = deals[dealId];
        require(d.operator != address(0), "NO_DEAL");
        require(d.status == DealStatus.Proposed, "NOT_PROPOSED");
        d.status = DealStatus.Rejected;
        emit DealRejected(dealId);
    }

    // =========================================================================
    //                       FINANCE (timelocked, CEI, nonReentrant)
    // =========================================================================

    /**
     * @notice Finance an approved deal: escrow the device-NFT, mint the claim NFT to the vault,
     *         create the amortized-cost Claim (carry seeded at advance -> NAV FLAT, I3), and pay
     *         the advance to the operator LAST (CEI).
     * @dev Timelocked (D9): first call queues the action; a second call after the delay executes it.
     *      Default claim settlers = {operator, owner}.
     */
    function financeClaim(uint256 dealId) external nonReentrant onlyOwner returns (uint256 claimId, int64 serial) {
        Deal storage d = deals[dealId];
        require(d.operator != address(0), "NO_DEAL");
        require(d.status == DealStatus.Approved, "NOT_APPROVED");

        bytes32 action = keccak256(abi.encode("financeClaim", dealId));
        if (!_consumeTimelock(action)) return (0, 0); // queued, not yet executable

        Pool storage p = pools[d.poolId];
        // Only deploy idle that is FREE of the senior redemption-queue earmark: `queuedShares` is HBAR
        // already owed to partially-filled redeemers (who burned ALL their shares and are senior, I10).
        // Checking raw idle would let finance strand the queue in an illiquid receivable; use the same
        // free-idle basis as _liquidAssets so the queue is always serviceable first.
        uint256 freeIdle = p.idleTinybar > p.queuedShares ? p.idleTinybar - p.queuedShares : 0;
        require(freeIdle >= d.advanceTinybar, "INSUFFICIENT_FREE_IDLE");
        require(address(this).balance >= d.advanceTinybar, "INSUFFICIENT_VAULT_HBAR");

        // --- effects: amortized-cost finance keeps NAV flat (idle -> receivable @ advance) ---
        p.idleTinybar -= d.advanceTinybar;
        p.receivableTinybar += d.advanceTinybar;

        // Escrow the operator's device-NFT into the vault (operator pre-approves; vault associates once).
        _associateDeviceCollection(d.deviceNft);
        int256 drc = transferNFT(d.deviceNft, d.operator, address(this), d.deviceSerial);
        require(uint256(drc) == SUCCESS, "DEVICE_ESCROW_FAIL");

        // Mint the claim NFT (receipt) to the vault treasury; metadata = 32-byte keccak deal hash.
        bytes[] memory metadata = new bytes[](1);
        metadata[0] = abi.encodePacked(d.detailsHash);
        (int256 mrc, , int64[] memory serials) = mintToken(p.claimNft, 0, metadata);
        require(uint256(mrc) == SUCCESS, "MINT_CLAIM_FAIL");
        serial = serials[0];

        claimId = claimCount++;
        claims[claimId] = Claim({
            poolId: d.poolId,
            operator: d.operator,
            advanceTinybar: d.advanceTinybar,
            expectedTinybar: d.expectedTinybar,
            carryTinybar: d.advanceTinybar, // carry-at-advance -> NAV FLAT
            settledTinybar: 0,
            startTime: uint64(block.timestamp),
            termSeconds: d.termSeconds,
            nftSerial: serial,
            deviceNft: d.deviceNft,
            deviceSerial: d.deviceSerial,
            status: ClaimStatus.Active
        });

        d.status = DealStatus.Financed;
        d.claimId = claimId;

        // Default settler set: the operator EOA and the owner (relayer/keeper added via setAuthorizedSettler).
        claimSettler[claimId][d.operator] = true;
        claimSettler[claimId][owner()] = true;

        emit ClaimFinanced(claimId, dealId, d.poolId, d.operator, d.advanceTinybar, d.expectedTinybar, d.termSeconds, serial, d.deviceNft, d.deviceSerial);

        // --- interaction LAST (CEI): pay OR lock+schedule the advance ---
        if (advanceLockSeconds == 0) {
            // Immediate payout (default).
            (bool ok, ) = payable(d.operator).call{value: d.advanceTinybar}("");
            require(ok, "HBAR_ADVANCE_FAIL");
        } else {
            // HIP-1215 "locked transfer": the advance stays in the vault (earmarked in
            // pendingAdvanceTinybar) and an HSS-scheduled call auto-releases it at unlock time.
            uint64 unlockAt = uint64(block.timestamp) + advanceLockSeconds;
            advanceUnlockTime[claimId] = unlockAt;
            pendingAdvanceTinybar += d.advanceTinybar;
            (int64 src, address schedule) = scheduleCall(
                address(this),
                uint256(unlockAt),
                RELEASE_ADVANCE_GAS,
                0, // value 0: releaseAdvance pays the operator from the vault's own balance
                abi.encodeWithSelector(this.releaseAdvance.selector, claimId)
            );
            require(uint256(int256(src)) == SUCCESS, "SCHEDULE_ADVANCE_FAIL");
            emit AdvanceScheduled(claimId, d.operator, d.advanceTinybar, unlockAt, schedule);
        }
    }

    /// @notice Release a locked, scheduled advance to its operator. Auto-fired by Hedera Schedule
    ///         Service (HIP-1215) at the unlock time — no keeper. Permissionless but gated by the
    ///         unlock time + a once-only flag, so it can pay neither early nor twice even if a human
    ///         calls it. The advance is the operator's at finance regardless of later claim status.
    function releaseAdvance(uint256 claimId) external nonReentrant {
        uint64 unlockAt = advanceUnlockTime[claimId];
        require(unlockAt != 0, "NO_SCHEDULED_ADVANCE");
        require(!advanceReleased[claimId], "ALREADY_RELEASED");
        require(block.timestamp >= unlockAt, "ADVANCE_LOCKED");

        Claim storage c = claims[claimId];
        uint256 amount = c.advanceTinybar;

        // --- effects ---
        advanceReleased[claimId] = true;
        pendingAdvanceTinybar -= amount;
        emit AdvanceReleased(claimId, c.operator, amount);

        // --- interaction LAST ---
        (bool ok, ) = payable(c.operator).call{value: amount}("");
        require(ok, "HBAR_ADVANCE_FAIL");
    }

    // =========================================================================
    //                       SETTLEMENT (amortized accrual, SPEC §5.1)
    // =========================================================================

    /**
     * @notice Route reward HBAR (msg.value) into a claim. Accretes ONLY the realized spread toward
     *         `expected` over the term; the pool receivable lifts by the carry delta (never by
     *         principal). Auto-Repaid when settled >= expected: burns the claim NFT, returns device.
     * @dev gated by per-claim settler allowlist (D8), Active-only, accrual capped at expected (I6).
     *      CEI: the only interaction (device return) is last and only on the repay branch.
     */
    function settleRewards(uint32 poolId, uint256 claimId)
        external
        payable
        nonReentrant
        onlyClaimSettler(claimId)
    {
        require(msg.value > 0, "ZERO_REWARD");
        require(msg.value <= type(uint64).max, "VALUE_TOO_LARGE");

        Claim storage c = claims[claimId];
        require(c.poolId == poolId, "CLAIM_POOL_MISMATCH");
        require(c.status == ClaimStatus.Active, "CLAIM_NOT_ACTIVE");

        Pool storage p = pools[poolId];
        uint256 pay = msg.value; // tinybar

        // Cash arrives -> idle rises. settled accumulates.
        p.idleTinybar += pay;
        c.settledTinybar += pay;

        // target = advance + (expected - advance) * min(elapsed, term) / term  (clamped, I6)
        uint64 elapsed = uint64(block.timestamp) - c.startTime;
        uint64 t = c.termSeconds;
        uint256 capped = elapsed < t ? uint256(elapsed) : uint256(t);
        uint256 target = c.advanceTinybar + ((c.expectedTinybar - c.advanceTinybar) * capped) / uint256(t);

        // newCarry = max(0, target - settled). Receivable lifts only by the spread (carry delta).
        uint256 newCarry = target > c.settledTinybar ? target - c.settledTinybar : 0;
        // p.receivable += newCarry - c.carry  (safe under/overflow handling)
        if (newCarry >= c.carryTinybar) {
            p.receivableTinybar += newCarry - c.carryTinybar;
        } else {
            p.receivableTinybar -= c.carryTinybar - newCarry;
        }
        c.carryTinybar = newCarry;

        emit RewardRouted(claimId, pay, newCarry, c.settledTinybar);

        // Full repayment: drop residual carry, burn claim NFT, return the device-NFT to the operator.
        if (c.settledTinybar >= c.expectedTinybar) {
            if (c.carryTinybar > 0) {
                p.receivableTinybar -= c.carryTinybar;
                c.carryTinybar = 0;
            }
            c.status = ClaimStatus.Repaid;

            int64[] memory serials = new int64[](1);
            serials[0] = c.nftSerial;
            (int256 brc, ) = burnToken(p.claimNft, 0, serials);
            require(uint256(brc) == SUCCESS, "BURN_CLAIM_FAIL");

            emit ClaimRepaid(claimId, c.nftSerial);

            // interaction LAST: return escrowed device-NFT to the operator.
            int256 drc = transferNFT(c.deviceNft, address(this), c.operator, c.deviceSerial);
            require(uint256(drc) == SUCCESS, "DEVICE_RETURN_FAIL");
        }
    }

    // =========================================================================
    //                       DEFAULT (timelocked, write down carry, SPEC §5.1)
    // =========================================================================

    /**
     * @notice Mark a claim defaulted: writes down the CARRY (not the advance), so realized income
     *         is preserved. Device-NFT is retained (wiped) as the realized collateral claim.
     * @dev Timelocked (D9): first call queues; a second call after the delay executes.
     */
    function markDefault(uint256 claimId) external nonReentrant onlyOwner {
        Claim storage c = claims[claimId];
        require(c.operator != address(0), "NO_CLAIM");
        require(c.status == ClaimStatus.Active, "CLAIM_NOT_ACTIVE");

        bytes32 action = keccak256(abi.encode("markDefault", claimId));
        if (!_consumeTimelock(action)) return; // queued, not yet executable

        Pool storage p = pools[c.poolId];
        uint256 loss = c.carryTinybar; // write down the amortized book value
        p.receivableTinybar -= loss;
        c.carryTinybar = 0;
        c.status = ClaimStatus.Defaulted;

        // Retain/liquidate the device-NFT collateral: wipe it from the vault (it stays out of the
        // operator's hands; in prod the keeper liquidates and routes proceeds back via settleRewards).
        int64[] memory serials = new int64[](1);
        serials[0] = c.deviceSerial;
        // Device collection may be a third-party token without a vault wipe key; this is best-effort
        // and intentionally does NOT revert the write-down on a wipe failure (the credit loss is the
        // on-chain truth either way; the keeper liquidates the retained collateral off-path).
        wipeTokenAccountNFT(c.deviceNft, address(this), serials);

        emit ClaimDefaulted(claimId, loss);
    }

    // =========================================================================
    //                       DEPOSIT / REDEEM (CEI, nonReentrant)
    // =========================================================================

    /**
     * @notice Deposit native HBAR and mint shares at the current NAV (seeded-dead-position math).
     * @dev D2: investor must be KYC-allowlisted (admin granted) AND associated. NO auto-grant here.
     */
    function deposit(uint32 poolId) external payable nonReentrant returns (uint256 sharesMinted) {
        Pool storage p = pools[poolId];
        require(p.shareToken != address(0), "NO_POOL");
        require(p.status == PoolStatus.Active, "POOL_PAUSED");
        require(msg.value > 0, "ZERO_DEPOSIT");
        require(msg.value <= type(uint64).max, "VALUE_TOO_LARGE");
        require(isKyced[poolId][msg.sender], "NOT_KYCED");

        uint256 assets = msg.value; // tinybar
        sharesMinted = _convertToShares(p, assets);
        require(sharesMinted > 0, "ZERO_SHARES");
        // `sharesMinted` is DERIVED (assets*totalShares/netAssets) and is NOT bounded by the
        // msg.value<=uint64.max guard: once NAV < 1 (post-default) it can exceed int64.max and the
        // int64(uint64(sharesMinted)) HTS cast would wrap/truncate, diverging accounting from supply.
        require(sharesMinted <= MAX_HTS_AMOUNT, "SHARES_OVERFLOW");

        // --- effects ---
        p.idleTinybar += assets;
        p.totalShares += sharesMinted;

        // --- HTS interactions: mint to treasury, then transfer to the investor ---
        (int256 mrc, , ) = mintToken(p.shareToken, int64(uint64(sharesMinted)), new bytes[](0));
        require(uint256(mrc) == SUCCESS, "MINT_SHARE_FAIL");

        int256 trc = transferToken(p.shareToken, address(this), msg.sender, int64(uint64(sharesMinted)));
        require(uint256(trc) == SUCCESS, "TRANSFER_SHARE_FAIL");

        emit Deposit(poolId, msg.sender, assets, sharesMinted);
    }

    /**
     * @notice Redeem `shares` for native HBAR at NAV. Liquidity-aware: instant fill up to
     *         liquidAssets (idle minus the minBuffer reserve), remainder enqueued FIFO (D5).
     * @dev The investor must approve the vault for `shares` (ERC-20 facade) so the share pull
     *      succeeds. The share ships with no custom fee (D11), so the pull/burn is a plain transfer.
     */
    function redeem(uint32 poolId, uint256 shares) external nonReentrant returns (uint256 filled, uint256 queued) {
        Pool storage p = pools[poolId];
        require(p.shareToken != address(0), "NO_POOL");
        // Pause is a real compliance freeze of the WHOLE pool (D10/§7): it halts redeem (and queue
        // claims) as well as deposit, not just new money in. A regulator-style pool freeze stops
        // value out too; per-account exits are governed separately by freeze()/unfreeze().
        require(p.status == PoolStatus.Active, "POOL_PAUSED");
        require(shares > 0, "ZERO_SHARES");
        require(shares <= MAX_HTS_AMOUNT, "VALUE_TOO_LARGE"); // int64 HTS-amount ceiling

        uint256 investorShares = p.totalShares - DEAD_SHARES;
        require(shares <= investorShares, "OVER_REDEEM");

        uint256 assets = _convertToAssets(p, shares);
        require(assets > 0, "ZERO_ASSETS");

        uint256 liquid = _liquidAssets(p);
        filled = assets > liquid ? liquid : assets;
        queued = assets - filled;

        // --- effects ---
        p.totalShares -= shares;
        p.idleTinybar -= filled;

        // --- HTS interactions: pull shares from investor, burn from treasury ---
        int256 trc = transferToken(p.shareToken, msg.sender, address(this), int64(uint64(shares)));
        require(uint256(trc) == SUCCESS, "PULL_SHARE_FAIL");

        (int256 brc, ) = burnToken(p.shareToken, int64(uint64(shares)), new int64[](0));
        require(uint256(brc) == SUCCESS, "BURN_SHARE_FAIL");

        // Enqueue the unfillable remainder (served by claimRedemption once idle refills).
        if (queued > 0) {
            uint256 requestId = redemptionQueue.length;
            redemptionQueue.push(RedemptionRequest({
                investor: msg.sender,
                poolId: poolId,
                assetsTinybar: queued,
                ts: uint64(block.timestamp),
                filled: false
            }));
            p.queuedShares += queued;
            emit RedemptionQueued(requestId, msg.sender, poolId, queued);
        }

        emit Redeem(poolId, msg.sender, shares, filled);

        // --- interaction LAST: pay the instant fill ---
        if (filled > 0) {
            (bool ok, ) = payable(msg.sender).call{value: filled}("");
            require(ok, "HBAR_PAYOUT_FAIL");
        }
    }

    /// @notice Pay a queued redemption request once the pool's idle cash covers it (FIFO-served by the front).
    function claimRedemption(uint256 requestId) external nonReentrant {
        require(requestId < redemptionQueue.length, "NO_REQUEST");
        RedemptionRequest storage req = redemptionQueue[requestId];
        require(!req.filled, "ALREADY_FILLED");

        Pool storage p = pools[req.poolId];
        require(p.status == PoolStatus.Active, "POOL_PAUSED"); // pause halts all value-out too (D10)
        uint256 owed = req.assetsTinybar;
        require(p.idleTinybar >= owed, "NO_LIQUID");

        // --- effects ---
        req.filled = true;
        p.idleTinybar -= owed;
        p.queuedShares -= owed;

        emit RedemptionFilled(requestId, req.investor, owed);

        // --- interaction LAST ---
        (bool ok, ) = payable(req.investor).call{value: owed}("");
        require(ok, "HBAR_PAYOUT_FAIL");
    }

    // =========================================================================
    //                       SECONDARY MARKET (SaucerSwap V1, SPEC §10, D4)
    // =========================================================================

    /**
     * @notice Stand up the KYC-enabled share/WHBAR SaucerSwap market for a pool in ONE owner call,
     *         resolving the KYC deadlock end-to-end (SPEC §10). The router is NOT KYC-granted — a
     *         Uniswap-v2 router transfers the LP leg caller->pair directly, so granting it KYC fails
     *         (TOKEN_NOT_ASSOCIATED) and is unnecessary. The working sequence is:
     *           (1) factory.createPair(share, WHBAR) — permissionless, self-associates the new pair,
     *           (2) adminGrantKyc(pair)              — now the pair exists+associated, so the KYC-keyed
     *                                                  share can settle into it,
     *           (3) mint the share leg to the vault + approve the router,
     *           (4) router.addLiquidityETH(...)      — seeds the KYC'd pair (LP token to the owner).
     * @dev The liquidity SHARE leg is freshly minted to the vault treasury and is NOT pool
     *      investor accounting: it is an owner-seeded market position (backed by the attached HBAR
     *      liquidity), so it does NOT touch idle/receivable/totalShares. Seed price ≈ NAV by passing
     *      shareLiquidity (8dp) against hbarLiquidity (tinybar) at the current navPerShare.
     *      msg.value (tinybar) MUST be pairCreateFeeTinybar + hbarLiquidityTinybar. The front reads
     *      factory.pairCreateFee() (tinycents) and converts it live via the Mirror Node exchange
     *      rate (+buffer) — never hardcoded (SPEC §10).
     * @param poolId             the pool whose share token gets a market
     * @param shareLiquidity     share leg in 8dp units (e.g. NAV 1.0 -> 1000e8 vs 1000 HBAR)
     * @param hbarLiquidityTinybar HBAR leg in tinybar (the WHBAR side, wrapped by the router)
     * @param pairCreateFeeTinybar SaucerSwap create fee in tinybar (factory fee converted live)
     */
    function enableSecondaryMarket(
        uint32 poolId,
        uint256 shareLiquidity,
        uint256 hbarLiquidityTinybar,
        uint256 pairCreateFeeTinybar
    ) external payable onlyOwner nonReentrant returns (address pair) {
        require(saucerRouter != address(0), "SECONDARY_UNSET");
        Pool storage p = pools[poolId];
        require(p.shareToken != address(0), "NO_POOL");
        require(secondaryPair[poolId] == address(0), "ALREADY_ENABLED");
        require(shareLiquidity > 0 && shareLiquidity <= MAX_HTS_AMOUNT, "SHARE_RANGE");
        require(hbarLiquidityTinybar > 0, "ZERO_HBAR_LIQ");
        require(msg.value <= type(uint64).max, "VALUE_TOO_LARGE");
        require(msg.value == pairCreateFeeTinybar + hbarLiquidityTinybar, "VALUE_MISMATCH");
        require(address(this).balance >= msg.value, "INSUFFICIENT_VAULT_HBAR");

        // (1) Create the pair STANDALONE (permissionless; pays the create fee). createPair
        //     self-associates the new pair to both tokens. The ROUTER is intentionally NOT
        //     KYC-granted: a Uniswap-v2 router transfers the LP leg caller->pair DIRECTLY (it never
        //     holds the token), so granting it KYC fails (TOKEN_NOT_ASSOCIATED) and is unnecessary.
        //     Splitting create from seed is also required because the atomic create+seed would seed a
        //     not-yet-KYC'd pair (ACCOUNT_KYC_NOT_GRANTED).
        pair = ISaucerFactory(saucerFactory).createPair{value: pairCreateFeeTinybar}(p.shareToken, saucerWhbar);
        if (pair == address(0)) pair = ISaucerFactory(saucerFactory).getPair(p.shareToken, saucerWhbar);
        require(pair != address(0), "PAIR_NOT_CREATED");

        // (2) KYC-grant the pair now that it EXISTS and is associated (the vault is the KYC key).
        int64 prc = grantTokenKyc(p.shareToken, pair);
        require(uint256(int256(prc)) == SUCCESS, "GRANT_KYC_PAIR");

        // (3) Mint the liquidity share leg to the vault treasury (owner-seeded; NOT pool accounting)
        //     and approve the router to pull it (ERC-20 facade on the HTS token).
        (int256 mrc, , ) = mintToken(p.shareToken, int64(uint64(shareLiquidity)), new bytes[](0));
        require(uint256(mrc) == SUCCESS, "MINT_LIQ_SHARE_FAIL");
        require(IShareApprove(p.shareToken).approve(saucerRouter, shareLiquidity), "APPROVE_ROUTER_FAIL");

        // (4) Seed liquidity into the KYC'd pair. LP token goes to the OWNER (the vault contract has
        //     no auto-association slot for the LP token; the owner does). It is admin capital.
        ISaucerRouter(saucerRouter).addLiquidityETH{value: hbarLiquidityTinybar}(
            p.shareToken,
            shareLiquidity,
            0, // amountTokenMin (first mint sets the price)
            0, // amountETHMin
            owner(),
            block.timestamp + 1200
        );

        secondaryPair[poolId] = pair;
        isKyced[poolId][pair] = true;

        emit SecondaryMarketEnabled(poolId, pair, shareLiquidity, hbarLiquidityTinybar);
    }

    // =========================================================================
    //                              VIEWS
    // =========================================================================

    /// @notice totalAssets = idle + receivable (GROSS, DERIVED, never stored — I2). This is the
    ///         pool's gross asset identity. NAV and share conversions use `netAssets` (gross minus
    ///         the senior queued-redemption liability) so queued backing never lifts other holders.
    function totalAssets(uint32 poolId) public view returns (uint256) {
        Pool storage p = pools[poolId];
        return p.idleTinybar + p.receivableTinybar;
    }

    /// @notice netAssets = idle + receivable - queuedShares (the asset base backing LIVE shares).
    ///         `queuedShares` is a senior liability (HBAR already owed to partially-filled
    ///         redeemers whose shares are burned) — it is earmarked for them and excluded from the
    ///         value attributable to remaining holders. This is what NAV/_convertTo* divide over.
    function netAssets(uint32 poolId) public view returns (uint256) {
        return _netAssets(pools[poolId]);
    }

    /// @notice NAV per share in tinybar (8 dp). Pre-seed (no shares) = ONE; post-seed the dead
    ///         position pins genesis NAV at ONE (DEAD_SHARES <-> DEAD_SEED_TINYBAR). Uses NET assets
    ///         so a partially-filled redeemer's queued backing does NOT inflate other holders' NAV.
    function navPerShare(uint32 poolId) public view returns (uint256) {
        Pool storage p = pools[poolId];
        if (p.totalShares == 0) return ONE;
        return (_netAssets(p) * ONE) / p.totalShares;
    }

    /// @notice Liquid (instant-redeemable) assets = idle, minus what is already owed to the senior
    ///         redemption queue, minus the minBuffer reserve.
    function liquidAssets(uint32 poolId) external view returns (uint256) {
        return _liquidAssets(pools[poolId]);
    }

    /// @notice Max HBAR an instant redeem can pay a holder = min(holderAssets, liquidAssets).
    function maxRedeem(uint32 poolId, uint256 shares) external view returns (uint256) {
        Pool storage p = pools[poolId];
        uint256 assets = _convertToAssets(p, shares);
        uint256 liquid = _liquidAssets(p);
        return assets > liquid ? liquid : assets;
    }

    function previewDeposit(uint32 poolId, uint256 assetsTinybar) external view returns (uint256) {
        return _convertToShares(pools[poolId], assetsTinybar);
    }

    function previewRedeem(uint32 poolId, uint256 shares) external view returns (uint256) {
        return _convertToAssets(pools[poolId], shares);
    }

    function queueLength() external view returns (uint256) {
        return redemptionQueue.length;
    }

    // =========================================================================
    //                              INTERNAL MATH
    // =========================================================================

    /// netAssets = idle + receivable - queuedShares (the value backing LIVE shares). The queued
    /// liability is HBAR already owed to redeemers whose shares are burned, so it is subtracted from
    /// the base the remaining holders share. Clamped at 0 for safety (queuedShares can never exceed
    /// idle+receivable because it is only ever incremented by HBAR that was inside the pool).
    function _netAssets(Pool storage p) internal view returns (uint256) {
        uint256 gross = p.idleTinybar + p.receivableTinybar;
        return gross > p.queuedShares ? gross - p.queuedShares : 0;
    }

    /// shares = assets * totalShares / netAssets. The seeded dead position guarantees
    /// totalShares > 0 and netAssets > 0 from createPool on, so this never divides by zero and the
    /// first real depositor can't game the price (Uniswap MINIMUM_LIQUIDITY equivalent).
    function _convertToShares(Pool storage p, uint256 assets) internal view returns (uint256) {
        uint256 na = _netAssets(p);
        if (p.totalShares == 0 || na == 0) return assets; // pre-seed safety: 1:1 at NAV ONE
        return (assets * p.totalShares) / na;
    }

    /// assets = shares * netAssets / totalShares.
    function _convertToAssets(Pool storage p, uint256 shares) internal view returns (uint256) {
        if (p.totalShares == 0) return 0;
        return (shares * _netAssets(p)) / p.totalShares;
    }

    /// liquidAssets = (idle - queuedShares already owed) - reserve, where the buffer reserve is taken
    /// over the NET asset base. Idle that is earmarked for the senior queue is never quoted as
    /// instant-redeemable to a new redeemer (the queue is FIFO-served first via claimRedemption).
    function _liquidAssets(Pool storage p) internal view returns (uint256) {
        // Cash free of the queued liability: idle minus what is already owed to the queue.
        uint256 freeIdle = p.idleTinybar > p.queuedShares ? p.idleTinybar - p.queuedShares : 0;
        uint256 reserve = (uint256(p.minBufferBps) * _netAssets(p)) / 10000;
        return freeIdle > reserve ? freeIdle - reserve : 0;
    }

    // =========================================================================
    //                              TIMELOCK (D9)
    // =========================================================================

    /// @dev Returns true and clears the slot when the action is executable; otherwise queues it
    ///      (or no-ops while still pending) and returns false. timelockDelay == 0 => execute now.
    function _consumeTimelock(bytes32 action) internal returns (bool) {
        if (timelockDelay == 0) return true;
        uint64 ready = pendingAfter[action];
        if (ready == 0) {
            uint64 executeAfter = uint64(block.timestamp) + timelockDelay;
            pendingAfter[action] = executeAfter;
            emit ActionQueued(action, executeAfter);
            return false;
        }
        require(block.timestamp >= ready, "TIMELOCK_PENDING");
        delete pendingAfter[action];
        return true;
    }

    /// @notice Cancel a queued timelocked action (owner only).
    function cancelTimelock(bytes32 action) external onlyOwner {
        delete pendingAfter[action];
    }

    // =========================================================================
    //                              DEVICE ESCROW HELPER
    // =========================================================================

    /// @dev Associate the device collection with the vault once so it can receive the escrowed NFT.
    function _associateDeviceCollection(address deviceNft) internal {
        if (_associatedDevice[deviceNft]) return;
        int256 rc = associateToken(address(this), deviceNft);
        // 22 = SUCCESS, 194 = TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT (idempotent OK).
        require(
            uint256(rc) == SUCCESS || rc == int256(HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT),
            "DEVICE_ASSOCIATE_FAIL"
        );
        _associatedDevice[deviceNft] = true;
    }

    // Receive HTS-create refunds + reward/liquidity HBAR. (call{value:} on Hedera triggers this.)
    receive() external payable {}
}
