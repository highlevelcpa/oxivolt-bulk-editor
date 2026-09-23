// Client-side helpers for talking to our API using the Shopify App Bridge session token.

declare global {
  interface Window {
    shopify?: {
      idToken?: () => Promise<string>;
      toast?: { show: (msg: string, opts?: any) => void };
    };
  }
}

// Waits for App Bridge to be ready and returns a fresh session (id) token.
export async function getIdToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  for (let i = 0; i < 60; i++) {
    if (window?.shopify?.idToken) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!window?.shopify?.idToken) return null;
  try {
    return await window.shopify.idToken();
  } catch {
    return null;
  }
}

function buildRequest(input: string, token: string | null, init?: RequestInit): Response | Promise<Response> {
  const headers = new Headers(init?.headers ?? {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', 'application/json');
  return fetch(input, { ...(init ?? {}), headers });
}

export async function authFetch(input: string, init?: RequestInit): Promise<Response> {
  let token = await getIdToken();
  let res = await buildRequest(input, token, init);

  // The App Bridge session token is short-lived (~60s) and can be stale on the
  // first call after the tab has been idle. If the server rejects it as
  // "Unauthorized" (not a scope/reauth issue), fetch a guaranteed-fresh token
  // and retry the request once before giving up.
  if (res.status === 401) {
    let errCode = '';
    try {
      errCode = (await res.clone().json())?.error ?? '';
    } catch {
      errCode = '';
    }
    if (errCode === 'Unauthorized') {
      token = await getIdToken();
      res = await buildRequest(input, token, init);
    }
  }

  return res;
}
