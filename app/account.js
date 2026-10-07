/* アカウントで迎えた子（ブラウザ版）。設計: docs/platform/pet-delivery-design.md 3節
   - ログイン（本番は Sign in with Apple。ローカルの試験ではメールとパスワード）→ library で自分の子を一覧 →
     bundle で目録と期限付き URL をもらう → 全ファイルを落として sha256 を確かめる → Cache Storage に保存
   - 保存し終わるまで「迎えた子」にしない（途中で切れても、前の版はそのまま使える）
   - 端末から消すのは、サーバーが「取り下げた」と明示した子だけ。一覧に無い・空・失敗では何も消さない
   - ログアウトしたら、この端末に保存したアカウントの子を全部消す
   設定は server.json（{ "url", "key", "devLogin" }）。無ければ何もしない（公開のサンプルだけの版）。
   index.html とは window.uchinokoAccount だけでつながる。 */
const CACHE = "uchinoko-pets-v1";
const SAVED = "uchinoko.server.pets";           // { id: { version, name } } 保存し終わった子
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SAFE_PATH = /^(?!\/)(?!.*\.\.)[a-z0-9_.\-\/]+$/;
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
             set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
const keyOf = (id, v, path) => new URL(`__pets/${id}/${v}/${path}`, location.href).href;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

let sb = null, cfg = null;

async function init() {
  try { const r = await fetch("server.json", { cache: "no-cache" }); if (!r.ok) return null; cfg = await r.json(); } catch (_) { return null; }
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  sb = createClient(cfg.url, cfg.key, { auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true } });
  return api;
}

async function call(name, body) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error("signed_out");
  const r = await fetch(`${cfg.url}/functions/v1/${name}`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: cfg.key, Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) throw new Error(`${name}:${r.status}`);
  return r.json();
}

async function forget(id) {
  const saved = ls.get(SAVED, {});
  delete saved[id]; ls.set(SAVED, saved);
  const c = await caches.open(CACHE);
  for (const req of await c.keys()) if (req.url.includes(`/__pets/${id}/`)) await c.delete(req);
}

const api = {
  devLogin: () => !!cfg.devLogin,
  async user() { const { data: { session } } = await sb.auth.getSession(); return session ? { id: session.user.id, email: session.user.email } : null; },
  signInApple() { return sb.auth.signInWithOAuth({ provider: "apple", options: { redirectTo: location.href.split("#")[0] } }); },
  async signInDev(email, password) { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; },
  async signOut() {
    for (const id of Object.keys(ls.get(SAVED, {}))) await forget(id);
    await sb.auth.signOut();
  },
  /* サーバーの一覧。取り下げと明示された子だけ端末から消す */
  async library() {
    const d = await call("library");
    for (const w of d.withdrawn || []) if (UUID.test(w.id)) await forget(w.id);
    return d.pets || [];
  },
  saved() { return ls.get(SAVED, {}); },
  /* 落として確かめてから保存。onProgress(済んだバイト, 全体) */
  async download(id, onProgress) {
    if (!UUID.test(id)) throw new Error("bad id");
    const b = await call("bundle", { pet_id: id });
    // desktop/（Mac のデスクトップペット用の背景を消した動画）はブラウザでは使わないので落とさない。
    // 動画は、このブラウザで使う形式（.mov・.webm・.mp4 のどれか。index.html の uchinokoClipExt）だけを落とす
    const ext = window.uchinokoClipExt ? window.uchinokoClipExt(b.manifest) : ".mp4";
    const files = (b.manifest.files || []).filter((f) => !f.path.startsWith("desktop/") && !(f.path.startsWith("clips/") && !f.path.endsWith(ext)));
    if (!files.every((f) => SAFE_PATH.test(f.path) && b.urls[f.path])) throw new Error("bad manifest");
    const total = files.reduce((s, f) => s + f.bytes, 0);
    let done = 0;
    const c = await caches.open(CACHE);
    for (const f of files) {
      const r = await fetch(b.urls[f.path]);            // URL は期限付き。ログや画面には出さない
      if (!r.ok) throw new Error("download");
      const buf = await r.arrayBuffer();
      if (hex(await crypto.subtle.digest("SHA-256", buf)) !== f.sha256) throw new Error("checksum");
      await c.put(keyOf(id, b.version, f.path), new Response(buf, { headers: { "Content-Type": r.headers.get("Content-Type") || "application/octet-stream" } }));
      done += f.bytes; onProgress && onProgress(done, total);
    }
    // 目録（pet.json）はサーバーの返した manifest をそのまま置く。id はサーバーの uuid にそろえる
    await c.put(keyOf(id, b.version, "pet.json"), new Response(JSON.stringify({ ...b.manifest, id }), { headers: { "Content-Type": "application/json" } }));
    // 全部そろったので、この版を「迎えた子」にする。古い版は消す
    const saved = ls.get(SAVED, {}), old = saved[id];
    saved[id] = { version: b.version, name: b.manifest.name };
    ls.set(SAVED, saved);
    if (old && old.version !== b.version)
      for (const req of await c.keys()) if (req.url.includes(`/__pets/${id}/${old.version}/`)) await c.delete(req);
    return saved[id];
  },
  /* 保存済みの子を index.html の形で返す（無ければ null） */
  async cachedPet(id) {
    const s = ls.get(SAVED, {})[id];
    if (!s) return null;
    const c = await caches.open(CACHE);
    const r = await c.match(keyOf(id, s.version, "pet.json"));
    if (!r) return null;
    const pet = await r.json();
    pet.base = "";
    pet.fromAccount = true;
    const ext = window.uchinokoClipExt ? window.uchinokoClipExt(pet) : ".mp4";
    pet.clipBlob = async (name) => { const m = await c.match(keyOf(id, s.version, `clips/${name}${ext}`)); if (!m) throw 0; return m.blob(); };
    pet.iconBlob = async () => { const m = await c.match(keyOf(id, s.version, pet.icon || "icon-180.png")); if (!m) throw 0; return m.blob(); };
    return pet;
  },
};

init().then((a) => { window.uchinokoAccount = a; dispatchEvent(new Event("uchinoko-account")); },
            () => { window.uchinokoAccount = null; dispatchEvent(new Event("uchinoko-account")); });
