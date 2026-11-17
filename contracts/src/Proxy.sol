// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

// The USD₮0 implementation disables its own initialiser in its constructor, so
// it can only be used behind a proxy, as it is on every chain it is live on.
// This file only brings OpenZeppelin's proxy into the build.
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
