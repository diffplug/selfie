// The robot's thumb follows the cursor near the shutter and presses it on click.
// Two-bone inverse kinematics: the thumb base pivots where it meets the palm, and
// the tip pivots at the knuckle. Both segment lengths stay fixed, so only the
// angles change. Coordinates are pixels of the 1373x1145 arm image.
(() => {
  const arm = document.querySelector(".arm");
  const base = arm && arm.querySelector(".thumb-base");
  const tip = arm && arm.querySelector(".thumb-tip");
  const shutter = document.querySelector(".shutter");
  if (!arm || !base || !tip || !shutter) return;

  const fine = matchMedia("(hover: hover) and (pointer: fine)");
  const calm = matchMedia("(prefers-reduced-motion: reduce)");

  const IMAGE_WIDTH = 1373;
  const B = { x: 960, y: 600 }; // base joint, where the thumb meets the palm
  const K = { x: 713, y: 510 }; // knuckle, between the base and the tip
  const T = { x: 512, y: 520 }; // the tip's contact point, resting on the shutter
  const L1 = Math.hypot(K.x - B.x, K.y - B.y);
  const L2 = Math.hypot(T.x - K.x, T.y - K.y);
  const REST1 = Math.atan2(K.y - B.y, K.x - B.x);
  const REST2 = Math.atan2(T.y - K.y, T.x - K.x) - REST1;
  const LIMIT1 = (10 * Math.PI) / 180; // straight cuts show a gap past this
  const LIMIT2 = (16 * Math.PI) / 180;
  const REACH = 0.9; // how far past the shutter's edge the thumb reaches, in shutter widths

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Where the tip lands for a given pair of joint rotations (relative to rest).
  function tipAt(d1, d2) {
    const a1 = REST1 + d1, a2 = a1 + REST2 + d2;
    const kx = B.x + L1 * Math.cos(a1), ky = B.y + L1 * Math.sin(a1);
    return { x: kx + L2 * Math.cos(a2), y: ky + L2 * Math.sin(a2) };
  }

  // The joint rotations, within their limits, that bring the tip closest to P. When P is
  // reachable the tip lands on it; otherwise the thumb leans toward it as far as it can.
  // A coarse grid, then a finer one around the best cell, is plenty for two joints.
  function solve(P) {
    let best = { d1: 0, d2: 0, e: Infinity };
    const search = (c1, c2, r1, r2, steps) => {
      for (let i = 0; i <= steps; i++) {
        const d1 = clamp(c1 - r1 + (2 * r1 * i) / steps, -LIMIT1, LIMIT1);
        for (let j = 0; j <= steps; j++) {
          const d2 = clamp(c2 - r2 + (2 * r2 * j) / steps, -LIMIT2, LIMIT2);
          const t = tipAt(d1, d2);
          const e = (t.x - P.x) ** 2 + (t.y - P.y) ** 2;
          if (e < best.e) best = { d1, d2, e };
        }
      }
    };
    search(0, 0, LIMIT1, LIMIT2, 16);
    search(best.d1, best.d2, LIMIT1 / 8, LIMIT2 / 8, 8);
    return { d1: best.d1, d2: best.d2 };
  }

  function toImage(clientX, clientY) {
    const r = arm.getBoundingClientRect();
    const s = r.width / IMAGE_WIDTH;
    return { x: (clientX - r.left) / s, y: (clientY - r.top) / s };
  }

  function shutterCenter() {
    const r = shutter.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
  }

  let cur = { d1: 0, d2: 0, s: 1 };
  let goal = { d1: 0, d2: 0, s: 1 };
  let frame = 0;
  let pressing = false;

  function render() {
    cur.d1 += (goal.d1 - cur.d1) * 0.22;
    cur.d2 += (goal.d2 - cur.d2) * 0.22;
    cur.s += (goal.s - cur.s) * 0.3;
    base.style.transform = `rotate(${cur.d1}rad)`;
    tip.style.transform = `rotate(${cur.d2}rad) scale(${cur.s})`;
    const settled = Math.abs(goal.d1 - cur.d1) < 1e-4 && Math.abs(goal.d2 - cur.d2) < 1e-4 && Math.abs(goal.s - cur.s) < 1e-4;
    frame = settled ? 0 : requestAnimationFrame(render);
  }

  function aim(target) {
    goal = { s: 1, ...target };
    if (!frame) frame = requestAnimationFrame(render);
  }

  function rest() {
    aim({ d1: 0, d2: 0 });
  }

  function follow(clientX, clientY) {
    if (pressing) return;
    const c = shutterCenter();
    const near = Math.hypot(clientX - c.x, clientY - c.y) < c.w * (0.5 + REACH);
    if (!near) return rest();
    // Land the tip just beside the cursor, so the thumb never hides what you point at.
    const p = toImage(clientX, clientY);
    aim(solve({ x: p.x + 16, y: p.y + 12 }));
  }

  // The screen faces the viewer, so a press pushes the tip away from us: from wherever
  // it's hovering, it dips a little and shrinks, as if moving into the screen.
  function press() {
    aim({ d1: cur.d1, d2: clamp(cur.d2 + (3 * Math.PI) / 180, -LIMIT2, LIMIT2), s: 0.95 });
  }

  function enabled() {
    return fine.matches && !calm.matches;
  }

  addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse" && enabled()) follow(e.clientX, e.clientY);
  }, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => { if (!pressing) rest(); });

  shutter.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || !enabled()) return;
    pressing = true;
    shutter.classList.add("pressed");
    press();
  });
  addEventListener("pointerup", (e) => {
    if (!pressing) return;
    pressing = false;
    shutter.classList.remove("pressed");
    follow(e.clientX, e.clientY);
  });
  shutter.addEventListener("focus", () => { if (enabled() && shutter.matches(":focus-visible")) press(); });
  shutter.addEventListener("blur", () => { if (!pressing) rest(); });

  calm.addEventListener("change", () => { if (!enabled()) { goal = { d1: 0, d2: 0, s: 1 }; cur = { d1: 0, d2: 0, s: 1 }; render(); } });
})();
