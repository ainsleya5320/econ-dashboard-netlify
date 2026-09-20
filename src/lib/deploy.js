// ============================================================================
// DEPLOY FLAGS — what is different about this build.
//
// This is the Netlify fork of econ-dashboard. The upstream app runs a Vite dev
// server whose configureServer hook answers ~60 /api routes live; here those
// answers are baked to static JSON at build time (scripts/bake.mjs) and served
// by the CDN. Three consequences, gathered here so the places that care can say
// why rather than each carrying its own explanation:
//
//   1. Nothing can be written back to the server. Anything the app used to POST
//      lives in this browser's localStorage instead.
//   2. There is no Anthropic key on the client, so the chat drawer is off.
//   3. API keys are never compiled into the bundle. The FRED data is already
//      baked; FMP, which is per-symbol and interactive, goes through a Netlify
//      function that holds the key server-side.
//
// Keeping the upstream code paths intact and gating them on these flags means a
// panel added upstream drops in here unchanged.
// ============================================================================

export const STATIC_BUILD = true;

// Placeholder handed to the ~19 components that gate their fetches on a key
// being present. The baked files and the FMP proxy both ignore it; it exists
// only so those guards stay truthy. It is not a credential.
export const KEY_PLACEHOLDER = "static-build";

export const LS = {
  dealbook: "econ-dashboard:special-dealbook",
};

export function lsGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

export function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
