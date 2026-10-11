/**
 * An in-process Solana JSON-RPC server with canned accounts, for tests and scripts/play-ui.mjs
 * (copied from FABLE, extended for FYPAD's fee flow). It plays the parts of pump.fun FYPAD relies on:
 *  - create_v2 creates the mint (Token-2022, name + ticker in its data) and the bonding curve
 *    (creator from the instruction);
 *  - update_fee_shares_v2 writes the SharingConfig and makes it the curve's creator;
 *  - sweep_creator_fee moves the fee waiting on the curve into the creator vault;
 *  - distribute_creator_fees_v2 pays the sharing config's vault out to its shareholders by bps;
 *  - collect_creator_fee pays a creator's own vault to the creator.
 * Every landed transaction keeps real pre/post balances (fee 5000 lamports to the payer), and
 * getSignaturesForAddress lists them, so FYPAD's distribution scanner reads it like the chain.
 * Signatures are verified with ed25519: an unsigned or wrongly signed transaction is refused.
 * Control (POST /__control): {"failNext": true} next tx fails on chain, {"dropNext": true} never
 * lands, {"accrue": {"mint": "...", "lamports": 123}} adds creator fees waiting on that coin's curve
 * (what trades do), {"advance": n} moves the slot forward.
 *
 *   node tests/fake-rpc.ts [port]     -> prints {"url": "..."} and serves until killed (default port 8919)
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";

export interface FakeAccount {
  lamports: number;
  owner: string;
  data?: Buffer;
}

export interface FakeTx {
  signature: string;
  raw: Buffer;
  err: unknown;
  slot: number;
  accountKeys: string[];
  landed: boolean;
  pre: number[];
  post: number[];
  time: number;
}

export interface FakeState {
  slot: number;
  blockhash: string;
  accounts: Map<string, FakeAccount>;
  largest: Map<string, { address: string; amount: bigint; decimals: number }[]>;
  supply: Map<string, { amount: bigint; decimals: number }>;
  sent: FakeTx[];
  calls: string[];
  failNext: boolean;
  dropNext: boolean;
}

export const SYSTEM = "11111111111111111111111111111111";
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const FEES = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";
const T22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const CREATE_V2 = Buffer.from([214, 144, 76, 236, 95, 139, 49, 180]);
const UPDATE_SHARES_V2 = Buffer.from([111, 251, 49, 6, 78, 78, 106, 18]);
const SWEEP = Buffer.from([32, 246, 191, 52, 8, 201, 73, 186]);
const DISTRIBUTE_V2 = Buffer.from([255, 203, 19, 79, 244, 68, 8, 159]);
const COLLECT = Buffer.from([20, 22, 86, 123, 198, 28, 219, 132]);
const CURVE_DISC = Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]);
const RENT = 890_880;
const FEE = 5000;

export function tokenAccountData(mint: string, owner: string, amount: bigint): Buffer {
  const b = Buffer.alloc(165);
  Buffer.from(bs58.decode(mint)).copy(b, 0);
  Buffer.from(bs58.decode(owner)).copy(b, 32);
  b.writeBigUInt64LE(amount, 64);
  b[108] = 1;
  return b;
}

export function mintData(decimals: number, supply: bigint): Buffer {
  const b = Buffer.alloc(82);
  b.writeBigUInt64LE(supply, 36);
  b[44] = decimals;
  b[45] = 1;
  return b;
}

export function newState(): FakeState {
  return { slot: 1000, blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", accounts: new Map(), largest: new Map(), supply: new Map(), sent: [], calls: [], failNext: false, dropNext: false };
}

function encodeAccount(a: FakeAccount | undefined) {
  if (!a) return null;
  const data = a.data ?? Buffer.alloc(0);
  return { data: [data.toString("base64"), "base64"], executable: false, lamports: a.lamports, owner: a.owner, rentEpoch: 0, space: data.length };
}

const pda = (seeds: Buffer[], program: string) => PublicKey.findProgramAddressSync(seeds, new PublicKey(program))[0].toBase58();
export const curveOf = (mint: string) => pda([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], PUMP);
export const vaultOf = (creator: string) => pda([Buffer.from("creator-vault"), new PublicKey(creator).toBuffer()], PUMP);
export const sharingOf = (mint: string) => pda([Buffer.from("sharing-config"), new PublicKey(mint).toBuffer()], FEES);

function addLamports(state: FakeState, address: string, delta: number) {
  const a = state.accounts.get(address);
  if (a) a.lamports += delta;
  else state.accounts.set(address, { lamports: delta, owner: SYSTEM });
}

/** Fees from trades: added to the creator fee waiting on the curve (BondingCurve offset 125). */
export function accrue(state: FakeState, mint: string, lamports: number) {
  const curve = state.accounts.get(curveOf(mint));
  if (!curve?.data) throw new Error("no curve for this mint");
  curve.data.writeBigUInt64LE(curve.data.readBigUInt64LE(125) + BigInt(lamports), 125);
  curve.lamports += lamports;
}

