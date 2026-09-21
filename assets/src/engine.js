// Seekable timeline: every visual is a pure function of t, so frames can be captured deterministically.
const TRACKS = [];
const STEPS = [];
const CUSTOM = [];
const ease = p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const clamp01 = v => Math.max(0, Math.min(1, v));

function tw(sel, prop, from, to, start, dur) {
  document.querySelectorAll(sel).forEach(el => TRACKS.push({ el, prop, from, to, start, dur }));
}
function step(sel, start, text) {
  document.querySelectorAll(sel).forEach(el => STEPS.push({ el, start, text }));
}
function custom(fn) { CUSTOM.push(fn); }

function valueAt(tracks, t) {
  let v = tracks[0].from;
  for (const k of tracks) {
    if (t < k.start) break;
    v = k.from + (k.to - k.from) * ease(clamp01((t - k.start) / k.dur));
  }
  return v;
}

window.seek = function (t) {
  const byEl = new Map();
  for (const k of TRACKS) {
    if (!byEl.has(k.el)) byEl.set(k.el, {});
    const props = byEl.get(k.el);
    (props[k.prop] = props[k.prop] || []).push(k);
  }
  for (const [el, props] of byEl) {
    const tf = { x: 0, y: 0, scale: 1 };
    let hasTf = false;
    for (const prop in props) {
      const v = valueAt(props[prop].sort((a, b) => a.start - b.start), t);
      if (prop in tf) { tf[prop] = v; hasTf = true; }
      else if (prop.startsWith('--')) el.style.setProperty(prop, v);
      else if (prop === 'opacity') el.style.opacity = v;
      else el.style[prop] = v + 'px';
    }
    if (hasTf) el.style.transform = `translate(${tf.x}px, ${tf.y}px) scale(${tf.scale})`;
  }
  const initial = new Map();
  for (const s of STEPS) {
    if (!s.el.dataset.initial) s.el.dataset.initial = s.el.innerHTML;
    if (!initial.has(s.el)) { s.el.innerHTML = s.el.dataset.initial; initial.set(s.el, true); }
  }
  STEPS.slice().sort((a, b) => a.start - b.start).forEach(s => { if (t >= s.start) s.el.innerHTML = s.text; });
  CUSTOM.forEach(fn => fn(t));
};

// Fade a caption in at `start` and out at `end`.
function caption(sel, start, end) {
  tw(sel, 'opacity', 0, 1, start, 0.35);
  tw(sel, 'y', 8, 0, start, 0.35);
  if (end != null) {
    tw(sel, 'opacity', 1, 0, end - 0.3, 0.3);
  }
}
// Count badge bump when its number changes.
function bump(sel, at) {
  tw(sel, 'scale', 1, 1.35, at, 0.15);
  tw(sel, 'scale', 1.35, 1, at + 0.15, 0.25);
}
