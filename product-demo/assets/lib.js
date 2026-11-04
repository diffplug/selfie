// What the scenes share: the app window and its pointer, the terminal, and when a word is said.
(function () {
  const say = (id, word, { nth = 0, after = false } = {}) => {
    const plain = word.toLowerCase().replace(/[^a-z0-9]/g, "");
    const hit = window.SCENE_WORDS[id].filter(([w]) => w === plain)[nth];
    if (!hit) throw new Error(`Scene ${id} never says "${word}"`);
    return after ? hit[2] : hit[1];
  };

  /** Where the pointer really was for a shot. An unknown name is an error, so it can't silently land elsewhere. */
  function pointNamed(name) {
    const point = window.UI_POINTS[name];
    if (!point) throw new Error(`No pointer position for "${name}"`);
    return point;
  }

  function html(parent, markup) {
    const t = document.createElement("template");
    t.innerHTML = markup.trim();
    return parent.appendChild(t.content.firstElementChild);
  }

  function begin(id) {
    return { tl: gsap.timeline({ paused: true }), w: (word, o) => say(id, word, o), stage: document.getElementById(`${id}-stage`), D: window.SCENE_DURATIONS[id] };
  }

  /**
   * The real app: each shot is a screenshot of a state it was really in, so a change of state is a cut, as it is on
   * screen. The pointer and the camera are the only things added. Coordinates are the page's, 1600 x 900.
   */
  function app(stage, names, { pointer = [1000, 500] } = {}) {
    const start = typeof pointer === "string" ? pointNamed(pointer) : pointer;
    const win = html(stage, `<div class="win" data-layout-ignore></div>`);
    const cam = html(win, `<div class="cam"></div>`);
    const shots = Object.fromEntries(names.map((n, i) => [n, html(cam, `<img class="shot" src="assets/ui/${n}.png" alt="" style="opacity:${i ? 0 : 1}" />`)]));
    const arrow = html(cam, `<svg class="pointer" viewBox="0 0 34 46"><path d="M3 2 L3 37 L12 29 L18.5 43 L25 40 L18.5 26.5 L30 26 Z" fill="#fff" stroke="#111" stroke-width="3" stroke-linejoin="round"/></svg>`);
    gsap.set(arrow, { x: start[0], y: start[1], transformOrigin: "3px 2px" });
    let showing = names[0];
    const api = {
      win, cam, arrow,
      show(tl, name, t) {
        tl.set(shots[name], { opacity: 1 }, t);
        tl.set(shots[showing], { opacity: 0 }, t);
        showing = name;
      },
      point(tl, t, to, dur = 0.55) {
        const [x, y] = typeof to === "string" ? pointNamed(to) : to;
        tl.to(arrow, { x, y, duration: dur, ease: "power3.inOut" }, t);
      },
      /** The press lands at t. */
      press(tl, t) {
        tl.to(arrow, { scale: 0.82, duration: 0.07, ease: "power2.in" }, t - 0.07);
        tl.to(arrow, { scale: 1, duration: 0.16, ease: "power2.out" }, t + 0.02);
      },
      /** Moves to fit this region of the page, or back out with no region. */
      zoom(tl, t, region, dur = 0.7) {
        const to = region ? fit(region) : { x: 0, y: 0, scale: 1 };
        tl.to(cam, { ...to, duration: dur, ease: "power2.inOut" }, t);
      },
      /** Starts already zoomed, to continue from a shot before. */
      zoomNow(region) {
        gsap.set(cam, fit(region));
      },
    };
    function fit({ x, y, w }) {
      const scale = 1600 / w;
      const h = 900 / scale;
      return { x: -Math.min(Math.max(x, 0), 1600 - w) * scale, y: -Math.min(Math.max(y, 0), 900 - h) * scale, scale };
    }
    return api;
  }

  /** The terminal. `write` takes rows of [time, markup, options]; `type` reveals a monospaced line a character at a time. */
  function term(stage) {
    const win = html(stage, `<div class="win term" data-layout-ignore></div>`);
    const rowY = (row) => 26 + row * 46;
    return {
      win,
      rowY,
      write(tl, rows) {
        rows.forEach(([t, markup, o = {}], i) => {
          const ln = html(win, `<div class="ln${o.hl ? " hl" : ""}" style="top:${rowY(o.row ?? i)}px">${markup}</div>`);
          if (t <= 0) return;
          if (o.type) {
            const chars = ln.textContent.length;
            gsap.set(ln, { clipPath: "inset(0 100% 0 0)" });
            tl.to(ln, { clipPath: "inset(0 0% 0 0)", duration: Math.min(chars * 0.028, 1.1), ease: `steps(${chars})` }, t);
          } else {
            gsap.set(ln, { opacity: 0 });
            tl.set(ln, { opacity: 1 }, t);
          }
        });
      },
    };
  }

  /** Text swapped at set times, one node at a time: seek-safe, unlike writing into one node. */
  function ticker(tl, entries) {
    entries.forEach(([t, el], i) => {
      gsap.set(el, { opacity: 0 });
      tl.set(el, { opacity: 1 }, t);
      if (entries[i + 1]) tl.set(el, { opacity: 0 }, entries[i + 1][0]);
    });
  }

  /** A word or number set on the frame, in frame coordinates. */
  function call(tl, stage, text, x, y, t, { until = null, style = "" } = {}) {
    const el = html(stage, `<div class="call" style="${style}" data-layout-ignore>${text}</div>`);
    gsap.set(el, { x, y, opacity: 0, scale: 0.86, transformOrigin: "50% 50%" });
    tl.to(el, { opacity: 1, scale: 1, duration: 0.26, ease: "back.out(2)" }, t);
    if (until !== null) tl.to(el, { opacity: 0, duration: 0.14 }, until);
    return el;
  }

  /** Terminal and app are different places, so going between them is a quick move. */
  const slideIn = (tl, el) => tl.fromTo(el, { x: 1920 }, { x: 0, duration: 0.4, ease: "expo.out" }, 0);
  const slideOut = (tl, el, D) => tl.to(el, { x: -1920, duration: 0.2, ease: "power3.in" }, D - 0.21);

  window.S = { html, begin, app, term, ticker, call, slideIn, slideOut };
})();
