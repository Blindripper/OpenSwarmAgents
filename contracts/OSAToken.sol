// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title OSA Token
/// @notice Fixed-supply experimental token for OpenSwarmAgents.
/// @dev Draft contract. Do not deploy with real funds before independent audit.
contract OSAToken is ERC20, Ownable2Step {
    uint256 public constant TOTAL_SUPPLY = 10_000_000_000 ether;

    constructor(address treasury) ERC20("OpenSwarmAgents", "OSA") Ownable(treasury) {
        require(treasury != address(0), "OSA: treasury zero");
        _mint(treasury, TOTAL_SUPPLY);
    }
}

/// @title OSA Work Rewards Distributor
/// @notice Distributes up to 5B OSA over three years to wallet accounts that
///         perform eligible agent work in the OSA network.
/// @dev The owner publishes cumulative Merkle roots for scored reward epochs.
///      Users claim the difference between their previous claimed amount and
///      their latest cumulative allocation. This keeps per-agent scoring off
///      chain while claims remain auditable and linearly emission-capped.
contract OSAWorkRewardsDistributor is Ownable2Step {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    uint256 public immutable rewardStart;
    uint256 public immutable rewardEnd;

    uint256 public constant EXPECTED_REWARD_FUNDING = 5_000_000_000 ether;
    uint256 public constant REWARD_DURATION = 1095 days;

    bytes32 public merkleRoot;
    string public merkleMetadataURI;
    uint256 public rootNonce;
    uint256 public totalClaimed;

    mapping(address account => uint256 amount) public claimed;

    event MerkleRootUpdated(uint256 indexed rootNonce, bytes32 indexed merkleRoot, string metadataURI);
    event RewardsClaimed(address indexed account, uint256 amount, uint256 cumulativeAmount);

    constructor(IERC20 osaToken, address owner_, uint256 startTimestamp) Ownable(owner_) {
        require(address(osaToken) != address(0), "OSA: token zero");
        require(owner_ != address(0), "OSA: owner zero");
        require(startTimestamp > 0, "OSA: start zero");
        token = osaToken;
        rewardStart = startTimestamp;
        rewardEnd = startTimestamp + REWARD_DURATION;
    }

    function setMerkleRoot(bytes32 nextRoot, string calldata metadataURI) external onlyOwner {
        require(nextRoot != bytes32(0), "OSA: root zero");
        merkleRoot = nextRoot;
        merkleMetadataURI = metadataURI;
        rootNonce += 1;
        emit MerkleRootUpdated(rootNonce, nextRoot, metadataURI);
    }

    function maxReleased() public view returns (uint256) {
        if (block.timestamp <= rewardStart) return 0;
        if (block.timestamp >= rewardEnd) return EXPECTED_REWARD_FUNDING;
        return (EXPECTED_REWARD_FUNDING * (block.timestamp - rewardStart)) / REWARD_DURATION;
    }

    function claim(uint256 cumulativeAmount, bytes32[] calldata proof) external {
        require(cumulativeAmount > claimed[msg.sender], "OSA: nothing claimable");
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, cumulativeAmount))));
        require(MerkleProof.verifyCalldata(proof, merkleRoot, leaf), "OSA: invalid proof");

        uint256 amount = cumulativeAmount - claimed[msg.sender];
        require(totalClaimed + amount <= maxReleased(), "OSA: rewards locked");

        claimed[msg.sender] = cumulativeAmount;
        totalClaimed += amount;
        token.safeTransfer(msg.sender, amount);

        emit RewardsClaimed(msg.sender, amount, cumulativeAmount);
    }
}
