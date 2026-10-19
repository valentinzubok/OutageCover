"use client";

import { useCallback, useEffect, useState } from "react";
import { CHAIN_ID, CONTRACT_ADDRESS, DEMO_RULE, DEMO_STATUS, EXPLORER, GITHUB, txUrl } from "@/lib/config";
import {
  buyCover,
  claim,
  expire,
  getBooks,
  getClaimable,
  getCredit,
  getEvents,
  getPolicies,
  getPool,
  getSchedule,
  getStats,
  listPools,
  openPool,
  settle,
  withdrawCredit,
  withdrawUnderwriter,
  type Books,
  type EventRow,
  type Policy,
  type Pool,
  type Schedule,
  type Stats,
} from "@/lib/contracts";
import { fundWithTestGen, getNativeBalance, type TxStage } from "@/lib/genlayer";
import { useWallet } from "./WalletProvider";

const short = (h: string, n = 10) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : "—");
const utc = (seconds: number) =>
  seconds ? `${new Date(seconds * 1000).toISOString().replace("T", " ").slice(0, 16)} UTC` : "—";
const span = (seconds: number) =>
  seconds >= 86400
    ? `${Math.round(seconds / 8640) / 10} d`
    : seconds >= 3600
      ? `${Math.round(seconds / 360) / 10} h`
      : `${Math.round(seconds / 6) / 10} min`;

