"use client";

import { useCallback, useEffect, useState } from "react";
import { CHAIN_ID, CONTRACT_ADDRESS, DEMO_RULE, DEMO_SITE, DEMO_STATUS, EXPLORER, GITHUB, txUrl } from "@/lib/config";
import {
  PAGE_SIZE,
  buyCover,
  claim,
  expire,
  getBooks,
  getClaimable,
  getCredit,
  getEvents,
  getPolicies,
  getPool,
  getRound,
  getSchedule,
  listPools,
  openPool,
  settle,
  withdrawCredit,
  withdrawUnderwriter,
  type Books,
  type EventRow,
  type Policy,
  type Pool,
  type RoundRecord,
  type Schedule,
} from "@/lib/contracts";
import { buyOutcome, creditOutcome, openOutcome, type Outcome } from "@/lib/outcome";
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
  expirable: "settlement deadline passed · only void is possible",
  triggered: "incident agreed · policies pay out",
  clean: "no incident on the whole page · collateral returns",
  void: "void · everyone gets their own money back",
};

const REASON: Record<string, string> = {
  clean_from_incomplete_page: "validators saw only excerpts, so a clean answer cannot count",
  attestation_missing: "the provider's attestation was missing at settlement",
  page_unreachable: "the status page could not be read",
  validators_inconclusive: "the page did not let validators tell",
};

