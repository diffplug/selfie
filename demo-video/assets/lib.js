// Shared art and helpers for the scenes. Everything here is deterministic, so every render is identical.
(function () {
  const INK = "#23232b", PINK = "#f4689f", CORAL = "#e35c61", TEAL = "#78acae", BLUE = "#63b9e3", ORANGE = "#f58a3c", SUN = "#ffd95e", PALE_BLUE = "#abcbf2", GREY = "#d7dbe3";

  /** A scene is authored against a nominal length, and its beats stretch to its slot. Move speeds stay as written. */
  function clock(id, authored) {
    const k = window.SCENE_DURATIONS[id] / authored;
    return (t) => t * k;
  }

  /**
   * When a scene's narration says a word, in seconds within the scene. nth counts repeats of it.
   * Pass after: true for when the word ends. An unknown word is an error, so a beat can't silently come loose.
   */
  function say(id, word, { nth = 0, after = false } = {}) {
    const plain = word.toLowerCase().replace(/[^a-z0-9]/g, "");
    const hit = window.SCENE_WORDS[id].filter(([w]) => w === plain)[nth];
    if (!hit) throw new Error(`Scene ${id} never says "${word}"`);
    return after ? hit[2] : hit[1];
  }

  /** Seeded, so every render is identical. */
  function rand(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function html(parent, markup) {
    const t = document.createElement("template");
    t.innerHTML = markup.trim();
    const el = t.content.firstElementChild;
    parent.appendChild(el);
    return el;
  }

  const bar = (x, y, w, h, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(h / 2, 6)}" fill="${fill}"/>`;
  const dot = (x, y, r, fill) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;

  const KINDS = {
    chart: { title: "Revenue", long: "Quarterly recurring revenue by reg…", draw(dense) {
      const hs = dense ? [40, 62, 30, 88, 52, 104, 70, 34, 96, 58, 110, 76] : [46, 74, 58, 104, 86, 118];
      const w = 196 / hs.length;
      return hs.map((h, i) => bar(4 + i * w, 128 - h, w - 5, h, i % 2 ? BLUE : TEAL)).join("");
    }, simple: () => bar(60, 70, 40, 58, TEAL) + bar(112, 40, 40, 88, BLUE) },
    list: { title: "Team", long: "Everyone in the Northern Hemisphere o…", draw(dense) {
      const n = dense ? 6 : 3, step = 128 / n;
      return Array.from({ length: n }, (_, i) => dot(16, step * i + step / 2, Math.min(step / 2 - 2, 15), [PINK, BLUE, ORANGE][i % 3]) + bar(40, step * i + step / 2 - 6, 150 - i * 12, 12, GREY)).join("");
    }, simple: () => dot(30, 64, 22, PINK) + bar(66, 56, 130, 16, GREY) },
    form: { title: "Sign up", long: "Create your extremely long account na…", draw(dense) {
      return bar(2, 4, 208, 30, GREY) + bar(2, 42, 208, 30, GREY) + (dense ? bar(2, 42, 208, 30, CORAL) : "");
    }, simple: () => bar(2, 26, 208, 30, GREY), button: true },
    profile: { title: "Profile", long: "Wolfeschlegelsteinhausenbergerdorff…", draw(dense) {
      return dot(50, 58, 42, ORANGE) + dot(50, 44, 15, "#fff") + `<path d="M24 86c6-24 46-24 52 0z" fill="#fff"/>` + bar(108, 26, 96, 14, GREY) + bar(108, 52, 72, 14, GREY) + bar(108, 78, dense ? 104 : 54, 14, dense ? CORAL : TEAL);
    }, simple: () => dot(106, 62, 44, ORANGE) + dot(106, 48, 15, "#fff") + `<path d="M80 90c6-24 46-24 52 0z" fill="#fff"/>` },
    stat: { title: "Sales", long: "Sales in every currency since the d…", draw(dense) {
      return `<text x="4" y="58" font-family="Jost" font-weight="800" font-size="${dense ? 32 : 54}" fill="${INK}">${dense ? "$1,204,399,210.07" : "$4,210"}</text>` + `<path d="M6 118 L46 96 L82 106 L122 76 L158 88 L204 62" fill="none" stroke="${PINK}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;
    }, simple: () => `<text x="106" y="84" text-anchor="middle" font-family="Jost" font-weight="800" font-size="62" fill="${INK}">$5</text>` },
    tabs: { title: "Settings", long: "Notification preferences for all of…", draw(dense) {
      const n = dense ? 5 : 3, step = 128 / n;
      return Array.from({ length: n }, (_, i) => bar(4, step * i + step / 2 - 6, 110, 12, GREY) + bar(150, step * i + step / 2 - 12, 54, 24, i % 2 ? GREY : TEAL) + dot(i % 2 ? 163 : 192, step * i + step / 2, 10, "#fff")).join("");
    }, simple: () => bar(4, 58, 110, 12, GREY) + bar(150, 52, 54, 24, TEAL) + dot(192, 64, 10, "#fff") },
  };

  const crackPath = `<svg class="crack" viewBox="0 0 245 190" preserveAspectRatio="none"><path d="M0 40 L60 72 L44 104 L112 118 L96 150 L150 190" fill="none" stroke="${CORAL}" stroke-width="7" stroke-linejoin="round"/><path d="M245 22 L190 60 L205 92 L150 96" fill="none" stroke="${CORAL}" stroke-width="7" stroke-linejoin="round"/></svg>`;

  function cardBody(kind, state, opts) {
    const k = KINDS[kind];
    if (state === "empty") {
      return `<rect x="4" y="6" width="204" height="118" rx="12" fill="none" stroke="${GREY}" stroke-width="5" stroke-dasharray="12 10"/><text x="106" y="74" text-anchor="middle" font-family="Jost" font-weight="600" font-size="22" fill="#8a8f9c">Nothing yet</text>`;
    }
    if (state === "error") {
      return `<path d="M106 12 L150 86 L62 86 Z" fill="${CORAL}" stroke="${CORAL}" stroke-width="10" stroke-linejoin="round"/><rect x="101" y="34" width="10" height="28" rx="4" fill="#fff"/><circle cx="106" cy="74" r="6" fill="#fff"/><text x="106" y="122" text-anchor="middle" font-family="Jost" font-weight="600" font-size="23" fill="${INK}">Couldn’t load</text>`;
    }
    const dense = state === "complex";
    let out = state === "simple" ? k.simple() : k.draw(dense);
    if (k.button) {
      const fill = opts.changed ? BLUE : PINK;
      const w = opts.changed ? 208 : 120, x = 2;
      out += `<g class="btn"><rect x="${x}" y="84" width="${w}" height="42" rx="${opts.changed ? 21 : 10}" fill="${fill}" stroke="${INK}" stroke-width="4"/><text x="${x + w / 2}" y="113" text-anchor="middle" font-family="Jost" font-weight="700" font-size="24" fill="#fff">Join</text></g>`;
    }
    return out;
  }

  /** A component in a state: easy, empty, error, simple or complex. 245 x 190 before scaling. */
  function card(parent, kind, state = "easy", opts = {}) {
    const k = KINDS[kind];
    const title = state === "complex" ? k.long : k.title;
    return html(parent, `<div class="card" data-layout-ignore><div class="t">${title}</div><svg class="body" viewBox="0 0 212 132">${cardBody(kind, state, opts)}</svg><div class="flag"></div>${crackPath}</div>`);
  }

  // The app and the grid put the same cards in different places, which is what lets a scene hand over to the next.
  const KIND_ORDER = ["chart", "form", "profile", "list", "stat", "tabs"];
  const STATES = ["easy", "empty", "error", "simple", "complex"];
  const APP = { x: 366, y: 142, scale: 1.55 };
  const appPos = (i) => ({ x: APP.x + 30 + (i % 3) * 392, y: APP.y + 28 + Math.floor(i / 3) * 312, scale: APP.scale, rotation: 0 });
  const rowPos = (c) => ({ x: 116 + c * 284, y: 330, scale: 1.1, rotation: 0 });
  const gridPos = (c, r) => ({ x: 214 + c * 268, y: 42 + r * 212, scale: 1, rotation: 0 });
  const FORM_BUTTON = (() => { const p = appPos(1); return { x: p.x + 110, y: p.y + 225 }; })();

  function appWindow(parent, id) {
    return html(parent, `<div class="window" id="${id}" style="left:${APP.x}px;top:${APP.y - 64}px;width:1212px;height:736px" data-layout-ignore><div class="bar"><span class="dot" style="background:${CORAL}"></span><span class="dot" style="background:${SUN}"></span><span class="dot" style="background:${TEAL}"></span><span class="url">acme.app</span></div></div>`);
  }

  const place = (el, p) => gsap.set(el, { x: p.x, y: p.y, scale: p.scale ?? 1, rotation: p.rotation ?? 0, transformOrigin: "0 0" });

  /**
   * The robot, 240 x 340 at scale 1: a plain cousin of the mascot, with its eyes and colors.
   * Returns its parts so a scene can act with them: head, armL, armR, legL, legR, eyes, smile, o, prop.
   */
  function robot(parent, opts = {}) {
    const { id = "", prop = "", scale = 1 } = opts;
    const props = {
      hammer: `<g class="rb-prop"><rect x="-4" y="-8" width="118" height="16" rx="6" fill="${ORANGE}" stroke="${INK}" stroke-width="6"/><rect x="96" y="-50" width="52" height="92" rx="10" fill="${GREY}" stroke="${INK}" stroke-width="6"/></g>`,
      phone: `<g class="rb-prop"><rect x="-26" y="-92" width="52" height="96" rx="9" fill="${PINK}" stroke="${INK}" stroke-width="6"/><circle cx="0" cy="-72" r="7" fill="${INK}"/></g>`,
      suitcase: `<g class="rb-prop"><path d="M-20 12 v-14 h40 v14" fill="none" stroke="${INK}" stroke-width="7"/><rect x="-48" y="10" width="96" height="66" rx="10" fill="${ORANGE}" stroke="${INK}" stroke-width="6"/><path d="M-48 38 H48" stroke="${INK}" stroke-width="5"/></g>`,
    };
    const el = html(parent, `<svg class="prop" ${id ? `id="${id}"` : ""} width="${240 * scale}" height="${340 * scale}" viewBox="0 0 240 340" data-layout-ignore>
      <g class="rb-legL"><rect x="82" y="238" width="30" height="78" rx="12" fill="${PALE_BLUE}" stroke="${INK}" stroke-width="6"/><path d="M70 332 q2 -24 26 -24 h18 v24 z" fill="${ORANGE}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/></g>
      <g class="rb-legR"><rect x="128" y="238" width="30" height="78" rx="12" fill="${PALE_BLUE}" stroke="${INK}" stroke-width="6"/><path d="M126 332 v-24 h18 q24 0 26 24 z" fill="${ORANGE}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/></g>
      <g class="rb-armL"><rect x="28" y="150" width="30" height="88" rx="14" fill="${TEAL}" stroke="${INK}" stroke-width="6"/><circle cx="43" cy="242" r="17" fill="${GREY}" stroke="${INK}" stroke-width="6"/></g>
      <rect x="56" y="136" width="128" height="116" rx="28" fill="${SUN}" stroke="${INK}" stroke-width="6"/>
      <path d="M88 166 h64 l-10 44 h-44 z" fill="${ORANGE}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
      <g class="rb-armR"><g transform="translate(197 242)">${props[prop] ?? ""}</g><rect x="182" y="150" width="30" height="88" rx="14" fill="${TEAL}" stroke="${INK}" stroke-width="6"/><circle cx="197" cy="242" r="17" fill="${GREY}" stroke="${INK}" stroke-width="6"/></g>
      <g class="rb-head">
        <rect x="50" y="34" width="140" height="104" rx="38" fill="${GREY}" stroke="${INK}" stroke-width="6"/>
        <g class="rb-eyes"><circle cx="90" cy="80" r="21" fill="${BLUE}" stroke="${INK}" stroke-width="6"/><circle cx="150" cy="80" r="21" fill="${BLUE}" stroke="${INK}" stroke-width="6"/><circle cx="94" cy="83" r="9" fill="${INK}"/><circle cx="154" cy="83" r="9" fill="${INK}"/><circle cx="97" cy="78" r="3.5" fill="#fff"/><circle cx="157" cy="78" r="3.5" fill="#fff"/></g>
        <path class="rb-smile" d="M100 112 q20 16 40 0" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
        <ellipse class="rb-o" cx="120" cy="118" rx="11" ry="12" fill="${INK}" opacity="0"/>
      </g>
    </svg>`);
    const part = (c) => el.querySelector(c);
    gsap.set(part(".rb-armR"), { svgOrigin: "197 158" });
    gsap.set(part(".rb-armL"), { svgOrigin: "43 158" });
    gsap.set(part(".rb-head"), { svgOrigin: "120 130" });
    gsap.set(part(".rb-eyes"), { svgOrigin: "120 80" });
    if (part(".rb-prop")) gsap.set(part(".rb-prop"), { svgOrigin: "0 0" });
    return { el, head: part(".rb-head"), armL: part(".rb-armL"), armR: part(".rb-armR"), legL: part(".rb-legL"), legR: part(".rb-legR"), eyes: part(".rb-eyes"), smile: part(".rb-smile"), o: part(".rb-o"), prop: part(".rb-prop") };
  }

  /**
   * A person's right hand, seen from the back, pointing up and to the left, with its sleeve running off-screen.
   * The element's origin is the fingertip, so placing the element places the point.
   */
  function hand(parent, id) {
    const SKIN = "#f3c6a5", CREASE = "#c98f6c";
    const line = `stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"`;
    const knuckle = (x0, x1, top) => `<path d="M${x0} 285 V${top + 30} C${x0} ${top + 12} ${x0 + 13} ${top} ${(x0 + x1) / 2} ${top} C${x1 - 13} ${top} ${x1} ${top + 12} ${x1} ${top + 30} V285" fill="${SKIN}" ${line}/>`;
    const crease = (x0, x1, y) => `<path d="M${x0} ${y} Q${(x0 + x1) / 2} ${y + 6} ${x1} ${y}" fill="none" stroke="${CREASE}" stroke-width="5" stroke-linecap="round"/>`;
    return html(parent, `<svg class="prop" id="${id}" width="10" height="10" viewBox="0 0 10 10" data-layout-ignore><g transform="rotate(-28)">
      <rect x="-28" y="480" width="204" height="1300" fill="${BLUE}" ${line}/>
      <g transform="translate(-22 352) rotate(-40)"><rect x="-31" y="-138" width="62" height="176" rx="31" fill="${SKIN}" ${line}/>${crease(-16, 16, -62)}</g>
      <path d="M-29 30 C-29 9 -15 0 0 0 C15 0 29 9 29 30 L31 205 L172 250 C196 280 190 335 166 388 L152 440 L-6 440 L-24 392 C-44 340 -42 270 -32 214 Z" fill="${SKIN}" ${line}/>
      <rect x="-17" y="9" width="34" height="38" rx="14" fill="#fbe6d8" stroke="${CREASE}" stroke-width="4"/>
      ${crease(-17, 17, 92)}${crease(-17, 17, 158)}
      ${knuckle(145, 192, 212)}${knuckle(90, 146, 188)}${knuckle(31, 91, 172)}
      ${crease(46, 76, 214)}${crease(104, 132, 228)}${crease(156, 182, 248)}
      <rect x="-40" y="424" width="228" height="64" rx="12" fill="#fff" ${line}/>
    </g></svg>`);
  }

  /** The cloud, flat with an ink outline. width x width * 0.56. */
  function cloud(parent, id, width) {
    return html(parent, `<svg class="prop" id="${id}" width="${width}" height="${width * 0.56}" viewBox="0 0 500 280" data-layout-ignore><path d="M110 260 C40 260 12 208 30 164 C10 120 54 74 104 92 C118 34 196 12 244 54 C282 14 366 28 380 92 C440 82 492 130 470 188 C488 232 448 262 400 260 Z" fill="#fff" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/></svg>`);
  }

  /** A photo of a component: the card, in a white frame. 283 x 256 before scaling. */
  function photo(parent, kind, state, opts = {}) {
    const el = html(parent, `<div class="photo" style="width:283px;height:256px" data-layout-ignore></div>`);
    const c = card(el, kind, state, opts);
    gsap.set(c, { x: 14, y: 14 });
    c.style.boxShadow = "none";
    if (opts.caption) html(el, `<div class="cap-text" style="position:absolute;left:0;right:0;bottom:6px;text-align:center;font:600 24px Jost,sans-serif">${opts.caption}</div>`);
    return el;
  }

  /** A shock ring centered on (x, y), expanding once. */
  function ringAt(tl, parent, x, y, t, { size = 900, color = CORAL, dur = 0.8 } = {}) {
    const r = html(parent, `<div class="ring" style="width:100px;height:100px;border-color:${color}" data-layout-ignore></div>`);
    gsap.set(r, { x: x - 50, y: y - 50, scale: 0.2, opacity: 0 });
    tl.set(r, { opacity: 0.95 }, t);
    tl.to(r, { scale: size / 100, opacity: 0, duration: dur, ease: "power2.out" }, t + 0.001);
    return r;
  }

  /** One swing of an arm-held prop: wind up, strike. The hit lands at t. */
  function swing(tl, arm, t, { rest = null, wind = 0.2 } = {}) {
    tl.to(arm, { rotation: -95, duration: wind, ease: "power2.out" }, t - 0.08 - wind);
    tl.to(arm, { rotation: HAMMER.angle, duration: 0.08, ease: "power3.in" }, t - 0.08);
    if (rest !== null) tl.to(arm, { rotation: rest, duration: 0.25, ease: "power2.out" }, t + 0.1);
  }

  /** A mouth change goes through a take rather than a snap. */
  function gasp(tl, r, t) {
    tl.to(r.smile, { opacity: 0, duration: 0.05 }, t);
    tl.to(r.o, { opacity: 1, duration: 0.05 }, t);
    tl.set(r.head, { scaleY: 0.92 }, t);
    tl.to(r.head, { scaleY: 1, duration: 0.45, ease: "elastic.out(1, 0.5)" }, t + 0.001);
  }

  function blink(tl, r, t) {
    tl.to(r.eyes, { scaleY: 0.1, duration: 0.05 }, t);
    tl.to(r.eyes, { scaleY: 1, duration: 0.07 }, t + 0.08);
  }

  /** A flash that lands at t. */
  function flash(tl, el, t, peak) {
    tl.set(el, { opacity: peak }, t);
    tl.to(el, { opacity: 0, duration: 0.32, ease: "power2.out" }, t + 0.001);
  }

  /** Text swapped at set times; each entry is [time, element]. Seek-safe, unlike writing into one node. */
  function ticker(tl, entries) {
    entries.forEach(([t, el], i) => {
      gsap.set(el, { opacity: 0 });
      tl.set(el, { opacity: 1 }, t);
      if (entries[i + 1]) tl.set(el, { opacity: 0 }, entries[i + 1][0]);
    });
  }

  // Where the hammer's face lands, in the robot's own 240 x 340 space, at the strike angle.
  const HAMMER = { x: 347, y: 248, angle: -15 };

  /** Build a scene's stage. Returns the timeline, its clock and the element to draw into. */
  function begin(id, authored = window.SCENE_DURATIONS[id]) {
    return { tl: gsap.timeline({ paused: true }), at: clock(id, authored), w: (word, o) => say(id, word, o), stage: document.getElementById(`${id}-stage`) };
  }

  /** Every component in every state, in the grid's places. cards[column][row]. */
  function grid(parent) {
    return KIND_ORDER.map((k, c) => STATES.map((st, r) => { const el = card(parent, k, st); place(el, gridPos(c, r)); return el; }));
  }
  const ROW_NAMES = ["", "Empty", "Error", "Simple", "Complex"];
  function rowLabels(parent) {
    return ROW_NAMES.map((n, r) => {
      const el = html(parent, `<div class="abs label" style="font-size:42px;font-weight:700;width:190px;text-align:right" data-layout-ignore>${n}</div>`);
      gsap.set(el, { x: 8, y: gridPos(0, r).y + 70 });
      return el;
    });
  }

  // The grid framed by Storybook, shared by the scenes on either side of the ripple.
  const GRID_CAM = { x: 184, y: 0, scale: 0.85 }; // The whole grid, clear of the subtitles.
  const FRAMED = { x: 530, y: 85, scale: 0.66 };
  const framedCell = (c, r) => { const p = gridPos(c, r); return { x: FRAMED.x + (p.x + 122) * FRAMED.scale, y: FRAMED.y + (p.y + 95) * FRAMED.scale }; };
  const STORIES = KIND_ORDER.map((k) => KINDS[k].title);
  function storybookFrame(parent) {
    const el = html(parent, `<div class="window" style="left:40px;top:34px;width:1840px;height:800px" data-layout-ignore><div class="bar"><span class="dot" style="background:${CORAL}"></span><span class="dot" style="background:${SUN}"></span><span class="dot" style="background:${TEAL}"></span><span class="url">localhost:6006</span></div><div style="position:absolute;left:0;top:64px;bottom:0;width:372px;border-right:6px solid ${INK};padding:26px 30px"><div class="display" style="font-size:54px;margin-bottom:26px">Storybook</div>${STORIES.map((n, i) => `<div class="sb-item" style="font:600 36px/1.15 Jost,sans-serif;padding:9px 16px;border-radius:10px;margin-bottom:6px">${n}</div>`).join("")}</div></div>`);
    return { el, items: [...el.querySelectorAll(".sb-item")] };
  }

  function camera(parent, id, scale = 1) {
    return html(parent, `<svg class="prop" id="${id}" width="${300 * scale}" height="${220 * scale}" viewBox="0 0 300 220" data-layout-ignore><rect x="96" y="6" width="96" height="36" rx="8" fill="${GREY}" stroke="${INK}" stroke-width="7"/><rect x="10" y="34" width="280" height="176" rx="22" fill="${TEAL}" stroke="${INK}" stroke-width="7"/><circle cx="150" cy="122" r="66" fill="#fff" stroke="${INK}" stroke-width="7"/><circle cx="150" cy="122" r="42" fill="${INK}"/><circle cx="166" cy="104" r="11" fill="#fff"/><rect x="226" y="54" width="44" height="28" rx="6" fill="${SUN}" stroke="${INK}" stroke-width="6"/></svg>`);
  }

  function rocket(parent, id) {
    const head = (cy) => `<g><circle cx="180" cy="${cy}" r="48" fill="#dff1ff" stroke="${INK}" stroke-width="8"/><rect x="156" y="${cy - 24}" width="48" height="40" rx="14" fill="${GREY}" stroke="${INK}" stroke-width="5"/><circle cx="170" cy="${cy - 6}" r="7" fill="${BLUE}" stroke="${INK}" stroke-width="3"/><circle cx="190" cy="${cy - 6}" r="7" fill="${BLUE}" stroke="${INK}" stroke-width="3"/><rect x="196" y="${cy + 2}" width="16" height="26" rx="4" fill="${PINK}" stroke="${INK}" stroke-width="3"/></g>`;
    const el = html(parent, `<svg class="prop" id="${id}" width="360" height="760" viewBox="0 0 360 760" data-layout-ignore><path d="M84 520 L10 660 L92 640 Z M276 520 L350 660 L268 640 Z" fill="${CORAL}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/><path d="M180 8 C270 90 290 240 280 400 L272 640 H88 L80 400 C70 240 90 90 180 8 Z" fill="#fff" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/><path d="M180 8 C226 50 254 106 268 170 H92 C106 106 134 50 180 8 Z" fill="${PINK}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>${head(240)}${head(372)}${head(504)}<rect x="110" y="640" width="140" height="40" fill="${GREY}" stroke="${INK}" stroke-width="8"/><path class="rk-fire" d="M124 684 C120 740 160 760 180 760 C200 760 240 740 236 684 Z" fill="${ORANGE}" stroke="${INK}" stroke-width="8" stroke-linejoin="round" opacity="0"/></svg>`);
    gsap.set(el.querySelector(".rk-fire"), { svgOrigin: "180 684" });
    return { el, fire: el.querySelector(".rk-fire") };
  }

  function plane(parent, id, scale = 1) {
    return html(parent, `<svg class="prop" id="${id}" width="${200 * scale}" height="${130 * scale}" viewBox="0 0 200 130" data-layout-ignore><path d="M4 66 L196 6 L128 124 L92 84 Z" fill="#fff" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/><path d="M92 84 L196 6 L78 102 Z" fill="${PINK}" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/></svg>`);
  }

  /** A selfie: the robot's face crowding a component. 283 x 256 before scaling. */
  function selfiePhoto(parent, kind, tilt) {
    const el = photo(parent, kind, "easy");
    const r = robot(el, { scale: 0.62 });
    gsap.set(r.el, { x: 136, y: 30 });
    gsap.set(r.head, { rotation: tilt });
    return el;
  }

  const DAMAGED = [[0, -6], [3, 8], [4, -4], [5, 7]];
  /** Where to stand a robot of this scale, so its hammer's face lands on this point. */
  const hammerAt = ({ x, y }, scale) => ({ x: x - HAMMER.x * scale, y: y - HAMMER.y * scale });
  const COLD_ROBOT = { scale: 1.6, ...hammerAt(FORM_BUTTON, 1.6) };

  window.S = { say, rand, hammerAt, html, card, photo, robot, hand, cloud, appWindow, appPos, rowPos, gridPos, place, ringAt, swing, gasp, blink, flash, ticker, FORM_BUTTON, begin, grid, rowLabels, GRID_CAM, FRAMED, framedCell, storybookFrame, camera, rocket, plane, selfiePhoto, DAMAGED, COLD_ROBOT, HAMMER, KIND_ORDER, INK, CORAL, TEAL, ORANGE, SUN, GREY };

  /** The pay-per-image booth: a cloud with a waiting bar, a button, a meter and a coin jar. */
  S.booth = function (stage) {
    const cl = S.cloud(stage, "", 800);
    gsap.set(cl, { x: 40, y: 20 });
    S.html(stage, `<div class="abs" style="left:0;top:905px;width:1920px;height:175px;background:#c6ccd8;border-top:7px solid var(--ink)" data-layout-ignore></div>`);
    S.html(stage, `<div class="abs label" style="left:300px;top:176px;font-size:46px;font-weight:700">Waiting…</div>`);
    S.html(stage, `<div class="abs" style="left:206px;top:236px;width:470px;height:50px;border:6px solid var(--ink);border-radius:25px;background:#fff" data-layout-ignore></div>`);
    S.html(stage, `<img class="abs" src="assets/chromatic-logo.svg" alt="Chromatic" style="left:286px;top:318px;width:300px;height:auto" data-layout-ignore />`);
    const bar = S.html(stage, `<div class="abs" style="left:216px;top:246px;width:450px;height:30px;border-radius:15px;background:var(--teal);transform-origin:0 50%" data-layout-ignore></div>`);
    gsap.set(bar, { scaleX: 0.02 });

    S.html(stage, `<div class="abs" style="left:1000px;top:60px;width:800px;height:300px;border:7px solid var(--ink);border-radius:26px;background:var(--grey);box-shadow:10px 10px 0 var(--ink)" data-layout-ignore></div>`);
    const screen = S.html(stage, `<div class="abs" style="left:1040px;top:96px;width:720px;height:166px;border-radius:14px;background:var(--ink)" data-layout-ignore></div>`);
    const per = S.html(stage, `<div class="abs label" style="left:1040px;top:280px;width:720px;text-align:center;font-size:48px;font-weight:700">0.8¢ per image</div>`);
    const digit = (t) => { const d = S.html(stage, `<div class="abs display" style="left:1040px;top:112px;width:720px;text-align:center;font-size:132px;color:var(--sun)">${t}</div>`); gsap.set(d, { opacity: 0 }); return d; };

    S.html(stage, `<div class="abs" style="left:380px;top:836px;width:360px;height:72px;background:var(--grey);border:7px solid var(--ink);border-radius:18px 18px 0 0;border-bottom:0" data-layout-ignore></div>`);
    const button = S.html(stage, `<div class="abs" style="left:460px;top:768px;width:200px;height:72px;background:var(--coral);border:7px solid var(--ink);border-radius:100px 100px 0 0;transform-origin:50% 100%" data-layout-ignore></div>`);

    const jar = S.html(stage, `<svg class="prop" width="520" height="500" viewBox="0 0 520 500" data-layout-ignore><path d="M8 0 V440 Q8 492 60 492 H460 Q512 492 512 440 V0" fill="rgba(255,255,255,.45)" stroke="#23232b" stroke-width="8"/></svg>`);
    gsap.set(jar, { x: 1150, y: 410 });
    return { bar, screen, per, digit, button, jar };
  };
  // Seams. A flash is a photo being taken, and a whip carries the eye sideways into the next idea.
  S.flashIn = function (tl, stage) {
    const white = S.html(stage, `<div class="flash" style="opacity:0.9"></div>`);
    tl.to(white, { opacity: 0, duration: 0.34, ease: "power2.out" }, 0.001);
  };
  S.whipOut = function (tl, stage, id) {
    tl.to(stage, { x: -1920, duration: 0.2, ease: "power3.in" }, window.SCENE_DURATIONS[id] - 0.21);
  };
  S.whipIn = function (tl, stage) {
    tl.fromTo(stage, { x: 1920 }, { x: 0, duration: 0.42, ease: "expo.out" }, 0);
  };
  S.press = function (tl, button, t) {
    tl.to(button, { scaleY: 0.72, duration: 0.07, ease: "power2.in" }, t);
    tl.to(button, { scaleY: 1, duration: 0.24, ease: "power2.out" }, t + 0.07);
  };
  /** A coin from the meter into the jar, landing at (x, y). */
  S.coinDrop = function (tl, stage, t, x, y, fall = 0.42) {
    const c = S.html(stage, `<div class="coin" data-layout-ignore></div>`);
    gsap.set(c, { x: 1370, y: 340, opacity: 0 });
    tl.set(c, { opacity: 1 }, t);
    tl.to(c, { x, duration: fall, ease: "none" }, t);
    tl.to(c, { y, duration: fall, ease: "bounce.out" }, t);
    return c;
  };
})();
