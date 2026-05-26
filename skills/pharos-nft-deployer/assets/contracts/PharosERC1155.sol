// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC1155Receiver {
    function onERC1155Received(address operator, address from, uint256 id, uint256 value, bytes calldata data)
        external
        returns (bytes4);

    function onERC1155BatchReceived(
        address operator,
        address from,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external returns (bytes4);
}

/// @notice Self-contained ERC1155 for Pharos NFT deployer demos.
/// @dev Keeps deployment skills dependency-free; for audited production collections, review and adapt carefully.
contract PharosERC1155 {
    string public name;
    string public symbol;
    string private _uri;
    string public contractURI;
    address public owner;

    mapping(uint256 => mapping(address => uint256)) private _balances;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);
    event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values);
    event ApprovalForAll(address indexed account, address indexed operator, bool approved);
    event URI(string value, uint256 indexed id);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ContractURIUpdated(string newContractURI);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        string memory uri_,
        string memory contractURI_,
        address initialOwner_
    ) {
        require(bytes(name_).length > 0, "name required");
        require(bytes(symbol_).length > 0, "symbol required");
        require(initialOwner_ != address(0), "owner zero");
        name = name_;
        symbol = symbol_;
        _uri = uri_;
        contractURI = contractURI_;
        owner = initialOwner_;
        emit OwnershipTransferred(address(0), initialOwner_);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC165
            interfaceId == 0xd9b67a26 || // ERC1155
            interfaceId == 0x0e89341c; // ERC1155MetadataURI
    }

    function uri(uint256) external view returns (string memory) {
        return _uri;
    }

    function balanceOf(address account, uint256 id) public view returns (uint256) {
        require(account != address(0), "zero address");
        return _balances[id][account];
    }

    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids)
        external
        view
        returns (uint256[] memory batchBalances)
    {
        require(accounts.length == ids.length, "length mismatch");
        batchBalances = new uint256[](accounts.length);
        for (uint256 i = 0; i < accounts.length; i++) {
            batchBalances[i] = balanceOf(accounts[i], ids[i]);
        }
    }

    function setApprovalForAll(address operator, bool approved) external {
        require(operator != msg.sender, "self approval");
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address account, address operator) public view returns (bool) {
        return _operatorApprovals[account][operator];
    }

    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external {
        require(from == msg.sender || isApprovedForAll(from, msg.sender), "not authorized");
        _transfer(from, to, id, amount);
        require(_checkOnERC1155Received(from, to, id, amount, data), "unsafe recipient");
    }

    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes calldata data
    ) external {
        require(ids.length == amounts.length, "length mismatch");
        require(from == msg.sender || isApprovedForAll(from, msg.sender), "not authorized");
        require(to != address(0), "zero to");
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            uint256 amount = amounts[i];
            uint256 fromBalance = _balances[id][from];
            require(fromBalance >= amount, "insufficient balance");
            unchecked {
                _balances[id][from] = fromBalance - amount;
            }
            _balances[id][to] += amount;
        }
        emit TransferBatch(msg.sender, from, to, ids, amounts);
        require(_checkOnERC1155BatchReceived(from, to, ids, amounts, data), "unsafe recipient");
    }

    function mint(address to, uint256 id, uint256 amount) external onlyOwner {
        require(to != address(0), "zero to");
        _balances[id][to] += amount;
        emit TransferSingle(msg.sender, address(0), to, id, amount);
        emit URI(_uri, id);
        require(_checkOnERC1155Received(address(0), to, id, amount, ""), "unsafe recipient");
    }

    function mintBatch(address to, uint256[] calldata ids, uint256[] calldata amounts) external onlyOwner {
        require(to != address(0), "zero to");
        require(ids.length == amounts.length, "length mismatch");
        for (uint256 i = 0; i < ids.length; i++) {
            _balances[ids[i]][to] += amounts[i];
        }
        emit TransferBatch(msg.sender, address(0), to, ids, amounts);
        require(_checkOnERC1155BatchReceived(address(0), to, ids, amounts, ""), "unsafe recipient");
    }

    function setURI(string calldata newURI) external onlyOwner {
        _uri = newURI;
    }

    function setContractURI(string calldata newContractURI) external onlyOwner {
        contractURI = newContractURI;
        emit ContractURIUpdated(newContractURI);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "owner zero");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function _transfer(address from, address to, uint256 id, uint256 amount) internal {
        require(to != address(0), "zero to");
        uint256 fromBalance = _balances[id][from];
        require(fromBalance >= amount, "insufficient balance");
        unchecked {
            _balances[id][from] = fromBalance - amount;
        }
        _balances[id][to] += amount;
        emit TransferSingle(msg.sender, from, to, id, amount);
    }

    function _checkOnERC1155Received(address from, address to, uint256 id, uint256 amount, bytes memory data)
        internal
        returns (bool)
    {
        if (to.code.length == 0) {
            return true;
        }
        try IERC1155Receiver(to).onERC1155Received(msg.sender, from, id, amount, data) returns (bytes4 retval) {
            return retval == IERC1155Receiver.onERC1155Received.selector;
        } catch {
            return false;
        }
    }

    function _checkOnERC1155BatchReceived(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata amounts,
        bytes memory data
    ) internal returns (bool) {
        if (to.code.length == 0) {
            return true;
        }
        try IERC1155Receiver(to).onERC1155BatchReceived(msg.sender, from, ids, amounts, data) returns (bytes4 retval) {
            return retval == IERC1155Receiver.onERC1155BatchReceived.selector;
        } catch {
            return false;
        }
    }
}