/** Wei as GEN, trimmed: 1500000000000000000 -> "1.5". */
const fmtGen = (wei: string | number | undefined) => {
  let v: bigint;
  try {
    v = BigInt(wei || 0);
  } catch {
    return "0";
  }
  const whole = v / BigInt(10 ** 18);
  const frac = (v % BigInt(10 ** 18)).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac.slice(0, 6)}` : `${whole}`;
};

/** GEN typed by a person as wei, or "" when it is not a number. */
const toWei = (text: string) => {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(text.trim());
  if (!m) return "";
  return (BigInt(m[1]) * BigInt(10 ** 18) + BigInt((m[2] || "").padEnd(18, "0") || "0")).toString();
};

const PHASE: Record<string, string> = {
  selling: "selling cover",
  covering: "cover running · sales closed",
  settling: "settling · not final",
  triggered: "incident agreed · policies pay out",
  clean: "no incident · collateral returns",
  void: "void · everyone gets their own money back",
};

function Flow() {
  return (
    <div className="roundsbox" aria-hidden="true">
      <p className="q">Did the status page report a qualifying incident in the cover period?</p>
      <div className="lane">
        <span>sales</span>
        <span className="bar yes">premiums in · closes before cover starts</span>
      </div>
      <div className="lane">
        <span>round 1</span>
        <span className="bar yes">validators: incident → a proposal</span>
      </div>
      <p className="gap">⋮ at least one full interval</p>
      <div className="lane">
        <span>round 2</span>
        <span className="bar yes">validators again: incident</span>
      </div>
      <div className="lane">
        <span>result</span>
        <span className="bar final">each holder claims premium × multiple</span>
      </div>
    </div>
  );
}

function Dots({ have, need }: { have: number; need: number }) {
  return (
    <span className="confirm" title={`${have} of ${need} agreeing rounds`}>
      {Array.from({ length: need }, (_, i) => (
        <i key={i} className={i < have ? "on" : ""} />
      ))}
    </span>
  );
}

export function OutageCoverApp() {
  const { address, provider, connect, error: walletError } = useWallet();
  const [rows, setRows] = useState<Pool[]>([]);
  const [policies, setPolicies] = useState<Record<string, Record<string, Policy>>>({});
  const [claimable, setClaimable] = useState<Record<string, string>>({});
  const [schedules, setSchedules] = useState<Record<string, Schedule>>({});
  const [books, setBooks] = useState<Books | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [credit, setCredit] = useState("0");
  const [gen, setGen] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const [tx, setTx] = useState("");
  const [stage, setStage] = useState<TxStage | "">("");

  const [pid, setPid] = useState("web/my-pool");
  const [service, setService] = useState("Harbor Web");
  const [statusUrl, setStatusUrl] = useState(DEMO_STATUS);
  const [rule, setRule] = useState(DEMO_RULE);
  const [salesIn, setSalesIn] = useState("180");
  const [coverLen, setCoverLen] = useState("300");
  const [multiple, setMultiple] = useState("4");
  const [interval, setIntervalSeconds] = useState("120");
  const [rounds, setRounds] = useState("2");
  const [collateralGen, setCollateralGen] = useState("4");
  const [premiumGen, setPremiumGen] = useState("0.5");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ids, s, ev, b] = await Promise.all([listPools(), getStats(), getEvents(), getBooks()]);
      setStats(s);
      setBooks(b);
      setEvents(ev.slice(-10).reverse());
      const loaded = await Promise.all(ids.map((id) => getPool(id)));
      setRows((loaded.filter(Boolean) as Pool[]).reverse());
      const ps = await Promise.all(ids.map((id) => getPolicies(id)));
      setPolicies(Object.fromEntries(ids.map((id, i) => [id, ps[i]])));
      const sc = await Promise.all(ids.map((id) => getSchedule(id)));
      setSchedules(Object.fromEntries(sc.filter(Boolean).map((x) => [(x as Schedule).pool_id, x as Schedule])));
      if (address) {
        setGen(await getNativeBalance(address));
        setCredit(await getCredit(address));
        const cl = await Promise.all(ids.map((id) => getClaimable(id, address)));
        setClaimable(Object.fromEntries(ids.map((id, i) => [id, cl[i]])));
      } else {
        setCredit("0");
        setClaimable({});
      }
    } catch (e) {
      setMsg(`Error: ${e instanceof Error ? e.message : "read failed"}`);
      setOk(false);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onStage = (next: TxStage, hash: string) => {
    setTx(hash);
    setStage(next);
    if (next === "finalized") void refresh();
  };

  const run = async (name: string, fn: () => Promise<string | void>) => {
    if (!address || !provider) {
      setMsg("Connect MetaMask for writes");
      setOk(false);
      return;
    }
    setBusy(name);
    setMsg("");
    setStage("");
    try {
      const hash = await fn();
      if (hash) setTx(hash);
      await refresh();
      setMsg(`${name}: accepted by consensus`);
      setOk(true);
    } catch (e) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
      setOk(false);
    } finally {
      setBusy("");
    }
  };

  const acct = address as `0x${string}`;
  const disabled = !!busy || !address;
  const collateralWei = toWei(collateralGen);
  const premiumWei = toWei(premiumGen);
  const same = (a: string, b: string | null) => !!b && a.toLowerCase() === b.toLowerCase();

  return (
    <main className="wrap">
      <section className="hero">
        <div>
          <h1>
            Outage<span className="accent">Cover</span>
          </h1>
          <p className="lede">
            Outage insurance usually pays when someone at the insurer agrees it should. Here the
            underwriter escrows collateral, buyers pay premiums before cover starts, and after the
            cover period anyone can ask the network to read the provider&apos;s{" "}
            <strong>own status page</strong> against a rule fixed on day one. When validators
            agree in separated rounds that a qualifying incident happened inside the period, every
            policy pays premium × multiple. Nobody adjusts the claim.
          </p>
          <div className="chips">
            <span className="chip">
              chain <b>{CHAIN_ID}</b>
            </span>
            {stats && (
              <>
                <span className="chip">
                  pools <b>{stats.pools}</b>
                </span>
                <span className="chip hot">
                  triggered <b>{stats.by_status.triggered || 0}</b>
                </span>
                <span className="chip">
                  clean <b>{stats.by_status.clean || 0}</b>
                </span>
              </>
            )}
            {books && (
              <span className="chip">
                held now <b>{fmtGen(books.balance)} GEN</b>
              </span>
            )}
          </div>
          <p className="muted" style={{ marginTop: "0.8rem" }}>
            Contract <a href={EXPLORER}>{short(CONTRACT_ADDRESS, 12)}</a> · nobody is privileged ·{" "}
            <a href={GITHUB}>source</a>
          </p>
          <div>
            {!address ? (
              <button onClick={() => void connect()}>Connect MetaMask</button>
            ) : (
              <span className="pill">
                <span className="dot" /> {short(address)} · {gen || "?"} GEN
              </span>
            )}
            {address && (
              <button
                className="ghost"
                style={{ marginLeft: "0.5rem" }}
                disabled={!!busy}
                onClick={() =>
                  void run("Get test GEN", async () => {
                    await fundWithTestGen(acct);
                  })
                }
              >
                Get test GEN
              </button>
            )}
          </div>
          {address && credit !== "0" && (
            <p className="verdictbox">
              The contract holds <strong>{fmtGen(credit)} GEN</strong> for you from a pool or a
              policy it refused.{" "}
              <button
                className="ghost tiny"
                disabled={!!busy}
                onClick={() => void run("withdraw_credit", () => withdrawCredit(acct, provider, onStage))}
              >
                take it back
              </button>
            </p>
          )}
          {walletError && <p className="msg">{walletError}</p>}
          {msg && <p className={ok ? "okmsg" : "msg"}>{msg}</p>}
          {tx && (
            <p className="tx muted">
              last tx <a href={txUrl(tx)}>{short(tx, 14)}</a>{" "}
              {stage === "finalized" ? (
                <span className="stagepill final">finalized · payouts have landed</span>
              ) : (
                <span className="stagepill accepted">accepted — awaiting finalization</span>
              )}
            </p>
          )}
        </div>
        <Flow />
      </section>

      <div className="row">
        <section className="card">
          <h2>1 · Underwrite a pool</h2>
          <p className="muted">
            The collateral is sent with this transaction. The status page, the rule, the dates and
            the payout multiple are fixed here and have no setter.
          </p>
          <label htmlFor="pid">Pool id</label>
          <input id="pid" value={pid} onChange={(e) => setPid(e.target.value)} />
          <label htmlFor="service">Service</label>
          <input id="service" value={service} onChange={(e) => setService(e.target.value)} />
          <label htmlFor="statusUrl">Status page (https)</label>
          <input id="statusUrl" value={statusUrl} onChange={(e) => setStatusUrl(e.target.value)} />
          <label htmlFor="rule">Incident rule</label>
          <textarea id="rule" rows={2} value={rule} onChange={(e) => setRule(e.target.value)} />
          <div className="grid2">
            <div>
              <label htmlFor="collateral">Collateral (GEN)</label>
              <input id="collateral" value={collateralGen} onChange={(e) => setCollateralGen(e.target.value)} />
            </div>
            <div>
              <label htmlFor="multiple">Payout multiple (2–20)</label>
              <input id="multiple" value={multiple} onChange={(e) => setMultiple(e.target.value)} />
            </div>
            <div>
              <label htmlFor="salesIn">Sales close in (s)</label>
              <input id="salesIn" value={salesIn} onChange={(e) => setSalesIn(e.target.value)} />
            </div>
            <div>
              <label htmlFor="coverLen">Cover length (s)</label>
              <input id="coverLen" value={coverLen} onChange={(e) => setCoverLen(e.target.value)} />
            </div>
            <div>
              <label htmlFor="interval">Interval between rounds (s)</label>
              <input id="interval" value={interval} onChange={(e) => setIntervalSeconds(e.target.value)} />
            </div>
            <div>
              <label htmlFor="rounds">Agreeing rounds (1–3)</label>
              <input id="rounds" value={rounds} onChange={(e) => setRounds(e.target.value)} />
            </div>
          </div>
          <button
            disabled={disabled || !pid || !service || !rule || collateralWei === ""}
            onClick={() =>
              void run("open_pool", () =>
                openPool(
                  acct,
                  provider,
                  {
                    id: pid,
                    service,
                    statusUrl,
                    rule,
                    salesCloseIn: salesIn,
                    coverLength: coverLen,
                    multiple,
                    interval,
                    rounds,
                    collateral: collateralWei,
                  },
                  onStage,
                ),
              )
            }
          >
            {busy === "open_pool" ? (
              <span className="working">
                <span className="spinner" /> opening…
              </span>
            ) : (
              `escrow ${collateralGen || "0"} GEN and open the pool`
            )}
          </button>
        </section>

        <section className="card">
          <h2>2 · Buy cover</h2>
          <p className="muted">
            One policy per address, only while sales are open, so nobody buys after an outage has
            started. A policy the collateral cannot cover is refused and its premium credited back.
          </p>
          <label htmlFor="buyPid">Pool id</label>
          <input id="buyPid" value={pid} onChange={(e) => setPid(e.target.value)} />
          <label htmlFor="premium">Premium (GEN)</label>
          <input id="premium" value={premiumGen} onChange={(e) => setPremiumGen(e.target.value)} />
          <button
            disabled={disabled || premiumWei === "" || (schedules[pid] ? !schedules[pid].can_buy : false)}
            onClick={() => void run("buy_cover", () => buyCover(acct, provider, pid, premiumWei, onStage))}
          >
            {schedules[pid] && !schedules[pid].can_buy ? "sales are closed for this pool" : `pay ${premiumGen} GEN for cover`}
          </button>
          <ul className="decide" style={{ marginTop: "1rem" }}>
            <li>
              <span className="tag">a round</span> validators freeze the status page and agree on
              one boolean: a qualifying incident inside the cover period?
            </li>
            <li>
              <span className="tag">same answer</span> one more confirmation;{" "}
              <span className="tag">different</span> the count restarts;{" "}
              <span className="tag">unreachable</span> nothing changes.
            </li>
            <li>
              <span className="tag">reverts</span> a malformed answer or a consensus failure records
              nothing.
            </li>
          </ul>
        </section>
      </div>

      <section style={{ marginTop: "2rem" }}>
        <div className="head">
          <h2>Pools on chain</h2>
          <button className="ghost" disabled={loading} onClick={() => void refresh()}>
            {loading ? "reading…" : "refresh"}
          </button>
        </div>
        {rows.length === 0 && !loading && <p className="muted">No pools yet.</p>}
        {rows.map((p) => {
          const s = schedules[p.pool_id];
          const book = policies[p.pool_id] || {};
          const mine = claimable[p.pool_id] || "0";
          const final = ["triggered", "clean", "void"].includes(p.status);
          return (
            <article className="card" key={p.pool_id} style={{ marginTop: "1rem" }}>
              <div className="head">
                <span className="id">{p.pool_id}</span>
                <span className="muted">
                  {PHASE[p.phase] || p.phase} {p.rounds_required > 1 && <Dots have={p.confirmations} need={p.rounds_required} />}
                </span>
              </div>
              <p className="claimtext">{p.service}</p>
              <p className="hashline">
                status page <a href={p.status_url}>{p.status_url}</a>
              </p>
              <p className="hashline">rule: {p.incident_rule}</p>
              <p className="hashline">
                cover {utc(p.sales_close_at)} → {utc(p.cover_ends_at)} · collateral {fmtGen(p.collateral)} GEN ·
                premiums {fmtGen(p.premiums)} GEN · payout ×{p.multiple} · {p.policies} polic
                {p.policies === 1 ? "y" : "ies"} · paid out {fmtGen(p.paid_out)} GEN
              </p>
              {Object.keys(book).length > 0 && (
                <div className="outcomes">
                  {Object.entries(book).map(([who, pol]) => (
                    <span key={who} className={`outcome ${pol.claimed ? "final" : ""}`}>
                      {short(who)}
                      <small>
                        premium {fmtGen(pol.premium)} GEN{pol.claimed ? " · claimed" : ""}
                      </small>
                    </span>
                  ))}
                </div>
              )}
              {p.history.length > 0 && (
                <p className="hashline">
                  rounds:{" "}
                  {p.history
                    .map(
                      (h) =>
                        `${h.answer === null ? "unreachable" : h.answer ? "incident" : "no incident"} (${h.outcome}, ${utc(h.at)})`,
                    )
                    .join(" → ")}
                </p>
              )}
              {p.injection_flags.length > 0 && (
                <p className="hashline">instruction-like text flagged: {p.injection_flags.join(", ")}</p>
              )}
              {!final && (
                <button
                  className="ghost"
                  disabled={disabled || (s ? !s.can_settle : false)}
                  onClick={() => void run("settle", () => settle(acct, provider, p.pool_id, onStage))}
                >
                  {s && !s.can_settle ? `settlement from ${utc(p.next_round_at)}` : "run a settlement round"}
                </button>
              )}
              {s?.can_expire && (
                <button
                  className="ghost"
                  style={{ marginLeft: "0.5rem" }}
                  disabled={disabled}
                  onClick={() => void run("expire", () => expire(acct, provider, p.pool_id, onStage))}
                >
                  void the pool
                </button>
              )}
              {mine !== "0" && (
                <button
                  className="ghost"
                  style={{ marginLeft: "0.5rem" }}
                  disabled={disabled}
                  onClick={() => void run("claim", () => claim(acct, provider, p.pool_id, onStage))}
                >
                  claim {fmtGen(mine)} GEN
                </button>
              )}
              {final && same(p.underwriter, address) && !p.underwriter_paid && (
                <button
                  className="ghost"
                  style={{ marginLeft: "0.5rem" }}
                  disabled={disabled}
                  onClick={() => void run("withdraw_underwriter", () => withdrawUnderwriter(acct, provider, p.pool_id, onStage))}
                >
                  withdraw the underwriter&apos;s share
                </button>
              )}
            </article>
          );
        })}
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Recent events</h2>
        {events.length === 0 ? (
          <p className="muted">No events yet.</p>
        ) : (
          <ul className="timeline">
            {events.map((e, i) => (
              <li key={i}>
                <strong>{String(e.event)}</strong>{" "}
                <span className="muted">
                  {[
                    e.id,
                    e.outcome,
                    e.answer === true ? "incident" : e.answer === false ? "no incident" : null,
                    e.status,
                    e.premium ? `premium ${fmtGen(String(e.premium))} GEN` : null,
                    e.amount ? `${fmtGen(String(e.amount))} GEN` : null,
                    e.collateral ? `collateral ${fmtGen(String(e.collateral))} GEN` : null,
                    typeof e.at === "number" ? utc(e.at) : null,
                  ]
                    .filter(Boolean)
                    .map(String)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="foot">
        OutageCover on GenLayer Studio Dev (chain {CHAIN_ID}). Reads work without a wallet; writes
        need MetaMask and test GEN. The demo status pages are files in this repository.
      </footer>
    </main>
  );
}
