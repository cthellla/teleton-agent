# SDK Suggestions — Plugin Developer Wishlist

Feedback from building 26+ plugins (183+ tools) against SDK v1.0.0.
These suggestions target pain points shared across multiple plugins.

---

## Priority 1: High Impact

### `sdk.ton.sendRaw(to, value, body, opts?)`

**Problem**: Every plugin that interacts with a custom smart contract must duplicate ~30 lines of wallet boilerplate: read `wallet.json`, derive keypair, create `WalletContractV5R1`, get seqno, build internal message, sendTransfer with SendMode flags. This is repeated in gaspump, x1000, sbt, stormtrade, groypfi — any plugin with custom opcodes.

**Proposal**:
```js
await sdk.ton.sendRaw(tokenAddress, "1.5", bodyCell, {
  bounce: true,       // default true
  stateInit: null,    // optional, for deploy
});
// Returns: { seqno, walletAddress, hash? }
```

- Signs automatically from the agent wallet
- Manages seqno internally (prevents collisions on rapid calls)
- Uses `SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS` by default
- Accepts a Cell body (from `@ton/core`)

**Plugins that benefit**: x1000, gaspump, sbt, stormtrade, groypfi, evaa — all 7 on-chain plugins.

**Impact**: Eliminates `getAgentWallet()` pattern from every plugin. Wallet management stays centralized in the agent. Plugins only build the Cell body.

---

### `sdk.ton.getAddressObject()`

**Problem**: `sdk.ton.getAddress()` returns a string. But Cell builders need an `Address` object (from `@ton/core`) for `storeAddress()`. Plugins must `Address.parse(sdk.ton.getAddress())` or keep a separate wallet loading path just to get the native object.

**Proposal**:
```js
const addr = sdk.ton.getAddressObject();
// Returns: Address instance from @ton/core
// Can be used directly in beginCell().storeAddress(addr)
```

**Plugins that benefit**: x1000, gaspump, sbt — any plugin that builds Cell bodies containing the agent's address.

---

### `sdk.ton.cell(fn)` / `sdk.ton.beginCell()`

**Problem**: Every on-chain plugin needs `@ton/core`'s `beginCell()`. Since `@ton/core` is CJS, plugins must use the `createRequire(realpathSync(process.argv[1]))` workaround — 3 lines of boilerplate that are easy to get wrong and confusing for new plugin authors.

**Proposal** (option A — expose builder):
```js
const body = sdk.ton.beginCell()
  .storeUint(0x94826557, 32)
  .storeUint(0, 64)
  .endCell();
```

**Proposal** (option B — callback helper):
```js
const body = sdk.ton.cell(b => b
  .storeUint(0x94826557, 32)
  .storeUint(0, 64)
);
```

Option A is simpler and more flexible (plugin authors already know the `beginCell()` API from TON docs).

**Plugins that benefit**: All 7 on-chain plugins. Also makes the SDK self-contained — no `createRequire` needed for basic Cell building.

---

## Priority 2: Medium Impact

### `sdk.ton.sendRawBatch(messages[])`

**Problem**: Some operations need multiple messages in one transaction (e.g., deploy + initial buy, or batch claims). Currently plugins build the messages array manually.

**Proposal**:
```js
await sdk.ton.sendRawBatch([
  { to: factoryAddr, value: "1.1", body: deployBody, bounce: false, stateInit },
  { to: tokenAddr, value: "0.5", body: buyBody },
]);
```

**Plugins that benefit**: gaspump (deploy + register), x1000 (potential future batch ops), stormtrade (multi-position).

---

### `sdk.ton.toNano(amount)` / `sdk.ton.fromNano(amount)` — already exists but...

**Problem**: `sdk.ton.toNano()` exists but returns a string. On-chain Cell builders need `bigint` for `storeCoins()`. Plugins end up importing `toNano` from `@ton/ton` directly anyway.

**Proposal**: Ensure `sdk.ton.toNano()` returns `bigint` (or add `sdk.ton.toNanoBigInt()`).

---

### `sdk.ton.runGetMethod(address, method, args?)`

**Problem**: Some plugins need to call GET methods on contracts (e.g., `get_jetton_data`, `get_wallet_address`, custom methods). Currently they must create their own `TonClient` instance.

**Proposal**:
```js
const result = await sdk.ton.runGetMethod(contractAddr, "get_jetton_data");
// Returns: parsed stack (numbers, addresses, cells)
```

**Plugins that benefit**: gaspump, x1000, giftindex (on-chain order book reads), any plugin querying contract state.

---

## Priority 3: Nice to Have

### `sdk.ton.waitForTransaction(address, seqno, opts?)`

**Problem**: After sending a transaction, plugins tell users "check after ~15 seconds". There's no way to confirm the transaction landed. Every plugin repeats this pattern.

**Proposal**:
```js
const confirmed = await sdk.ton.waitForTransaction(walletAddr, seqno, {
  timeout: 30000,  // ms, default 60s
  interval: 3000,  // polling interval
});
// Returns: { success: boolean, hash?, lt? }
```

**Plugins that benefit**: All on-chain plugins. Enables reliable "transaction confirmed" responses.

---

### `sdk.ton.estimateGas(to, value, body)`

**Problem**: Plugins hardcode gas amounts (0.05, 0.1, 0.15 TON). These are estimates that might be too low or wasteful as the network evolves.

**Proposal**:
```js
const gas = await sdk.ton.estimateGas(tokenAddr, "0", claimBody);
// Returns: estimated TON needed (string)
```

---

### `sdk.ton.constants`

**Problem**: Plugins import `SendMode` from `@ton/core` just to use `SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS`. If `sendRaw` is implemented, this becomes less needed — but useful as a general reference.

**Proposal**:
```js
sdk.ton.constants.SendMode.PAY_GAS_SEPARATELY  // 1
sdk.ton.constants.SendMode.IGNORE_ERRORS        // 2
sdk.ton.constants.JETTON_TRANSFER_OP            // 0x0f8a7ea5
```

---

## Summary

| Method | Priority | Plugins impacted | Boilerplate eliminated |
|--------|----------|-----------------|----------------------|
| `sendRaw()` | P1 | 7 (all on-chain) | ~30 lines per operation |
| `getAddressObject()` | P1 | 3+ | `Address.parse()` calls |
| `beginCell()` | P1 | 7 (all on-chain) | `createRequire` workaround |
| `sendRawBatch()` | P2 | 3 | Manual message array building |
| `toNano()` as bigint | P2 | 7 | Double import of toNano |
| `runGetMethod()` | P2 | 4+ | Manual TonClient creation |
| `waitForTransaction()` | P3 | 7 | "Check after 15s" pattern |
| `estimateGas()` | P3 | 7 | Hardcoded gas amounts |
| `constants` | P3 | 7 | SendMode/opcode imports |

**The top 3 (`sendRaw` + `getAddressObject` + `beginCell`) together would eliminate the need for plugins to ever touch `wallet.json`, `createRequire`, or `@ton/core` imports directly.** Plugin deploy.js files would shrink from ~200 lines to ~50 lines.
