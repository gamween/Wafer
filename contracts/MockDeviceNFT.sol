// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@hiero-ledger/hiero-contracts/token-service/HederaTokenService.sol";
import "@hiero-ledger/hiero-contracts/token-service/IHederaTokenService.sol";
import "@hiero-ledger/hiero-contracts/token-service/KeyHelper.sol";
import "@hiero-ledger/hiero-contracts/token-service/ExpiryHelper.sol";
import "@hiero-ledger/hiero-contracts/common/HederaResponseCodes.sol";

/**
 * @title MockDeviceNFT
 * @notice A standalone HTS NFT collection standing in for a DePIN device-NFT (e.g. a Helium
 *         Hotspot). The operator mints a serial and escrows it into the WaferVault as collateral
 *         at finance; the vault returns it on Repaid or wipes/retains it on Default.
 *
 * INTEGRATION with WaferVault.financeClaim:
 *   1. operator calls `mintTo(operator, ...)` here -> a serial is minted to the operator,
 *   2. operator associates the collection on the vault is handled by the vault (financeClaim
 *      calls associateToken on itself for the device collection),
 *   3. operator pre-approves the vault for that serial via the HTS allowance/ERC-721 facade
 *      (the front calls approve(vault, serial) on this token's EVM address),
 *   4. vault.financeClaim pulls operator -> vault with transferNFT,
 *   5. on Repaid the vault transfers vault -> operator; on Default the vault wipes (this collection
 *      grants the vault... no — the WIPE key here is THIS contract; for the demo, default retains
 *      the NFT in the vault, the vault's wipe is best-effort and tolerated to fail).
 *
 * The collection is created with supply + wipe keys = this contract so the demo can mint freely.
 * To let the vault's `wipeTokenAccountNFT` succeed on default, deploy with the vault as an extra
 * wipe key holder is NOT possible (HTS keys are single-holder here); the vault's default path
 * tolerates a wipe failure (the credit write-down is the on-chain truth either way).
 */
contract MockDeviceNFT is HederaTokenService, KeyHelper, ExpiryHelper {
    uint256 internal constant SUCCESS = uint256(int256(HederaResponseCodes.SUCCESS)); // 22
    int64 internal constant AUTO_RENEW_PERIOD = 7776000; // 90 days

    address public immutable deployer;
    address public token; // the HTS NFT collection EVM address
    uint64 public minted;

    event CollectionCreated(address indexed token, string name, string symbol);
    event DeviceMinted(address indexed to, int64 serial, bytes32 metaHash);

    constructor() {
        deployer = msg.sender;
    }

    /**
     * @notice Create the HTS NFT collection. payable — attach ~30 HBAR (excess refunded to this
     *         contract by the precompile). Supply + wipe keys = this contract.
     */
    function createCollection(string memory name, string memory symbol)
        external
        payable
        returns (address created)
    {
        require(token == address(0), "ALREADY_CREATED");

        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](2);
        keys[0] = getSingleKey(KeyType.SUPPLY, KeyValueType.CONTRACT_ID, address(this));
        keys[1] = getSingleKey(KeyType.WIPE, KeyValueType.CONTRACT_ID, address(this));

        IHederaTokenService.HederaToken memory t;
        t.name = name;
        t.symbol = symbol;
        t.treasury = address(this);
        t.memo = "Wafer mock device NFT";
        t.tokenSupplyType = false; // INFINITE
        t.maxSupply = 0;
        t.freezeDefault = false;
        t.tokenKeys = keys;
        t.expiry = createAutoRenewExpiry(address(this), AUTO_RENEW_PERIOD);

        (bool ok, bytes memory result) = precompileAddress.call{value: address(this).balance}(
            abi.encodeWithSelector(IHederaTokenService.createNonFungibleToken.selector, t)
        );
        int256 rc;
        (rc, created) = ok ? abi.decode(result, (int32, address)) : (int256(HederaResponseCodes.UNKNOWN), address(0));
        require(uint256(rc) == SUCCESS, "CREATE_DEVICE_FAIL");

        token = created;
        emit CollectionCreated(created, name, symbol);
    }

    /**
     * @notice Mint a device serial and deliver it to `to` (the operator). `to` MUST have associated
     *         the collection first (IHRC719 from the front).
     * @param to        operator receiving the device-NFT
     * @param metaHash  32-byte metadata hash (device id / location commitment)
     */
    function mintTo(address to, bytes32 metaHash) external returns (int64 serial) {
        require(token != address(0), "NO_COLLECTION");

        bytes[] memory metadata = new bytes[](1);
        metadata[0] = abi.encodePacked(metaHash);
        (int256 mrc, , int64[] memory serials) = mintToken(token, 0, metadata);
        require(uint256(mrc) == SUCCESS, "MINT_DEVICE_FAIL");
        serial = serials[0];
        minted++;

        // Deliver from treasury (this contract) to the operator.
        int256 trc = transferNFT(token, address(this), to, serial);
        require(uint256(trc) == SUCCESS, "DELIVER_DEVICE_FAIL");

        emit DeviceMinted(to, serial, metaHash);
    }

    /// @notice Wipe a serial from `account` (e.g. liquidate retained collateral after a default).
    function wipe(address account, int64 serial) external {
        require(msg.sender == deployer, "NOT_DEPLOYER");
        require(token != address(0), "NO_COLLECTION");
        int64[] memory serials = new int64[](1);
        serials[0] = serial;
        int256 rc = wipeTokenAccountNFT(token, account, serials);
        require(uint256(rc) == SUCCESS, "WIPE_DEVICE_FAIL");
    }

    receive() external payable {}
}
