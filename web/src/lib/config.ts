/** Live OutageCover deploy on GenLayer Studio Dev (chain 61997). Override via env. */
export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_OUTAGECOVER_ADDRESS ||
  "0x9A42C69cB0d0136065998d37Eb4bf00593686615") as `0x${string}`;

/** Studio Dev / Studio Next — chain ID 61997. */
export const CHAIN_ID = 61997;
export const RPC_URL =
  process.env.NEXT_PUBLIC_GENLAYER_RPC || "https://studio-dev.genlayer.com/api";
export const EXPLORER_BASE =
  process.env.NEXT_PUBLIC_GENLAYER_EXPLORER || "https://explorer-studio-dev.genlayer.com";
export const EXPLORER = `${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`;
export const txUrl = (hash: string) => `${EXPLORER_BASE}/tx/${hash}`;

export const GITHUB = "https://github.com/valentinzubok/OutageCover";

/** Demo provider: a site root that publishes /.well-known/genlayer-status.json. */
const RAW = "https://raw.githubusercontent.com/valentinzubok/OutageCover/main/web/public/fixtures/providers";
export const DEMO_SITE = RAW + "/harbor";
export const DEMO_STATUS = RAW + "/harbor/calm.html";
export const DEMO_UNVERIFIED_SITE = RAW + "/nobody";
export const DEMO_RULE =
  "Any incident the page marks as a major outage of the API that starts inside the cover period.";
