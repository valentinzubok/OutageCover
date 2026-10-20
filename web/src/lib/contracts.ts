import { CONTRACT_ADDRESS } from "./config";
import { type Address, type TxStage, parseJson, readContract, writeAndWait } from "./genlayer";

export type Excerpt = { from_char: number; match: string; text: string };

export type RoundRecord = {
  pool_id: string;
  round: number;
  at: number;
  by: string;
  source: {
    provider_site: string;
    status_url: string;
    fetch_status: string;
    content_hash: string;
    total_chars: number;
  };
  attestation: { valid: boolean; status: string; hash: string } | null;
  evidence: { complete: boolean; excerpt_chars: number; excerpts_hash: string; excerpts: Excerpt[] };
  model_finding: string;
  finding: "incident" | "clean" | "inconclusive";
  reason: string;
  outcome: "proposed" | "confirmed" | "inconclusive";
  confirmations: number;
  status_after: string;
  injection_flags: string[];
};

export type Pool = {
  pool_id: string;
  underwriter: string;
  service: string;
  provider_site: string;
  status_url: string;
  incident_rule: string;
  source_verified: boolean;
  attestation_at_open: { url: string; status: string; hash: string; lists_page: boolean; names_service: boolean };
  terms_hash: string;
  sales_close_at: number;
  cover_ends_at: number;
  settle_deadline: number;
  multiple: number;
  settle_interval: number;
  rounds_required: number;
  collateral: string;
  premiums: string;
  liability: string;
  paid_out: string;
  underwriter_paid: boolean;
  policies: number;
  status: string;
  phase: string;
  next_round_at: number;
  proposal: string;
  confirmations: number;
  rounds: number;
};

export type Policy = { premium: string; bought_at: number; claimed: boolean };
export type Schedule = {
  pool_id: string;
  phase: string;
  now: number;
  can_buy: boolean;
  can_settle: boolean;
  next_round_at: number;
  can_expire: boolean;
  settle_deadline: number;
  free_capacity: string;
  source_verified: boolean;
};
export type Books = { balance: string; held: string; credits: string };
export type EventRow = { event: string; [key: string]: unknown };
export type PageOfPools = { total: number; offset: number; items: [string, string][] };

type OnStage = (stage: TxStage, hash: string) => void;
const read = (fn: string, args: (string | number)[] = []) =>
  readContract<string>(CONTRACT_ADDRESS, fn, args as never[]);

export const PAGE_SIZE = 20;

/** One page of [pool_id, status], newest first is up to the caller. Never the whole registry. */
export async function listPools(offset: number, limit = PAGE_SIZE): Promise<PageOfPools> {
  return parseJson<PageOfPools>(await read("list_pools", [offset, limit]), { total: 0, offset, items: [] });
}
export async function countPools(): Promise<number> {
  return Number(await readContract<number>(CONTRACT_ADDRESS, "count_pools", [])) || 0;
}
export async function getPool(id: string): Promise<Pool | null> {
  try {
    const p = parseJson<Pool>(await read("get_pool", [id]), {} as Pool);
    return p.pool_id ? p : null;
  } catch {
    return null; // unknown pool_id reverts the view
  }
}
export async function getPolicies(id: string): Promise<Record<string, Policy>> {
  return parseJson<Record<string, Policy>>(await read("get_policies", [id]), {});
}
export async function getClaimable(id: string, who: string): Promise<string> {
  return (await read("get_claimable", [id, who])) || "0";
}
export async function getSchedule(id: string): Promise<Schedule | null> {
  const s = parseJson<Schedule>(await read("get_schedule", [id]), {} as Schedule);
  return s.pool_id ? s : null;
}
export async function getRound(id: string, n: number): Promise<RoundRecord | null> {
  try {
    return parseJson<RoundRecord | null>(await read("get_round", [id, n]), null);
  } catch {
    return null;
  }
}
export async function getBooks(): Promise<Books | null> {
  return parseJson<Books | null>(await read("get_balance"), null);
}
export async function getEvents(): Promise<EventRow[]> {
  return parseJson<EventRow[]>(await read("get_events"), []);
}
export async function getCredit(address: string): Promise<bigint> {
  try {
    return BigInt((await read("get_credit", [address])) || "0");
  } catch {
    return BigInt(0);
  }
}

export type NewPool = {
  id: string;
  service: string;
  providerSite: string;
  statusUrl: string;
  rule: string;
  salesCloseIn: string;
  coverLength: string;
  multiple: string;
  interval: string;
  rounds: string;
  /** Collateral in wei; it travels as the transaction's value. */
  collateral: string;
};

export async function openPool(account: Address, provider: unknown, p: NewPool, on?: OnStage) {
  return writeAndWait(
    account,
    provider,
    CONTRACT_ADDRESS,
    "open_pool",
    [p.id, p.service, p.providerSite, p.statusUrl, p.rule, p.salesCloseIn, p.coverLength, p.multiple, p.interval, p.rounds],
    on,
    BigInt(p.collateral || "0"),
  );
}

/** termsHash is the pool's terms_hash as shown to the buyer; the contract refuses any other. */
export async function buyCover(
  account: Address,
  provider: unknown,
  id: string,
  termsHash: string,
  premiumWei: string,
  on?: OnStage,
) {
  return writeAndWait(account, provider, CONTRACT_ADDRESS, "buy_cover", [id, termsHash], on, BigInt(premiumWei || "0"));
}

const simple = (fn: string) => (account: Address, provider: unknown, id: string, on?: OnStage) =>
  writeAndWait(account, provider, CONTRACT_ADDRESS, fn, [id], on);
export const settle = simple("settle");
export const expire = simple("expire");
export const claim = simple("claim");
export const withdrawUnderwriter = simple("withdraw_underwriter");

export async function withdrawCredit(account: Address, provider: unknown, on?: OnStage) {
  return writeAndWait(account, provider, CONTRACT_ADDRESS, "withdraw_credit", [], on);
}