function Flow() {
  return (
    <div className="roundsbox" aria-hidden="true">
      <p className="q">What did the provider&apos;s own status page say about the cover period?</p>
      <div className="lane">
        <span>source</span>
        <span className="bar yes">page under the provider site · attested by the provider</span>
      </div>
      <div className="lane">
        <span>round</span>
        <span className="bar yes">incident / clean / inconclusive · evidence kept</span>
      </div>
      <div className="lane">
        <span>clean?</span>
        <span className="bar no">only if the whole page was read</span>
      </div>
      <p className="gap">⋮ separated rounds must agree, before the deadline</p>
      <div className="lane">
        <span>result</span>
        <span className="bar final">pay holders · return collateral · or void</span>
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

function TrustBadge({ p }: { p: Pool }) {
  return p.source_verified ? (
    <span className="tag" title={p.attestation_at_open.url}>
      VERIFIED source · the provider lists this page
    </span>
  ) : (
    <span className="tag" style={{ borderColor: "var(--rose)", color: "var(--rose)" }} title={p.attestation_at_open.url}>
      UNVERIFIED source · you trust the underwriter&apos;s choice of page
    </span>
  );
}

function RoundView({ r }: { r: RoundRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <strong>
        round {r.round}: {r.finding}
      </strong>{" "}
      <span className="muted">
        ({r.outcome}
        {r.reason ? ` · ${REASON[r.reason] || r.reason}` : ""}) · {utc(r.at)} · page sha-256{" "}
        {r.source.content_hash.slice(0, 12)}… · {r.evidence.complete ? "whole page read" : `excerpts (${r.evidence.excerpt_chars} of ${r.source.total_chars} chars)`}
        {r.attestation ? ` · attestation ${r.attestation.valid ? "valid" : "MISSING"}` : ""}{" "}
        <button className="ghost tiny" onClick={() => setOpen(!open)}>
          {open ? "hide evidence" : "show the evidence validators read"}
        </button>
      </span>
      {open && (
        <div className="hashline" style={{ whiteSpace: "pre-wrap", marginTop: "0.4rem" }}>
          excerpts sha-256 {r.evidence.excerpts_hash}
          {r.evidence.excerpts.map((e, i) => (
            <div key={i} style={{ marginTop: "0.4rem" }}>
              [{e.match} @ {e.from_char}] {e.text}
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

export function OutageCoverApp() {
  const { address, provider, connect, error: walletError } = useWallet();
  const [rows, setRows] = useState<Pool[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [policies, setPolicies] = useState<Record<string, Record<string, Policy>>>({});
  const [claimable, setClaimable] = useState<Record<string, string>>({});
  const [schedules, setSchedules] = useState<Record<string, Schedule>>({});
  const [rounds, setRounds] = useState<Record<string, RoundRecord[]>>({});
  const [books, setBooks] = useState<Books | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [credit, setCredit] = useState(BigInt(0));
  const [gen, setGen] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [err, setErr] = useState("");
  const [tx, setTx] = useState("");
  const [stage, setStage] = useState<TxStage | "">("");

  const [pid, setPid] = useState("harbor/my-pool");
  const [service, setService] = useState("Harbor API");
  const [providerSite, setProviderSite] = useState(DEMO_SITE);
  const [statusUrl, setStatusUrl] = useState(DEMO_STATUS);
  const [rule, setRule] = useState(DEMO_RULE);
  const [salesIn, setSalesIn] = useState("120");
  const [coverLen, setCoverLen] = useState("120");
  const [multiple, setMultiple] = useState("4");
  const [interval, setIntervalSeconds] = useState("60");
  const [roundsReq, setRoundsReq] = useState("1");
  const [collateralGen, setCollateralGen] = useState("4");
  const [premiumGen, setPremiumGen] = useState("0.5");

  const loadPools = useCallback(async (count: number) => {
    // Newest first, one page at a time: the console never reads the whole registry.
    const first = await listPools(0, 1);
    const n = first.total;
    setTotal(n);
    const start = Math.max(0, n - count);
    const page = await listPools(start, Math.min(count, n));
    const ids = page.items.map((x) => x[0]).reverse();
    const pools = (await Promise.all(ids.map((id) => getPool(id)))).filter(Boolean) as Pool[];
    setRows(pools);
    setLoaded(ids.length);
    const sc = await Promise.all(ids.map((id) => getSchedule(id)));
    setSchedules(Object.fromEntries(sc.filter(Boolean).map((x) => [(x as Schedule).pool_id, x as Schedule])));
    const ps = await Promise.all(ids.map((id) => getPolicies(id)));
    setPolicies(Object.fromEntries(ids.map((id, i) => [id, ps[i]])));
    const rs = await Promise.all(
      pools.map(async (p) => (await Promise.all(Array.from({ length: p.rounds }, (_, i) => getRound(p.pool_id, i + 1)))).filter(Boolean) as RoundRecord[]),
    );
    setRounds(Object.fromEntries(pools.map((p, i) => [p.pool_id, rs[i]])));
    return ids;
  }, []);

  const refresh = useCallback(
    async (count = Math.max(PAGE_SIZE, loaded)) => {
      setLoading(true);
      try {
        const [ev, b] = await Promise.all([getEvents(), getBooks()]);
        setBooks(b);
        setEvents(ev.slice(-10).reverse());
        const ids = await loadPools(count);
        if (address) {
          setGen(await getNativeBalance(address));
          setCredit(await getCredit(address));
          const cl = await Promise.all(ids.map((id) => getClaimable(id, address)));
          setClaimable(Object.fromEntries(ids.map((id, i) => [id, cl[i]])));
        } else {
          setCredit(BigInt(0));
          setClaimable({});
        }
      } catch (e) {
        setErr(`Error: ${e instanceof Error ? e.message : "read failed"}`);
      } finally {
        setLoading(false);
      }
    },
    [address, loadPools, loaded],
  );

  useEffect(() => {
    void refresh(PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const onStage = (next: TxStage, hash: string) => {
    setTx(hash);
    setStage(next);
    if (next === "finalized") void refresh();
  };

  /** Send, then decide success from chain state - never from the receipt alone. */
  const run = async (name: string, fn: () => Promise<string | void>, check?: () => Promise<Outcome>) => {
    if (!address || !provider) {
      setErr("Connect MetaMask for writes");
      return;
    }
    setBusy(name);
    setErr("");
    setOutcome(null);
    setStage("");
    try {
      const hash = await fn();
      if (hash) setTx(hash);
      if (check) setOutcome(await check());
      await refresh();
    } catch (e) {
      setErr(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
    }
  };

  const acct = address as `0x${string}`;
  const disabled = !!busy || !address;
  const collateralWei = toWei(collateralGen);
  const premiumWei = toWei(premiumGen);
  const same = (a: string, b: string | null) => !!b && a.toLowerCase() === b.toLowerCase();
  const target = rows.find((r) => r.pool_id === pid);

  const doOpen = () => {
    const before = credit;
    void run(
      "open_pool",
      () =>
        openPool(
          acct,
          provider,
          { id: pid, service, providerSite, statusUrl, rule, salesCloseIn: salesIn, coverLength: coverLen, multiple, interval, rounds: roundsReq, collateral: collateralWei },
          onStage,
        ),
      async () => openOutcome(await getPool(pid), acct, before, await getCredit(acct), BigInt(collateralWei || "0")),
    );
  };

  const doBuy = (p: Pool) => {
    const before = credit;
    void run(
      "buy_cover",
      () => buyCover(acct, provider, p.pool_id, p.terms_hash, premiumWei, onStage),
      async () => buyOutcome((await getPolicies(p.pool_id))[acct], before, await getCredit(acct), BigInt(premiumWei || "0")),
    );
  };

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
            <strong>own status page</strong> against a rule fixed on day one. Separated rounds must
            agree, a clean answer counts only when the whole page was read, and every round&apos;s
            evidence stays on chain.
          </p>
          <div className="chips">
            <span className="chip">
              chain <b>{CHAIN_ID}</b>
            </span>
            <span className="chip">
              pools <b>{total}</b>
            </span>
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
          {address && credit > BigInt(0) && (
            <p className="verdictbox">
              The contract holds <strong>{fmtGen(credit.toString())} GEN</strong> for you from a pool
              or a policy it refused.{" "}
              <button
                className="ghost tiny"
                disabled={!!busy}
                onClick={() => {
                  const before = credit;
                  void run("withdraw_credit", () => withdrawCredit(acct, provider, onStage), async () => creditOutcome(before, await getCredit(acct)));
                }}
              >
                take it back
              </button>
            </p>
          )}
          {outcome && (
            <p className={outcome.verdict === "done" ? "okmsg" : "msg"}>
              <strong>{outcome.title}.</strong> {outcome.detail}
            </p>
          )}
          {walletError && <p className="msg">{walletError}</p>}
          {err && <p className="msg">{err}</p>}
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

      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Before you buy: what you are trusting</h2>
        <ul className="decide">
          <li>
            <span className="tag">the page</span> the payout depends on one status page under the
            provider site named by the pool. Check that the site really is the provider&apos;s.
          </li>
          <li>
            <span className="tag">verified</span> the provider publishes{" "}
            <code>/.well-known/genlayer-status.json</code> listing that page. It is re-read in every
            settlement round. <span className="tag">unverified</span> pools exist too, clearly
            marked: then you trust the underwriter&apos;s choice of page.
          </li>
          <li>
            <span className="tag">incomplete pages</span> on a long page validators read excerpts.
            An incident they see counts; &quot;no incident&quot; from excerpts does not, and a pool
            that never gets a complete clean reading ends VOID with premiums returned.
          </li>
          <li>
            <span className="tag">the deadline</span> settlement is accepted only before the
            pool&apos;s deadline; from the deadline on, only void. Your purchase confirms the pool&apos;s
            terms hash, so you cannot be sold terms you did not see.
          </li>
        </ul>
      </section>

      <div className="row">
        <section className="card">
          <h2>1 · Underwrite a pool</h2>
          <label htmlFor="pid">Pool id</label>
          <input id="pid" value={pid} onChange={(e) => setPid(e.target.value)} />
          <label htmlFor="service">Service</label>
          <input id="service" value={service} onChange={(e) => setService(e.target.value)} />
          <label htmlFor="site">Provider site (https origin + optional path)</label>
          <input id="site" value={providerSite} onChange={(e) => setProviderSite(e.target.value)} />
          <label htmlFor="statusUrl">Status page (must be under the provider site)</label>
          <input id="statusUrl" value={statusUrl} onChange={(e) => setStatusUrl(e.target.value)} />
          <label htmlFor="rule">Incident rule</label>
          <textarea id="rule" rows={2} value={rule} onChange={(e) => setRule(e.target.value)} />
          <div className="grid2">
            <div>
              <label htmlFor="collateral">Collateral (GEN, at least 1)</label>
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
              <label htmlFor="roundsReq">Agreeing rounds (1–3)</label>
              <input id="roundsReq" value={roundsReq} onChange={(e) => setRoundsReq(e.target.value)} />
            </div>
          </div>
          <button disabled={disabled || !pid || !service || !rule || collateralWei === ""} onClick={doOpen}>
            {busy === "open_pool" ? (
              <span className="working">
                <span className="spinner" /> validators are reading the provider&apos;s attestation…
              </span>
            ) : (
              `escrow ${collateralGen || "0"} GEN and open the pool`
            )}
          </button>
        </section>

        <section className="card">
          <h2>2 · Buy cover</h2>
          {!target ? (
            <p className="muted">Pick a pool id from the list below (or enter one) to see its terms first.</p>
          ) : (
            <>
              <p>
                <TrustBadge p={target} />
              </p>
              <p className="hashline">
                {target.service} · site {target.provider_site} · page {target.status_url}
              </p>
              <p className="hashline">rule: {target.incident_rule}</p>
              <p className="hashline">
                cover {utc(target.sales_close_at)} → {utc(target.cover_ends_at)} · settlement deadline{" "}
                {utc(target.settle_deadline)} · payout ×{target.multiple}
              </p>
              <p className="hashline">
                terms hash you confirm: <code>{target.terms_hash.slice(0, 20)}…</code>
              </p>
            </>
          )}
          <label htmlFor="buyPid">Pool id</label>
          <input id="buyPid" value={pid} onChange={(e) => setPid(e.target.value)} />
          <label htmlFor="premium">Premium (GEN)</label>
          <input id="premium" value={premiumGen} onChange={(e) => setPremiumGen(e.target.value)} />
          <button
            disabled={disabled || premiumWei === "" || !target || (schedules[pid] ? !schedules[pid].can_buy : false)}
            onClick={() => target && doBuy(target)}
          >
            {schedules[pid] && !schedules[pid].can_buy ? "sales are closed for this pool" : `I have read these terms: pay ${premiumGen} GEN`}
          </button>
        </section>
      </div>

      <section style={{ marginTop: "2rem" }}>
        <div className="head">
          <h2>Pools on chain (newest first)</h2>
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
              <p>
                <TrustBadge p={p} />{" "}
                <button className="ghost tiny" onClick={() => setPid(p.pool_id)}>
                  use this pool above
                </button>
              </p>
              <p className="claimtext">{p.service}</p>
              <p className="hashline">
                site {p.provider_site} · page <a href={p.status_url}>{p.status_url}</a>
              </p>
              <p className="hashline">rule: {p.incident_rule}</p>
              <p className="hashline">
                cover {utc(p.sales_close_at)} → {utc(p.cover_ends_at)} · deadline {utc(p.settle_deadline)} · collateral{" "}
                {fmtGen(p.collateral)} GEN · premiums {fmtGen(p.premiums)} GEN · ×{p.multiple} · {p.policies} polic
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
              {(rounds[p.pool_id] || []).length > 0 && (
                <ul className="timeline">
                  {(rounds[p.pool_id] || []).map((r) => (
                    <RoundView key={r.round} r={r} />
                  ))}
                </ul>
              )}
              {!final && (
                <button
                  className="ghost"
                  disabled={disabled || (s ? !s.can_settle : false)}
                  onClick={() => void run("settle", () => settle(acct, provider, p.pool_id, onStage))}
                >
                  {s?.can_expire ? "deadline passed · only void is accepted" : s && !s.can_settle ? `settlement from ${utc(p.next_round_at)}` : "run a settlement round"}
                </button>
              )}
              {s?.can_expire && (
                <button className="ghost" style={{ marginLeft: "0.5rem" }} disabled={disabled} onClick={() => void run("expire", () => expire(acct, provider, p.pool_id, onStage))}>
                  void the pool
                </button>
              )}
              {mine !== "0" && (
                <button className="ghost" style={{ marginLeft: "0.5rem" }} disabled={disabled} onClick={() => void run("claim", () => claim(acct, provider, p.pool_id, onStage))}>
                  claim {fmtGen(mine)} GEN
                </button>
              )}
              {final && same(p.underwriter, address) && !p.underwriter_paid && (
                <button className="ghost" style={{ marginLeft: "0.5rem" }} disabled={disabled} onClick={() => void run("withdraw_underwriter", () => withdrawUnderwriter(acct, provider, p.pool_id, onStage))}>
                  withdraw the underwriter&apos;s share
                </button>
              )}
            </article>
          );
        })}
        {loaded < total && (
          <button className="ghost" style={{ marginTop: "1rem" }} disabled={loading} onClick={() => void refresh(loaded + PAGE_SIZE)}>
            load {Math.min(PAGE_SIZE, total - loaded)} older pools ({total - loaded} not shown)
          </button>
        )}
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
                  {[e.id, e.round ? `round ${e.round}` : null, e.finding, e.outcome, e.status, e.verified === true ? "verified" : e.verified === false ? "unverified" : null, e.premium ? `premium ${fmtGen(String(e.premium))} GEN` : null, e.amount ? `${fmtGen(String(e.amount))} GEN` : null, e.collateral ? `collateral ${fmtGen(String(e.collateral))} GEN` : null, typeof e.at === "number" ? utc(e.at) : null]
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
        need MetaMask and test GEN. The demo provider site is a folder in this repository.
      </footer>
    </main>
  );
}
