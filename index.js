// Backend Cloudflare Worker + D1 — mosquée Bilal Ben Rabah
const enc = new TextEncoder();
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const lim = (v, n) => String(v ?? "").trim().slice(0, n);
const okStripe = (u) => { try { const x = new URL(u); return x.protocol === "https:" && /(^|\.)stripe\.com$/.test(x.hostname); } catch { return false; } };

async function hmac(secret, data) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
  return btoa(String.fromCharCode(...s)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const eq = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
const sign = async (env) => { const p = String(Date.now() + 12 * 3600e3); return p + "." + (await hmac(env.SESSION_SECRET, p)); };
async function authed(req, env) {
  const t = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
  const [p, sig] = t.split(".");
  if (!p || !sig || +p < Date.now()) return false;
  return eq(sig, await hmac(env.SESSION_SECRET, p));
}

async function login(req, env) {
  const ip = req.headers.get("CF-Connecting-IP") || "x", now = Date.now();
  const row = await env.DB.prepare("SELECT n,t FROM attempts WHERE ip=?").bind(ip).first();
  if (row && row.n >= 5 && now - row.t < 15 * 60e3) return J({ error: "limit", message: "Trop de tentatives. Réessayez dans 15 minutes." }, 429);
  const { password } = await req.json().catch(() => ({}));
  const good = typeof password === "string" && env.ADMIN_PASSWORD && eq(await hmac(env.SESSION_SECRET, password), await hmac(env.SESSION_SECRET, env.ADMIN_PASSWORD));
  if (!good) {
    const n = row && now - row.t < 15 * 60e3 ? row.n + 1 : 1;
    await env.DB.prepare("INSERT OR REPLACE INTO attempts(ip,n,t) VALUES(?,?,?)").bind(ip, n, now).run();
    return J({ error: "bad", message: "Mot de passe incorrect." }, 401);
  }
  await env.DB.prepare("DELETE FROM attempts WHERE ip=?").bind(ip).run();
  return J({ token: await sign(env) });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname;
    if (!path.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      if (path === "/api/public" && req.method === "GET") {
        const { results } = await env.DB.prepare("SELECT id,kind,title,body,when_text,place,created_at FROM posts ORDER BY id DESC LIMIT 200").all();
        const st = Object.fromEntries((await env.DB.prepare("SELECT key,value FROM settings").all()).results.map((r) => [r.key, r.value]));
        return J({
          news: results.filter((r) => r.kind === "news").map((r) => ({ id: r.id, d: r.created_at, t: r.title, x: r.body })),
          events: results.filter((r) => r.kind === "event").map((r) => ({ id: r.id, t: r.title, w: r.when_text, p: r.place, x: r.body })),
          stripe: { one: st.stripe_one || "", monthly: st.stripe_monthly || "" },
        });
      }
      if (path === "/api/login" && req.method === "POST") return await login(req, env);
      if (path.startsWith("/api/admin/")) {
        if (!(await authed(req, env))) return J({ error: "auth", message: "Session expirée." }, 401);
        if (path === "/api/admin/posts" && req.method === "POST") {
          const b = await req.json().catch(() => ({}));
          const kind = b.kind === "event" ? "event" : b.kind === "news" ? "news" : null;
          const title = lim(b.title, 150);
          if (!kind || !title) return J({ error: "invalid", message: "Titre obligatoire." }, 400);
          await env.DB.prepare("INSERT INTO posts(kind,title,body,when_text,place) VALUES(?,?,?,?,?)").bind(kind, title, lim(b.body, 2000), lim(b.when, 100), lim(b.place, 100)).run();
          return J({ ok: true });
        }
        const m = path.match(/^\/api\/admin\/posts\/(\d+)$/);
        if (m && req.method === "DELETE") { await env.DB.prepare("DELETE FROM posts WHERE id=?").bind(+m[1]).run(); return J({ ok: true }); }
        if (path === "/api/admin/settings" && req.method === "PUT") {
          const b = await req.json().catch(() => ({}));
          const one = lim(b.one, 500), mo = lim(b.monthly, 500);
          if ((one && !okStripe(one)) || (mo && !okStripe(mo))) return J({ error: "invalid", message: "Les liens doivent commencer par https:// et venir de stripe.com." }, 400);
          await env.DB.batch([
            env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('stripe_one',?)").bind(one),
            env.DB.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('stripe_monthly',?)").bind(mo),
          ]);
          return J({ ok: true });
        }
      }
      return J({ error: "notfound" }, 404);
    } catch (e) { return J({ error: "server", message: "Erreur serveur." }, 500); }
  },
};
