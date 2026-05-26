// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Disposable helper for uniform and variable batch transfers on Pharos.
/// @dev Designed for skill-generated airdrops. It has no owner and keeps no intended balance.
contract PharosBatchDistributor {
    event NativeTransfer(address indexed recipient, uint256 amount);
    event ERC20Transfer(address indexed token, address indexed recipient, uint256 amount);
    event BatchTransferUniform(address indexed sender, uint256 count, uint256 amount, uint256 total);
    event BatchTransferVariable(address indexed sender, uint256 count, uint256 total);
    event ERC20BatchTransferUniform(address indexed sender, address indexed token, uint256 count, uint256 amount, uint256 total);
    event ERC20BatchTransferVariable(address indexed sender, address indexed token, uint256 count, uint256 total);

    function batchTransferUniform(address[] calldata recipients, uint256 amount) external payable {
        uint256 count = recipients.length;
        require(count > 0, "no recipients");
        require(amount > 0, "zero amount");
        uint256 total = count * amount;
        require(msg.value == total, "value mismatch");

        for (uint256 i = 0; i < count; i++) {
            address recipient = recipients[i];
            require(recipient != address(0), "zero recipient");
            (bool ok,) = recipient.call{value: amount}("");
            require(ok, "native transfer failed");
            emit NativeTransfer(recipient, amount);
        }

        emit BatchTransferUniform(msg.sender, count, amount, total);
    }

    function batchTransfer(address[] calldata recipients, uint256[] calldata amounts) external payable {
        uint256 count = recipients.length;
        require(count > 0, "no recipients");
        require(count == amounts.length, "length mismatch");

        uint256 total;
        for (uint256 i = 0; i < count; i++) {
            total += amounts[i];
        }
        require(msg.value == total, "value mismatch");

        for (uint256 i = 0; i < count; i++) {
            address recipient = recipients[i];
            uint256 amount = amounts[i];
            require(recipient != address(0), "zero recipient");
            require(amount > 0, "zero amount");
            (bool ok,) = recipient.call{value: amount}("");
            require(ok, "native transfer failed");
            emit NativeTransfer(recipient, amount);
        }

        emit BatchTransferVariable(msg.sender, count, total);
    }

    function batchTransferERC20Uniform(address token, address[] calldata recipients, uint256 amount) external {
        require(token != address(0), "zero token");
        uint256 count = recipients.length;
        require(count > 0, "no recipients");
        require(amount > 0, "zero amount");
        uint256 total = count * amount;
        IERC20 erc20 = IERC20(token);

        for (uint256 i = 0; i < count; i++) {
            address recipient = recipients[i];
            require(recipient != address(0), "zero recipient");
            require(erc20.transferFrom(msg.sender, recipient, amount), "erc20 transfer failed");
            emit ERC20Transfer(token, recipient, amount);
        }

        emit ERC20BatchTransferUniform(msg.sender, token, count, amount, total);
    }

    function batchTransferERC20(address token, address[] calldata recipients, uint256[] calldata amounts) external {
        require(token != address(0), "zero token");
        uint256 count = recipients.length;
        require(count > 0, "no recipients");
        require(count == amounts.length, "length mismatch");
        IERC20 erc20 = IERC20(token);

        uint256 total;
        for (uint256 i = 0; i < count; i++) {
            address recipient = recipients[i];
            uint256 amount = amounts[i];
            require(recipient != address(0), "zero recipient");
            require(amount > 0, "zero amount");
            total += amount;
            require(erc20.transferFrom(msg.sender, recipient, amount), "erc20 transfer failed");
            emit ERC20Transfer(token, recipient, amount);
        }

        emit ERC20BatchTransferVariable(msg.sender, token, count, total);
    }

    receive() external payable {}
}