/** Applies the pump.fun effects of a landed transaction to the fake ledger. */
function execute(state: FakeState, tx: VersionedTransaction, keys: string[]) {
  for (const ix of tx.message.compiledInstructions) {
    const program = keys[ix.programIdIndex];
    const data = Buffer.from(ix.data);
    const acc = (n: number) => keys[ix.accountKeyIndexes[n]];
    const disc = data.subarray(0, 8);
    if (program === PUMP && disc.equals(CREATE_V2)) {
      let o = 8;
      const s = () => {
        const n = data.readUInt32LE(o);
        const v = data.subarray(o + 4, o + 4 + n).toString("utf8");
        o += 4 + n;
        return v;
      };
      const name = s();
      const symbol = s();
      const uri = s();
      const creator = data.subarray(o, o + 32);
      const mint = acc(0);
      const curve = acc(2);
      state.accounts.set(mint, { lamports: 1_500_000, owner: T22, data: Buffer.concat([Buffer.alloc(166), Buffer.from(name), Buffer.from(symbol), Buffer.from(uri)]) });
      const c = Buffer.alloc(151);
      CURVE_DISC.copy(c, 0);
      c.writeBigUInt64LE(BigInt(1_073_000_000_000_000), 8);
      c.writeBigUInt64LE(BigInt(30_000_000_000), 16);
      c.writeBigUInt64LE(BigInt(793_100_000_000_000), 24);
      creator.copy(c, 49);
      state.accounts.set(curve, { lamports: 2_000_000, owner: PUMP, data: c });
      addLamports(state, keys[0], -22_000_000);
    }
    if (program === FEES && disc.equals(UPDATE_SHARES_V2)) {
      const mint = acc(4);
      const admin = acc(2);
      const sc = sharingOf(mint);
      const n = data.readUInt32LE(8);
      const holders = data.subarray(12, 12 + n * 34);
      const b = Buffer.concat([Buffer.alloc(8), Buffer.from([255, 2, 1]), new PublicKey(mint).toBuffer(), new PublicKey(admin).toBuffer(), Buffer.from([1]), data.subarray(8, 12), holders]);
      state.accounts.set(sc, { lamports: 8_000_000, owner: FEES, data: b });
      const cur = state.accounts.get(curveOf(mint));
      if (cur?.data) new PublicKey(sc).toBuffer().copy(cur.data, 49);
    }
    if (program === PUMP && disc.equals(SWEEP)) {
      const curve = state.accounts.get(acc(7));
      const vault = acc(9);
      if (curve?.data && curve.data.length >= 133) {
        const waiting = Number(curve.data.readBigUInt64LE(125));
        if (waiting > 0) {
          curve.data.writeBigUInt64LE(BigInt(0), 125);
          curve.lamports -= waiting;
          if (!state.accounts.has(vault)) state.accounts.set(vault, { lamports: RENT, owner: SYSTEM });
          addLamports(state, vault, waiting);
        }
      }
    }
    if (program === PUMP && disc.equals(DISTRIBUTE_V2)) {
      const sc = state.accounts.get(acc(3));
      const vault = state.accounts.get(acc(4));
      if (sc?.data && vault && vault.lamports > RENT) {
        const amount = vault.lamports - RENT;
        let o = 8 + 3 + 32 + 32 + 1;
        const n = sc.data.readUInt32LE(o);
        o += 4;
        let paid = 0;
        for (let k = 0; k < n; k++) {
          const holder = new PublicKey(sc.data.subarray(o, o + 32)).toBase58();
          const bps = sc.data.readUInt16LE(o + 32);
          o += 34;
          const share = Math.floor((amount * bps) / 10_000);
          addLamports(state, holder, share);
          paid += share;
        }
        vault.lamports -= paid;
      }
    }
    if (program === PUMP && disc.equals(COLLECT)) {
      const creator = acc(0);
      const vault = state.accounts.get(acc(1));
      if (vault && vault.lamports > RENT) {
        const amount = vault.lamports - RENT;
        vault.lamports = RENT;
        addLamports(state, creator, amount);
      }
    }
  }
}

