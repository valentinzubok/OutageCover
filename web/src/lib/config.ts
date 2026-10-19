/** Live OutageCover deploy on GenLayer Studio Dev (chain 61997). Override via env. */
export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_OUTAGECOVER_ADDRESS ||
  "0xF99E82326c4971d36dC71Bec29985c358939991B") as `0x${string}`;

/** Studio Dev / Studio Next — chain ID 61997. */
export const CHAIN_ID = 61997;
export const RPC_URL =
  process.env.NEXT_PUBLIC_GENLAYER_RPC || "https://studio-dev.genlayer.com/api";
export const EXPLORER_BASE =
  process.env.NEXT_PUBLIC_GENLAYER_EXPLORER || "https://explorer-studio-dev.genlayer.com";
export const EXPLORER = `${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`;
export const txUrl = (hash: string) => `${EXPLORER_BASE}/tx/${hash}`;

export const GITHUB = "https://github.com/valentinzubok/OutageCover";

/** Demo status pages live in this repository, so every change to them is a public commit. */
export const DEMO_STATUS = "https://valentinzubok.github.io/OutageCover/fixtures/status-web.html";
export const DEMO_RULE =
  "Any incident the page marks as a major outage of the web dashboard that starts inside the cover period.";
