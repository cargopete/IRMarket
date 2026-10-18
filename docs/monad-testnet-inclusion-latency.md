# Note: block inclusion delay observed on Monad testnet

**Audience:** Monoracle / IRMarket developers (no prior knowledge of this project assumed).
**Purpose:** describe one behaviour we keep hitting on Monad testnet and ask whether it is
expected (testnet / RPC) or something we are doing wrong.

---

## 1. Background, in 30 seconds

- **IRMarket** is an options market on Monad. Its prices come from **Monoracle**, an on-chain
  price oracle.
- Monoracle works like this: a **provider** (in our deployment, a market-maker bot) posts a
  price quote on-chain by calling
  `submitQuote(baseToken, quoteToken, baseAmount, quoteAmount, expiryBlock)`.
  The quote locks collateral and stays **active** until `expiryBlock`; after that it can be
  settled and becomes the canonical price for that asset pair.
- Our bot is that provider. Roughly every 5 seconds it (a) reads the chain head with
  `eth_blockNumber`, then (b) sends a `submitQuote` transaction.

We are **not** using any L2 / rollup concepts here: this is a plain EVM chain and a plain
`eth_sendRawTransaction` flow. The bot talks to a normal HTTP/WS JSON-RPC endpoint.

---

## 2. What we observe

### 2.1 The read block and the inclusion block are far apart

The bot reads the head, builds a tx, sends it, and waits for the receipt. We observe that the
**block that finally includes the transaction is much later than the block number the bot read
just before sending**.

A concrete example (a "final settlement quote"):

```
 block 71,816,817   <- bot reads head here (decision time) and builds the tx
 block 71,816,819   <- the quote's own expiryBlock (2 blocks after the read)
 ...
 block 71,816,847   <- the tx is actually included here   (28 blocks AFTER the expiry)
```

- read -> inclusion delay: about **30 blocks**
- inclusion -> expiry overrun: **28 blocks**
- at Monad testnet's ~0.3 s block time that is roughly **9-10 seconds**

### 2.2 The delay is not constant

For the handful of reverted transactions we decoded from the same run, the "inclusion block
minus expiry block" was **3, 7 and 28 blocks** (roughly 1 s, 2 s and 9 s). So the delay
distribution is wide, not a fixed offset we can predict.

### 2.3 The downstream effect

The quote is only valid while `expiryBlock` is still in the future (see §4). When the tx is
included *after* that block, the contract rejects it. On Monad the **gas limit is charged**
even though the transaction reverts, so each rejected attempt costs the full 400,000 gas
(~0.04 MON).

---

## 3. Why we expected this to be fast

The bot reads the head and then immediately sends. On most EVM chains the transaction lands
within 1-2 blocks of that read. Here we routinely see up to ~30, with occasional much larger
gaps. The bot's own processing time is not the cause: the read happens milliseconds before the
send.

We do not know whether this is:
1. normal propagation / inclusion latency on Monad testnet,
2. specific to the RPC endpoint we use, or
3. an artifact of how we build/broadcast the transaction.

---

## 4. The exact code paths

**Contract side** (upstream Monoracle, consumed by us, not modified in this repo):

- `contracts/Monoracle.sol:167-211` — `submitQuote(...)`; the relevant guard is line **178**:

  ```solidity
  if (expiryBlock <= block.number) revert ExpiryMustBeFuture();
  ```

- `contracts/Monoracle.sol:143-149` — `afterVerificationWindow`: a quote can only be settled
  once `block.number > expiryBlock`.

**Bot side**:

- `bot/verifier.py:458-487` — `submit_quote()`:
  - line **459**: `block = self.w3.eth.block_number` (the read),
  - line **469-475**: `submitQuote(...)` is built and sent,
  - line **388**: `wait_for_transaction_receipt(...)`.
- `bot/verifier.py:632-637` — the loop decides when to send the final quote based on the head
  it just read.

So the relevant quantity is purely `inclusion_block - read_block`.

---

## 5. Evidence and links

| item | value |
|---|---|
| example transaction (reverted) | `0xb20d1ba0d96c6a6a1e227e592299ec724f93355558e99f4292d0dda0d031f49b` |
| tx explorer | https://testnet.monadscan.com/tx/0xb20d1ba0d96c6a6a1e227e592299ec724f93355558e99f4292d0dda0d031f49b |
| sending wallet (the bot / provider) | `0x5ceF21c2977470Fa4fBa3C6b87203268003Ef498` |
| wallet explorer | https://testnet.monadscan.com/address/0x5cef21c2977470fa4fba3c6b87203268003ef498 |
| oracle contract called (`submitQuote`) | `0x807321100748d75a618e508de214123CB77C9f4D` |
| oracle explorer | https://testnet.monadscan.com/address/0x807321100748d75a618e508de214123cb77c9f4d |
| market wrapper (staging) | `0x3BC2c78b50909307d0b51Efc0FE53ee2956ED551` |
| wrapper explorer | https://testnet.monadscan.com/address/0x3BC2c78b50909307d0b51Efc0FE53ee2956ED551 |

Decoded fields of that transaction:

| field | value |
|---|---|
| method | `submitQuote(address,address,uint256,uint256,uint32)` (selector `0x14a38ba6`) |
| `expiryBlock` argument | `71816819` |
| block included at | `71816847` |
| `receipt.status` | `0x0` (reverted) |
| `receipt.gasUsed` | `400000` (= the gas limit we sent) |
| market / asset | **NVDA / HKD** (staging round) |

---

## 6. What we would like to know

1. **Is this expected on Monad testnet?** i.e. is a ~10 s (30-block) inclusion delay within
   normal behaviour under load, or is it abnormal?
2. **Is it RPC-specific?** Would a different endpoint (the public
   `https://testnet-rpc.monad.xyz` vs. a paid provider) change the number? We can run a
   side-by-side comparison if that is useful.
3. **Does `block.number` inside execution equal the block that ordered the transaction?**
   We assume yes (standard EVM semantics), and that it is therefore the inclusion block, not
   the block the client read.
4. **Is there a recommended way to bound or reduce it?** e.g. a priority-fee mechanism, a
   transaction validity/deadline field, a specific RPC method, or a "submit and confirm at the
   next block" pattern.

We are happy to provide more samples, or to instrument the bot to log
`read_block` / `receipt.blockNumber` for every send so the distribution can be measured
properly.
