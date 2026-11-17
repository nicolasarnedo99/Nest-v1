// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Signed-transfer interface of the USD₮0 token (EIP-3009, bytes signature form).
interface IReceiveWithAuthorization {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external;
}

/// A stand-in for a tokenised share. It is not a security and tracks nothing:
/// it exists so the demo has something to deliver. Only the seller can mint.
contract StandInStock is ERC20 {
    address public immutable seller;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        seller = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == seller, "only seller");
        _mint(to, amount);
    }
}

/// Sells stand-in shares for the payment token at a fixed placeholder price.
///
/// The buyer never sends a transaction. They sign one EIP-3009 authorisation
/// that pays this contract, and anyone (a relayer) submits it here. Two things
/// keep the relayer honest:
///  - the token only accepts the authorisation when the payee is the caller,
///    so the signature is useless anywhere but in this contract;
///  - the authorisation nonce is the hash of the order, so the signature only
///    verifies for the company and order id the buyer signed for.
contract StockSeller {
    IReceiveWithAuthorization public immutable paymentToken;

    struct Listing {
        StandInStock stock;
        uint256 price; // payment-token units (6 decimals) for one whole share
    }

    mapping(uint8 => Listing) public listings;

    event Bought(address indexed buyer, uint8 indexed company, bytes32 indexed orderId, uint256 paid, uint256 shares);

    constructor(address paymentToken_, string[] memory names, string[] memory symbols, uint256[] memory prices) {
        require(names.length == symbols.length && names.length == prices.length, "length mismatch");
        paymentToken = IReceiveWithAuthorization(paymentToken_);
        for (uint8 i = 0; i < names.length; i++) {
            require(prices[i] > 0, "zero price");
            listings[i] = Listing(new StandInStock(names[i], symbols[i]), prices[i]);
        }
    }

    /// What the buyer agrees to. Everything here is covered by their signature:
    /// buyer, value and the validity window directly, company and orderId
    /// through the nonce.
    struct Order {
        uint8 company;
        bytes32 orderId;
        address buyer;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
    }

    /// The nonce a buyer must sign to place this exact order.
    function orderNonce(uint8 company, bytes32 orderId) public pure returns (bytes32) {
        return keccak256(abi.encode(company, orderId));
    }

    function buy(Order calldata order, bytes calldata signature) external returns (uint256 shares) {
        Listing storage listing = listings[order.company];
        require(address(listing.stock) != address(0), "unknown company");
        paymentToken.receiveWithAuthorization(
            order.buyer,
            address(this),
            order.value,
            order.validAfter,
            order.validBefore,
            orderNonce(order.company, order.orderId),
            signature
        );
        shares = (order.value * 1e18) / listing.price;
        listing.stock.mint(order.buyer, shares);
        emit Bought(order.buyer, order.company, order.orderId, order.value, shares);
    }
}
