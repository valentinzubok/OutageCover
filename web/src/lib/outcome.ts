/**
 * A transaction can be accepted by consensus and still not do what the user asked: the
 * contract refuses a pool or a policy in its return value and books the money as a credit
 * (a refused payable call must not revert, or the value would be lost). The console therefore
 * never reports success from the receipt alone. It reads the chain after the call and decides
 * with these functions, which are pure so they can be tested.
 */

export type Verdict = "done" | "refused" | "pending";

export type Outcome = {
  verdict: Verdict;
  title: string;
  detail: string;
  /** Wei the user can take back with withdraw_credit, when the call was refused. */
  credit?: string;
};

const fmt = (wei: bigint) => {
  const whole = wei / BigInt(10 ** 18);
  const frac = (wei % BigInt(10 ** 18)).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac.slice(0, 6)}` : `${whole}`;
};

export type PoolSeen = { underwriter: string; source_verified: boolean } | null;

/** After open_pool: did a pool with this id appear, written by this account? */
export function openOutcome(
  pool: PoolSeen,
  me: string,
  creditBefore: bigint,
  creditAfter: bigint,
  sent: bigint,
): Outcome {
  if (pool && pool.underwriter.toLowerCase() === me.toLowerCase()) {
    return {
      verdict: "done",
      title: "Pool opened",
      detail: pool.source_verified
        ? "The provider's attestation lists this page: the pool is VERIFIED."
        : "No matching provider attestation: the pool is UNVERIFIED and buyers will see that.",
    };
  }
  if (creditAfter - creditBefore >= sent && sent > BigInt(0)) {
    return {
      verdict: "refused",
      title: "The pool was NOT opened",
      detail: `The contract refused it and kept your ${fmt(sent)} GEN as a credit. Take it back with "take it back".`,
      credit: (creditAfter - creditBefore).toString(),
    };
  }
  if (pool) {
    return {
      verdict: "refused",
      title: "The pool was NOT opened",
      detail: "A pool with this id already belongs to another account.",
    };
  }
  return {
    verdict: "pending",
    title: "Waiting for the chain",
    detail: "The transaction is accepted but neither the pool nor a credit is visible yet. Refresh after finalization.",
  };
}

export type PolicySeen = { premium: string } | undefined;

/** After buy_cover: is there a policy for this account in this pool? */
export function buyOutcome(
  policy: PolicySeen,
  creditBefore: bigint,
  creditAfter: bigint,
  sent: bigint,
): Outcome {
  if (policy) {
    return {
      verdict: "done",
      title: "Cover bought",
      detail: `Your policy is on chain with a premium of ${fmt(BigInt(policy.premium))} GEN.`,
    };
  }
  if (creditAfter - creditBefore >= sent && sent > BigInt(0)) {
    return {
      verdict: "refused",
      title: "You are NOT covered",
      detail: `The contract refused the purchase and kept your ${fmt(sent)} GEN as a credit. Take it back with "take it back".`,
      credit: (creditAfter - creditBefore).toString(),
    };
  }
  return {
    verdict: "pending",
    title: "Waiting for the chain",
    detail: "The transaction is accepted but no policy and no credit are visible yet. Refresh after finalization.",
  };
}

/** After withdraw_credit: did the credit go to zero? */
export function creditOutcome(creditBefore: bigint, creditAfter: bigint): Outcome {
  if (creditBefore > BigInt(0) && creditAfter === BigInt(0)) {
    return {
      verdict: "done",
      title: "Credit withdrawn",
      detail: `${fmt(creditBefore)} GEN is on its way to your wallet; it lands when the transaction is finalized.`,
    };
  }
  return { verdict: "pending", title: "Waiting for the chain", detail: "The credit is still shown. Refresh after finalization." };
}
