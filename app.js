/* うちの子ライブ LP の動き。動きを減らす設定の人には、自動再生・歩く子・現れる演出を出さない */
(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.classList.add(reduce ? "reduce" : "motion");

  /* 動画: 画面に入ったら再生、外れたら止める（通信量と電池） */
  const vids = document.querySelectorAll("main video");
  if (reduce) vids.forEach(v => { v.controls = true; });
  else {
    const io = new IntersectionObserver(es => es.forEach(e => {
      const v = e.target;
      if (e.isIntersecting) { if (v.preload === "none") v.preload = "auto"; v.play().catch(() => {}); } else v.pause();
    }), { threshold: 0.3 });
    vids.forEach(v => io.observe(v));
  }

  /* スクロールで現れる */
  const rv = document.querySelectorAll(".reveal");
  if (!reduce && "IntersectionObserver" in window) {
    const io2 = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add("in"); io2.unobserve(e.target); }
    }), { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    rv.forEach(el => io2.observe(el));
  } else rv.forEach(el => el.classList.add("in"));

  /* 見比べ（元の写真 ↔ 仕上げた絵） */
  const box = document.querySelector(".compare");
  if (box) {
    const range = box.querySelector(".c-range");
    const set = v => box.style.setProperty("--pos", v + "%");
    range.addEventListener("input", () => set(range.value));
    const S = window.UK_SAMPLES || { names: {} };
    const photo = box.querySelector(".c-photo"), portrait = box.querySelector(".c-portrait");
    const tabs = document.querySelectorAll(".tabs [role=tab]");
    const pick = btn => {
      const n = btn.dataset.pet;
      tabs.forEach(b => b.setAttribute("aria-selected", b === btn ? "true" : "false"));
      box.classList.add("swap");
      const done = () => box.classList.remove("swap");
      portrait.src = `/assets/${n}-portrait.jpg`; portrait.alt = `${S.portrait}: ${S.names[n] || ""}`;
      photo.src = `/assets/${n}-photo.jpg`; photo.alt = `${S.photo}: ${S.names[n] || ""}`;
      portrait.decode ? portrait.decode().then(done, done) : setTimeout(done, 200);
      range.value = 50; set(50);
    };
    tabs.forEach((b, i) => {
      b.addEventListener("click", () => pick(b));
      b.addEventListener("keydown", e => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const j = (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
        tabs[j].focus(); pick(tabs[j]);
      });
    });
    /* 最初の一度だけ、つまみが少し動いて「動かせる」ことを見せる */
    if (!reduce) {
      const hint = new IntersectionObserver(es => {
        if (!es[0].isIntersecting) return;
        hint.disconnect();
        let t0 = null;
        const step = ts => {
          t0 ??= ts;
          const k = (ts - t0) / 1600;
          if (k >= 1) { set(50); range.value = 50; return; }
          const v = 50 + Math.sin(k * Math.PI * 2) * 18;
          set(v); range.value = v;
          requestAnimationFrame(step);
        };
        setTimeout(() => requestAnimationFrame(step), 500);
      }, { threshold: 0.6 });
      hint.observe(box);
    }
  }

  /* ページの下を歩く子（Mac のデスクトップペットと同じ、背景を抜いた動画）。歩いて → 止まって → 座る */
  const walker = document.querySelector(".walker");
  if (walker && !reduce) {
    const v = walker.querySelector("video");
    const safari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
    const ext = safari ? "mov" : "webm";
    if (!safari && !v.canPlayType('video/webm; codecs="vp9"')) return;
    const src = n => `/assets/walk-${n}.${ext}`;
    const size = () => walker.getBoundingClientRect().width;
    /* 右の端から左へ少し歩いて（左右を反転）、右下の隅で止まって座る。本文やボタンの上には居座らない */
    let x = 0, raf = 0;
    const place = () => { walker.style.transform = `translateX(${x}px)`; };
    const play = (n, loop) => new Promise(res => {
      v.loop = loop; v.src = src(n);
      v.onended = () => res(); v.onerror = () => res();
      v.play().catch(() => res());
      if (loop) res();
    });
    const walkTo = target => new Promise(res => {
      let last = performance.now();
      const tick = now => {
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        const left = x - target;
        const speed = size() * 0.32 * (left < size() * 0.4 ? 0.55 : 1);   // 1秒に体の幅の 32%。止まる前はゆっくり
        x = Math.max(target, x - speed * dt);
        place();
        if (x <= target) { raf = 0; return res(); }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    const corner = () => innerWidth - size() - Math.max(12, innerWidth * 0.015);
    const start = async () => {
      walker.hidden = false;
      x = innerWidth + 4; place();
      requestAnimationFrame(() => walker.classList.add("on"));
      await play("walk", true);
      await walkTo(corner());
      await play("walk_to_stand", false);
      await play("stand_sit", false);
      await play("idle_sit", true);
    };
    addEventListener("resize", () => { if (!walker.hidden && !raf) { x = corner(); place(); } });
    /* 最初の画面を少し読んでから出てくる（いきなり動いて邪魔をしない） */
    let started = false;
    const go = () => { if (started) return; started = true; start(); };
    setTimeout(go, 4500);
    addEventListener("scroll", () => { if (scrollY > innerHeight * 0.5) go(); }, { once: true, passive: true });
    document.addEventListener("visibilitychange", () => { if (document.hidden) cancelAnimationFrame(raf); });
  }
})();