type Params = unknown[];

export function answer(state: FakeState, method: string, params: Params): { result?: unknown; error?: { code: number; message: string } } {
  state.calls.push(method);
  const context = { slot: state.slot, apiVersion: "2.2.0" };
  switch (method) {
    case "getHealth":
      return { result: "ok" };
    case "getSlot":
    case "getBlockHeight":
      return { result: state.slot };
    case "getBalance":
      return { result: { context, value: state.accounts.get(String(params[0]))?.lamports ?? 0 } };
    case "getAccountInfo":
      return { result: { context, value: encodeAccount(state.accounts.get(String(params[0]))) } };
    case "getMultipleAccounts":
      return { result: { context, value: (params[0] as string[]).map((k) => encodeAccount(state.accounts.get(k))) } };
    case "getTokenAccountBalance": {
      const a = state.accounts.get(String(params[0]));
      if (!a?.data) return { error: { code: -32602, message: "Invalid param: could not find account" } };
      const amount = a.data.readBigUInt64LE(64);
      return { result: { context, value: { amount: amount.toString(), decimals: 6, uiAmount: Number(amount) / 1e6, uiAmountString: String(Number(amount) / 1e6) } } };
    }
    case "getTokenSupply": {
      const s = state.supply.get(String(params[0]));
      if (!s) return { error: { code: -32602, message: "Invalid param: not a Token mint" } };
      return { result: { context, value: { amount: s.amount.toString(), decimals: s.decimals, uiAmount: Number(s.amount) / 10 ** s.decimals, uiAmountString: String(Number(s.amount) / 10 ** s.decimals) } } };
    }
    case "getTokenLargestAccounts":
      return { result: { context, value: (state.largest.get(String(params[0])) ?? []).map((l) => ({ address: l.address, amount: l.amount.toString(), decimals: l.decimals, uiAmount: 0, uiAmountString: "0" })) } };
    case "getTokenAccountsByOwner":
    case "getProgramAccounts":
      return { result: method === "getProgramAccounts" ? [] : { context, value: [] } };
    case "getLatestBlockhash":
      return { result: { context, value: { blockhash: state.blockhash, lastValidBlockHeight: state.slot + 150 } } };
    case "getSignaturesForAddress": {
      const address = String(params[0]);
      const opts = (params[1] ?? {}) as { until?: string; limit?: number };
      const out: { signature: string; slot: number; err: unknown; memo: null; blockTime: number; confirmationStatus: string }[] = [];
      for (const t of [...state.sent].reverse()) {
        if (!t.landed || !t.accountKeys.includes(address)) continue;
        if (opts.until && t.signature === opts.until) break;
        out.push({ signature: t.signature, slot: t.slot, err: t.err, memo: null, blockTime: t.time, confirmationStatus: "confirmed" });
        if (out.length >= (opts.limit ?? 1000)) break;
      }
      return { result: out };
    }
    case "sendTransaction": {
      const raw = Buffer.from(String(params[0]), "base64");
      let tx: VersionedTransaction;
      try {
        tx = VersionedTransaction.deserialize(raw);
      } catch {
        return { error: { code: -32602, message: "failed to deserialize transaction" } };
      }
      const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
      const msg = tx.message.serialize();
      for (let i = 0; i < tx.message.header.numRequiredSignatures; i++) {
        if (!nacl.sign.detached.verify(msg, tx.signatures[i], bs58.decode(keys[i]))) return { error: { code: -32003, message: "Transaction signature verification failure" } };
      }
      const signature = bs58.encode(tx.signatures[0]);
      if (state.sent.some((t) => t.signature === signature)) return { result: signature };
      const fail = state.failNext;
      const drop = state.dropNext;
      state.failNext = false;
      state.dropNext = false;
      state.slot += 1;
      const pre = keys.map((k) => state.accounts.get(k)?.lamports ?? 0);
      if (!drop) {
        addLamports(state, keys[0], -FEE);
        if (!fail) execute(state, tx, keys);
      }
      const post = keys.map((k) => state.accounts.get(k)?.lamports ?? 0);
      state.sent.push({ signature, raw, err: fail ? { InstructionError: [2, { Custom: 6002 }] } : null, slot: state.slot, accountKeys: keys, landed: !drop, pre, post, time: Math.floor(Date.now() / 1000) });
      return { result: signature };
    }
    case "getSignatureStatuses": {
      const sigs = params[0] as string[];
      return {
        result: {
          context,
          value: sigs.map((s) => {
            const t = state.sent.find((x) => x.signature === s && x.landed);
            return t ? { slot: t.slot, confirmations: 1, err: t.err, status: t.err ? { Err: t.err } : { Ok: null }, confirmationStatus: "confirmed" } : null;
          }),
        },
      };
    }
    case "getTransaction": {
      const t = state.sent.find((x) => x.signature === String(params[0]) && x.landed);
      if (!t) return { result: null };
      const tx = VersionedTransaction.deserialize(t.raw);
      return {
        result: {
          slot: t.slot,
          blockTime: t.time,
          version: 0,
          meta: { err: t.err, fee: FEE, preBalances: t.pre, postBalances: t.post, logMessages: [], innerInstructions: [], preTokenBalances: [], postTokenBalances: [], loadedAddresses: { writable: [], readonly: [] }, status: t.err ? { Err: t.err } : { Ok: null } },
          transaction: {
            signatures: tx.signatures.map((s) => bs58.encode(s)),
            message: {
              header: tx.message.header,
              accountKeys: t.accountKeys,
              recentBlockhash: tx.message.recentBlockhash,
              instructions: tx.message.compiledInstructions.map((c) => ({ programIdIndex: c.programIdIndex, accounts: c.accountKeyIndexes, data: bs58.encode(c.data) })),
              addressTableLookups: [],
            },
          },
        },
      };
    }
    default:
      return { error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

export async function startFakeRpc(state: FakeState = newState(), port = 0): Promise<{ url: string; state: FakeState; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };
      if (req.method === "OPTIONS") {
        res.writeHead(204, cors).end();
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, cors).end();
        return;
      }
      if (req.url === "/__control") {
        const c = parsed as { failNext?: boolean; dropNext?: boolean; advance?: number; accrue?: { mint: string; lamports: number } };
        try {
          if (c.failNext) state.failNext = true;
          if (c.dropNext) state.dropNext = true;
          if (c.advance) state.slot += c.advance;
          if (c.accrue) accrue(state, c.accrue.mint, c.accrue.lamports);
        } catch (e) {
          res.writeHead(400, { "content-type": "application/json", ...cors }).end(JSON.stringify({ error: (e as Error).message }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json", ...cors }).end(JSON.stringify({ ok: true, slot: state.slot }));
        return;
      }
      const one = (call: { id?: unknown; method: string; params?: Params }) => ({ jsonrpc: "2.0", id: call.id ?? null, ...answer(state, call.method, call.params ?? []) });
      const out = Array.isArray(parsed) ? parsed.map(one) : one(parsed as { method: string });
      res.writeHead(200, { "content-type": "application/json", ...cors }).end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const { port: p } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${p}`, state, close: () => new Promise<void>((r) => server.close(() => r())) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "")) {
  const state = newState();
  const wallet = process.env.FAKE_WALLET;
  if (wallet) state.accounts.set(wallet, { lamports: Number(process.env.FAKE_LAMPORTS ?? 2_500_000_000), owner: SYSTEM });
  const { url } = await startFakeRpc(state, Number(process.argv[2] ?? 8919));
  console.log(JSON.stringify({ url }));
}
