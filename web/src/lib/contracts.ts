import { CONTRACT_ADDRESS } from "./config";
import { type Address, type TxStage, parseJson, readContract, writeAndWait } from "./genlayer";

export type Round = {
  at: number;
  answer: boolean | null;
  outcome: "proposed" | "confirmed" | "unreachable";
  content_hash: string;
  by: string;
};

export type Pool = {
  pool_id: string;
  underwriter: string;
  service: string;
  status_url: string;
  incident_rule: string;
  sales_close_at: number;
  cover_ends_at: number;
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
  confirmations: number;
  rounds: number;
  history: Round[];
  injection_flags: string[];
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
  expires_at: number;
  free_capacity: string;
};
export type Books = { balance: string; held: string; credits: string };
export type Stats = { pools: number; by_status: Record<string, number> };
export type EventRow = { event: string; [key: string]: unknown };

type OnStage = (stage: TxStage, hash: string) => void;
const read = (fn: string, args: string[] = []) => readContract<string>(CONTRACT_ADDRESS, fn, args);

export async function listPools(): Promise<string[]> {
  return parseJson<string[]>(await read("list_pools"), []);
}
export async function getPool(id: string): Promise<Pool | null> {
  const p = parseJson<Pool>(await read("get_pool", [id]), {} as Pool);
  return p.pool_id ? p : null;
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
export async function getBooks(): Promise<Books | null> {
  return parseJson<Books | null>(await read("get_balance"), null);
}
export async function getStats(): Promise<Stats | null> {
  return parseJson<Stats | null>(await read("get_stats"), null);
}
export async function getEvents(): Promise<EventRow[]> {
  return parseJson<EventRow[]>(await read("get_events"), []);
}
export async function getCredit(address: string): Promise<string> {
  return (await read("get_credit", [address])) || "0";
}

export type NewPool = {
  id: string;
  service: string;
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
    [p.id, p.service, p.statusUrl, p.rule, p.salesCloseIn, p.coverLength, p.multiple, p.interval, p.rounds],
    on,
    BigInt(p.collateral || "0"),
  );
}

export async function buyCover(account: Address, provider: unknown, id: string, premiumWei: string, on?: OnStage) {
  return writeAndWait(account, provider, CONTRACT_ADDRESS, "buy_cover", [id], on, BigInt(premiumWei || "0"));
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
