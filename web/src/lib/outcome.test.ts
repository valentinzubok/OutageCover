import { describe, expect, it } from "vitest";
import { buyOutcome, creditOutcome, openOutcome } from "./outcome";

const ME = "0xAbC0000000000000000000000000000000000001";
const GEN = BigInt(10) ** BigInt(18);

describe("open_pool", () => {
  it("reports success only when the pool exists and is ours", () => {
    const o = openOutcome({ underwriter: ME.toLowerCase(), source_verified: true }, ME, BigInt(0), BigInt(0), BigInt(4) * GEN);
    expect(o.verdict).toBe("done");
    expect(o.detail).toContain("VERIFIED");
  });
  it("an accepted but refused pool is reported as refused, with the credit", () => {
    const o = openOutcome(null, ME, BigInt(0), BigInt(4) * GEN, BigInt(4) * GEN);
    expect(o.verdict).toBe("refused");
    expect(o.title).toContain("NOT opened");
    expect(o.credit).toBe((BigInt(4) * GEN).toString());
  });
  it("an id taken by someone else is not a success", () => {
    const o = openOutcome({ underwriter: "0x0000000000000000000000000000000000000002", source_verified: true }, ME, BigInt(0), BigInt(0), GEN);
    expect(o.verdict).toBe("refused");
  });
  it("before finalization nothing is claimed", () => {
    expect(openOutcome(null, ME, BigInt(0), BigInt(0), GEN).verdict).toBe("pending");
  });
  it("an unverified pool says so", () => {
    const o = openOutcome({ underwriter: ME, source_verified: false }, ME, BigInt(0), BigInt(0), GEN);
    expect(o.detail).toContain("UNVERIFIED");
  });
});

describe("buy_cover", () => {
  it("success means a policy is on chain", () => {
    expect(buyOutcome({ premium: (GEN / BigInt(2)).toString() }, BigInt(0), BigInt(0), GEN / BigInt(2)).verdict).toBe("done");
  });
  it("a refused purchase says the user is not covered and shows the credit", () => {
    const o = buyOutcome(undefined, BigInt(0), GEN / BigInt(2), GEN / BigInt(2));
    expect(o.verdict).toBe("refused");
    expect(o.title).toContain("NOT covered");
    expect(o.detail).toContain("credit");
  });
  it("an earlier credit does not make a new refusal look like a success", () => {
    const o = buyOutcome(undefined, GEN, GEN + GEN / BigInt(2), GEN / BigInt(2));
    expect(o.verdict).toBe("refused");
  });
  it("delayed finalization is pending, not success", () => {
    expect(buyOutcome(undefined, BigInt(0), BigInt(0), GEN).verdict).toBe("pending");
  });
});

describe("withdraw_credit", () => {
  it("done when the credit reaches zero", () => {
    expect(creditOutcome(GEN, BigInt(0)).verdict).toBe("done");
  });
  it("pending while the credit is still shown", () => {
    expect(creditOutcome(GEN, GEN).verdict).toBe("pending");
  });
});
