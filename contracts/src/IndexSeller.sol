// SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "./StockSeller.sol";

/// Sells stand-in shares like StockSeller, for any number of companies.
///
/// The seller is also the share contract: one ERC-1155 balance per company,
/// token id = company id, so listing a company is a storage write instead of a
/// contract deployment. The owner adds listings in batches after deployment.
/// The buy path and its security model are StockSeller's (see there).
contract IndexSeller is ERC1155, Ownable {
    IReceiveWithAuthorization public immutable paymentToken;

    struct Listing {
        uint256 price; // payment-token units (6 decimals) for one whole share; 0 = not listed
        string name;
        string symbol;
    }

    mapping(uint16 => Listing) public listings;

    event Listed(uint16 indexed company, string name, string symbol, uint256 price);
    event Repriced(uint16 indexed company, uint256 price);
    event Bought(address indexed buyer, uint16 indexed company, bytes32 indexed orderId, uint256 paid, uint256 shares);

    constructor(address paymentToken_) ERC1155("") {
        paymentToken = IReceiveWithAuthorization(paymentToken_);
    }

    function list(uint16[] calldata ids, string[] calldata names, string[] calldata symbols, uint256[] calldata prices)
        external
        onlyOwner
    {
        require(ids.length == names.length && ids.length == symbols.length && ids.length == prices.length, "length mismatch");
        for (uint256 i = 0; i < ids.length; i++) {
            require(prices[i] > 0, "zero price");
            // A relisted id would change what existing holders' balances mean.
            require(listings[ids[i]].price == 0, "already listed");
            listings[ids[i]] = Listing(prices[i], names[i], symbols[i]);
            emit Listed(ids[i], names[i], symbols[i], prices[i]);
        }
    }

    function setPrice(uint16 company, uint256 price) external onlyOwner {
        require(listings[company].price != 0, "unknown company");
        require(price > 0, "zero price");
        listings[company].price = price;
        emit Repriced(company, price);
    }

    /// Same fields as StockSeller.Order, with a uint16 company.
    struct Order {
        uint16 company;
        bytes32 orderId;
        address buyer;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
    }

    /// abi.encode pads both uint8 and uint16 to 32 bytes, so for ids below 256
    /// this equals StockSeller.orderNonce.
    function orderNonce(uint16 company, bytes32 orderId) public pure returns (bytes32) {
        return keccak256(abi.encode(company, orderId));
    }

    function buy(Order calldata order, bytes calldata signature) external returns (uint256 shares) {
        uint256 price = listings[order.company].price;
        require(price != 0, "unknown company");
        paymentToken.receiveWithAuthorization(
            order.buyer,
            address(this),
            order.value,
            order.validAfter,
            order.validBefore,
            orderNonce(order.company, order.orderId),
            signature
        );
        shares = (order.value * 1e18) / price;
        // A buyer with code must accept ERC-1155 (Simple7702Account does), or the buy reverts and nothing is paid.
        _mint(order.buyer, order.company, shares, "");
        emit Bought(order.buyer, order.company, order.orderId, order.value, shares);
    }
}
