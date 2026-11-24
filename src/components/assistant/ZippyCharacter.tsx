import React, { useEffect, useId, useMemo } from 'react';
import { View } from 'react-native';
import Svg, { ClipPath, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import Animated, {
  cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import type { ZippyMood } from './zippyStore';

// ---- Palette (Concept E-furry · Soft Furry Hood) -------------------------------------------------
const FUR = '#9D1D27';
const FUR_HI = '#B83842';
const FUR_LO = '#7A151E';
const SHEEN = '#C45A62';
const GOLD = '#EFA834';
const EYE = '#1A1012';
const LINE = '#5A1A20';
const MOUTH_IN = '#7A1E26';
const TONGUE = '#E77F86';

// ---- Geometry (character space, from the approved board: body 28…172 × 28…218, face at 100,101) ---
const FACE = { cx: 100, cy: 101, rx: 42, ry: 36 };
const EYES: [number, number][] = [[86, 98], [114, 98]];
/** Square viewBoxes: full figure, and a head-and-hood bust for tiny sizes (header dock). */
const VB_FULL = { x: -5, y: 14, w: 210 };
const VB_BUST = { x: 18, y: 18, w: 164 };
/** Below this the figure is drawn as a bust without chest chevron / body fur so the face stays legible. */
const COMPACT_BELOW = 44;

type Pt = [number, number];
/** Body outline as cubic segments (start point + 6 continuous cubics). */
const BODY_START: Pt = [100, 28];
const BODY_SEGS: number[][] = [
  [150, 28, 172, 70, 170, 118],
  [168, 150, 176, 180, 172, 200],
  [168, 214, 140, 218, 100, 218],
  [60, 218, 32, 214, 28, 200],
  [24, 180, 32, 150, 30, 118],
  [28, 70, 50, 28, 100, 28],
];
const f = (n: number) => n.toFixed(1);

function bodyD(dx = 0, dy = 0) {
  let d = `M${f(BODY_START[0] + dx)},${f(BODY_START[1] + dy)}`;
  for (const s of BODY_SEGS) d += ` C${f(s[0] + dx)},${f(s[1] + dy)} ${f(s[2] + dx)},${f(s[3] + dy)} ${f(s[4] + dx)},${f(s[5] + dy)}`;
  return d + ' Z';
}

/** Deterministic PRNG so the fur is identical on every render / instance. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Points + outward normals sampled along the body outline. */
function sampleOutline(perSeg: number) {
  const out: { p: Pt; n: Pt }[] = [];
  let p0: Pt = BODY_START;
  for (const s of BODY_SEGS) {
    const p1: Pt = [s[0], s[1]], p2: Pt = [s[2], s[3]], p3: Pt = [s[4], s[5]];
    for (let i = 0; i < perSeg; i++) {
      const t = i / perSeg, u = 1 - t;
      const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
      const y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
      const tx = 3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]);
      const ty = 3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]);
      const l = Math.hypot(tx, ty) || 1;
      out.push({ p: [x, y], n: [ty / l, -tx / l] }); // clockwise outline → (ty, -tx) points outward
    }
    p0 = p3;
  }
  return out;
}

function inside(poly: Pt[], x: number, y: number) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** One short curved fibre from (x,y) along angle a (radians), as an SVG sub-path. */
function fibre(x: number, y: number, a: number, len: number, bend: number) {
  const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
  const mx = (x + ex) / 2 - Math.sin(a) * bend, my = (y + ey) / 2 + Math.cos(a) * bend;
  return `M${f(x)},${f(y)} Q${f(mx)},${f(my)} ${f(ex)},${f(ey)}`;
}

/**
 * Fur is pre-baked once at module load into a handful of multi-sub-path strings (one per tone),
 * so each Zippy is ~a dozen SVG nodes — no SVG filters (feTurbulence / blur are unreliable in RN).
 */
const FURS = (() => {
  const r = rng(122);
  const outline = sampleOutline(30);
  const poly = outline.map((o) => o.p);
  // Rim fibres: short, slightly irregular, crossing the silhouette outward.
  const rim = ['', '', '', ''];
  outline.forEach(({ p, n }, i) => {
    for (let k = 0; k < 2; k++) {
      const base = Math.atan2(n[1], n[0]) + (r() - 0.5) * 0.9;
      const sx = p[0] - n[0] * (1.5 + r() * 2), sy = p[1] - n[1] * (1.5 + r() * 2);
      rim[(i + k * 2 + Math.floor(r() * 2)) % 4] += fibre(sx, sy, base, 3.5 + r() * 3.5, (r() - 0.5) * 2.4);
    }
  });
  // Body pile: short fibres lying down-and-outward, skipping the face opening.
  const pile = ['', '', ''];
  const step = 7.5;
  for (let y = 34; y < 216; y += step) {
    for (let x = 32; x < 170; x += step) {
      const px = x + (r() - 0.5) * step, py = y + (r() - 0.5) * step;
      if (!inside(poly, px, py)) continue;
      const fx = (px - FACE.cx) / (FACE.rx + 9), fy = (py - FACE.cy) / (FACE.ry + 9);
      if (fx * fx + fy * fy < 1) continue;
      const a = Math.PI / 2 + ((px - 100) / 72) * 0.6 + (r() - 0.5) * 0.7;
      pile[Math.floor(r() * 3)] += fibre(px, py, a, 3.5 + r() * 3, (r() - 0.5) * 2);
    }
  }
  // Crown tufts — short soft teardrops along the top of the hood (not spikes).
  const TUFT: Pt[] = [[-1, 1], [-5, -3], [-3.5, -8.5], [0.5, -10], [0, -6], [5, -4], [4.5, 1]];
  const tuft = (tx: number, ty: number, deg: number, s: number) => {
    const c = Math.cos((deg * Math.PI) / 180), sn = Math.sin((deg * Math.PI) / 180);
    const q = TUFT.map(([x, y]) => [tx + (x * c - y * sn) * s, ty + (x * sn + y * c) * s]);
    return `M${f(q[0][0])},${f(q[0][1])} C${q.slice(1, 4).map((v) => `${f(v[0])},${f(v[1])}`).join(' ')} C${q.slice(4, 7).map((v) => `${f(v[0])},${f(v[1])}`).join(' ')} Z`;
  };
  const crown = { [FUR]: '', [FUR_HI]: '', [SHEEN]: '', [FUR_LO]: '' } as Record<string, string>;
  ([
    [58, 47, -42, 0.8, FUR], [70, 37, -28, 0.85, FUR_HI], [84, 31, -14, 0.85, FUR], [98, 29, -2, 0.85, SHEEN],
    [112, 30, 10, 0.85, FUR], [126, 35, 24, 0.85, FUR_HI], [140, 45, 38, 0.8, FUR], [91, 32, -8, 0.6, FUR_LO], [119, 34, 16, 0.6, FUR_LO],
  ] as [number, number, number, number, string][]).forEach(([x, y, d, s, c]) => { crown[c] += tuft(x, y, d, s); });
  return { rim, pile, crown, body: bodyD(), rimLight: bodyD(3, 4) };
})();

/** Rotated oval path (used for the little fuzzy arms). */
function oval(cx: number, cy: number, rx: number, ry: number, deg: number) {
  const k = 0.5523, c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
  const P = (x: number, y: number) => `${f(cx + x * c - y * s)},${f(cy + x * s + y * c)}`;
  return `M${P(0, -ry)} C${P(rx * k, -ry)} ${P(rx, -ry * k)} ${P(rx, 0)} C${P(rx, ry * k)} ${P(rx * k, ry)} ${P(0, ry)} C${P(-rx * k, ry)} ${P(-rx, ry * k)} ${P(-rx, 0)} C${P(-rx, -ry * k)} ${P(-rx * k, -ry)} ${P(0, -ry)} Z`;
}
const ARMS: Partial<Record<ZippyMood, string[]>> = {
  happy: [oval(30, 150, 10, 17, 55), oval(170, 150, 10, 17, -55)],
  cheer: [oval(32, 104, 10, 18, -28), oval(168, 104, 10, 18, 28)],
};

/** Per-mood pose: dot gaze (-1…1), body lean (deg), blush strength, resting chest glow. */
const POSE: Record<ZippyMood, { gx: number; gy: number; lean: number; blush: number; glow: number }> = {
  idle: { gx: 0, gy: 0, lean: 0, blush: 0.5, glow: 0.45 },
  happy: { gx: 0, gy: 0, lean: 0, blush: 0.7, glow: 0.6 },
  thinking: { gx: 0.7, gy: -0.8, lean: -6, blush: 0.4, glow: 0.4 },
  cheer: { gx: 0, gy: 0, lean: 0, blush: 0.85, glow: 0.85 },
};

/** Mood mouths in character space. `w` = face-line weight multiplier so they read at small sizes. */
function Mouth({ mood, w }: { mood: ZippyMood; w: number }) {
  switch (mood) {
    case 'happy':
      return <Path d="M90,107 Q100,118 110,107" stroke={LINE} strokeWidth={2.5 * w} fill="none" strokeLinecap="round" />;
    case 'cheer':
      return (
        <>
          <Path d="M90,105.5 Q100,107 110,105.5 Q108,120 100,120 Q92,120 90,105.5 Z" fill={MOUTH_IN} stroke={MOUTH_IN} strokeWidth={0.6 * w} strokeLinejoin="round" />
          <Path d="M94.5,114 Q100,110.5 105.5,114 Q103,118.5 100,118.5 Q97,118.5 94.5,114 Z" fill={TONGUE} />
        </>
      );
    case 'thinking':
      return <Path d="M95,111 Q101,112.5 107,109.5" stroke={LINE} strokeWidth={2.2 * w} fill="none" strokeLinecap="round" />;
    default:
      return <Path d="M93,109 Q100,115 107,109" stroke={LINE} strokeWidth={2.3 * w} fill="none" strokeLinecap="round" />;
  }
}

/** 4-point twinkle used around Zippy when cheering. */
function Sparkle({ size, delay, run, style }: { size: number; delay: number; run: boolean; style: object }) {
  const t = useSharedValue(run ? 0 : 1);
  useEffect(() => {
    if (!run) { cancelAnimation(t); t.value = 1; return; }
    t.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 420, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 520 }), withDelay(500, withTiming(0, { duration: 1 }))), -1));
    return () => cancelAnimation(t);
  }, [run, delay, t]);
  const a = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ scale: 0.5 + 0.6 * t.value }, { rotate: `${t.value * 45}deg` }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size }, style, a]}>
      <Svg width={size} height={size} viewBox="0 0 10 10">
        <Path d="M5 0 L6.2 3.8 L10 5 L6.2 6.2 L5 10 L3.8 6.2 L0 5 L3.8 3.8 Z" fill={GOLD} />
      </Svg>
    </Animated.View>
  );
}

/** Static plush figure (memoised per size class / mood / scarf). */
function FurryBody({ id, compact, mood, scarf, w }: { id: string; compact: boolean; mood: ZippyMood; scarf: boolean; w: number }) {
  const u = (k: string) => `url(#${id}${k})`;
  const arms = compact ? undefined : ARMS[mood];
  const blush = POSE[mood].blush;
  return (
    <>
      <Defs>
        <RadialGradient id={`${id}body`} cx="38%" cy="28%" r="80%">
          <Stop offset="0" stopColor="#C8464F" />
          <Stop offset="0.5" stopColor={FUR} />
          <Stop offset="1" stopColor="#651018" />
        </RadialGradient>
        <RadialGradient id={`${id}glow`} cx="50%" cy="62%" r="50%">
          <Stop offset="0" stopColor="#E06A72" stopOpacity={0.28} />
          <Stop offset="1" stopColor="#E06A72" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={`${id}under`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#4A0A12" stopOpacity={0.45} />
          <Stop offset="1" stopColor="#4A0A12" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={`${id}shadow`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#3A0C12" stopOpacity={0.32} />
          <Stop offset="1" stopColor="#3A0C12" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={`${id}cavity`} cx="50%" cy="50%" r="50%">
          <Stop offset="0.78" stopColor="#3E0810" stopOpacity={0.6} />
          <Stop offset="1" stopColor="#3E0810" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={`${id}face`} cx="46%" cy="38%" r="62%">
          <Stop offset="0" stopColor="#FFF9F3" />
          <Stop offset="0.62" stopColor="#F8E8DD" />
          <Stop offset="0.88" stopColor="#ECD2C6" />
          <Stop offset="1" stopColor="#D7ADA4" />
        </RadialGradient>
        <RadialGradient id={`${id}blush`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#F08A8A" stopOpacity={0.75} />
          <Stop offset="1" stopColor="#F08A8A" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={`${id}cglow`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={GOLD} stopOpacity={0.45} />
          <Stop offset="1" stopColor={GOLD} stopOpacity={0} />
        </RadialGradient>
        <LinearGradient id={`${id}gold`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFD983" />
          <Stop offset="0.5" stopColor={GOLD} />
          <Stop offset="1" stopColor="#D2861A" />
        </LinearGradient>
        <ClipPath id={`${id}clip`}><Path d={FURS.body} /></ClipPath>
      </Defs>

      {/* contact shadow */}
      {!compact && <Ellipse cx={100} cy={217} rx={70} ry={8} fill={u('shadow')} />}

      {/* fuzzy arms (behind the body) */}
      {arms?.map((d, i) => (
        <G key={i}>
          <Path d={d} fill="none" stroke={FUR_HI} strokeWidth={6} strokeDasharray="0.8 2.2" opacity={0.6} />
          <Path d={d} fill={u('body')} />
          <Path d={d} fill="none" stroke={SHEEN} strokeWidth={3.5} strokeDasharray="0.7 2" opacity={0.55} />
        </G>
      ))}

      {/* outer halo fibres (dashed wide strokes = radial fibres; only the outer half shows) */}
      <Path d={FURS.body} fill="none" stroke={FUR_HI} strokeWidth={12} strokeDasharray="0.9 2.1" opacity={0.45} />
      <Path d={FURS.body} fill="none" stroke={FUR_LO} strokeWidth={8.5} strokeDasharray="0.8 2.5" strokeDashoffset={1.4} opacity={0.7} />

      {/* plush body + inner glow */}
      <Path d={FURS.body} fill={u('body')} />
      <Path d={FURS.body} fill={u('glow')} />
      <G clipPath={u('clip')}>
        {!compact && (
          <>
            <Path d={FURS.pile[0]} stroke={FUR_HI} strokeWidth={1.4} strokeLinecap="round" fill="none" opacity={0.55} />
            <Path d={FURS.pile[1]} stroke={FUR_LO} strokeWidth={1.4} strokeLinecap="round" fill="none" opacity={0.5} />
            <Path d={FURS.pile[2]} stroke={SHEEN} strokeWidth={1.2} strokeLinecap="round" fill="none" opacity={0.4} />
          </>
        )}
        {/* thin rim light, top-left */}
        <Path d={FURS.rimLight} fill="none" stroke="#F6B5B5" strokeWidth={3.5} opacity={0.3} />
        {/* under shading */}
        <Ellipse cx={100} cy={226} rx={88} ry={26} fill={u('under')} />
      </G>

      {/* edge fibres crossing the silhouette */}
      <Path d={FURS.body} fill="none" stroke={SHEEN} strokeWidth={6} strokeDasharray="0.7 2.3" opacity={0.5} />
      {FURS.rim.map((d, i) => (
        <Path key={i} d={d} stroke={[FUR, FUR_HI, FUR_LO, SHEEN][i]} strokeWidth={compact ? 2 : 1.6} strokeLinecap="round" fill="none" opacity={0.85} />
      ))}

      {/* short soft crown tufts */}
      {Object.entries(FURS.crown).map(([c, d]) => <Path key={c} d={d} fill={c} />)}

      {/* hood fold below the opening */}
      {!scarf && (
        <>
          <Path d="M50,150 Q100,174 150,150" stroke="#5E0F17" strokeWidth={6} fill="none" opacity={0.25} strokeLinecap="round" />
          <Path d="M54,147 Q100,168 146,147" stroke={SHEEN} strokeWidth={2} fill="none" opacity={0.35} strokeLinecap="round" />
        </>
      )}

      {/* hood cavity, smooth pale face, blush */}
      <Ellipse cx={FACE.cx} cy={FACE.cy} rx={50} ry={44} fill={u('cavity')} />
      <Ellipse cx={FACE.cx} cy={FACE.cy} rx={FACE.rx} ry={FACE.ry} fill={u('face')} />
      <Ellipse cx={77} cy={110} rx={9} ry={5.5} fill={u('blush')} opacity={blush} />
      <Ellipse cx={123} cy={110} rx={9} ry={5.5} fill={u('blush')} opacity={blush} />

      {/* fuzzy lip around the opening */}
      <Ellipse cx={FACE.cx} cy={FACE.cy} rx={44} ry={38} fill="none" stroke={FUR_LO} strokeWidth={6} strokeDasharray="0.8 1.9" opacity={0.85} />
      <Ellipse cx={FACE.cx} cy={FACE.cy} rx={45.5} ry={39.5} fill="none" stroke={FUR_HI} strokeWidth={5} strokeDasharray="0.7 2" strokeDashoffset={1} opacity={0.8} />
      <Ellipse cx={FACE.cx} cy={FACE.cy} rx={47} ry={41} fill="none" stroke={SHEEN} strokeWidth={2.5} strokeDasharray="0.6 2.4" opacity={0.6} />

      {/* closed happy eyes (happy / cheer) and the thinking brow; dot eyes are animated views */}
      {(mood === 'happy' || mood === 'cheer') && (
        <>
          <Path d={mood === 'cheer' ? 'M80,98 Q86,91 92,98' : 'M81,99 Q86,93 91,99'} stroke={EYE} strokeWidth={2.6 * w} fill="none" strokeLinecap="round" />
          <Path d={mood === 'cheer' ? 'M108,98 Q114,91 120,98' : 'M109,99 Q114,93 119,99'} stroke={EYE} strokeWidth={2.6 * w} fill="none" strokeLinecap="round" />
        </>
      )}
      {mood === 'thinking' && <Path d="M85,86 Q90,83.5 94,85.5" stroke={LINE} strokeWidth={1.6 * w} fill="none" strokeLinecap="round" opacity={0.6} />}

      {/* glowing gold chest chevron (hidden in the tiny bust) */}
      {!compact && (
        <>
          <Ellipse cx={100} cy={182} rx={28} ry={18} fill={u('cglow')} />
          <Path d="M81,170 L100,184 L119,170 L119,180 L100,194 L81,180 Z" fill={u('gold')} stroke="#FFE3A3" strokeWidth={0.8} strokeLinejoin="round" />
        </>
      )}

      {/* soft gold scarf (two-wheeler only) — tails trail behind (left) */}
      {scarf && (
        <>
          <Path d="M46,152 C34,150 22,156 6,150 C10,160 22,166 42,163 Z" fill="#D2861A" />
          <Path d="M44,156 C32,160 22,170 10,170 C16,176 30,174 46,164 Z" fill={u('gold')} opacity={0.95} />
          <Path d="M33,144 Q100,166 167,144 L167,157 Q100,180 33,157 Z" fill={u('gold')} />
          <Path d="M36,147 Q100,168 164,147" stroke="#FFE3A3" strokeWidth={1.4} fill="none" opacity={0.7} strokeLinecap="round" />
          <Path d="M36,155 Q100,177 164,155" stroke="#B87315" strokeWidth={1.4} fill="none" opacity={0.45} strokeLinecap="round" />
        </>
      )}
    </>
  );
}

/** Contract for the character. `scarf` is set only by ZippyRide on the two-wheeler. */
export interface ZippyCharacterProps { size?: number; mood?: ZippyMood; speaking?: boolean; tapKey?: number; scarf?: boolean }

/**
 * ZippyCharacter — the ONE swappable character component. Everything else (floating bubble, header
 * dock, assistant sheet, ZippyRide vehicle mount) renders the character only through this component.
 *
 * Zippy (approved Concept E-furry · Soft Furry Hood): a maroon hooded plush with short velvety fur, a
 * fuzzy hood lip around a smooth pale face, tiny dot eyes, a small smile, soft blush and a glowing gold
 * chest chevron. Below 44dp it renders as a head-and-hood bust (no chevron / body pile) so it stays legible.
 * - Face: dot eyes blink and glance around; moods swap eyes / mouth / blush, lean and chest glow.
 * - Moods: idle (calm smile), happy (closed happy eyes, wider smile, arms out), thinking (eyes up-aside,
 *   lean, brow), cheer (open grin, arms up, hop, glow pulse, sparkles). `speaking` flaps the mouth.
 * - Tap reaction (bump `tapKey`): squash → stretch → spring back, with a wink.
 * All loops run on the UI thread via Reanimated; reduced motion → static face in the right mood.
 */
export function ZippyCharacter({ size = 56, mood = 'idle', speaking = false, tapKey = 0, scarf = false }: ZippyCharacterProps) {
  const reduce = useReducedMotion();
  const gid = `zg${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`; // unique per instance (orb, sheet, header)
  const pose = POSE[mood];
  const compact = size < COMPACT_BELOW;
  const vb = compact ? VB_BUST : VB_FULL;
  const px = (v: number, o: number) => ((v - o) / vb.w) * size; // character units → dp
  /** Face-line weight: thicken strokes as the figure shrinks so the smile never disappears. */
  const w = Math.min(2.2, Math.max(1, (compact ? 80 : 100) / size));

  const breathe = useSharedValue(1);
  const blink = useSharedValue(1);
  const wink = useSharedValue(1);
  const gx = useSharedValue(pose.gx);
  const gy = useSharedValue(pose.gy);
  const lean = useSharedValue(pose.lean);
  const glow = useSharedValue(pose.glow);
  const sx = useSharedValue(1);
  const sy = useSharedValue(1);
  const jump = useSharedValue(0);
  const tilt = useSharedValue(0);
  const hop = useSharedValue(0);
  const moodPop = useSharedValue(1);
  const mouth = useSharedValue(0);
  const talk = useSharedValue(speaking ? 1 : 0);

  // Breathing + blinking — always on (unless reduced motion).
  useEffect(() => {
    if (reduce) { breathe.value = 1; blink.value = 1; return; }
    breathe.value = withRepeat(withSequence(withTiming(1.03, { duration: 1700, easing: Easing.inOut(Easing.sin) }), withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.sin) })), -1);
    blink.value = withRepeat(withSequence(withDelay(2800, withTiming(0.1, { duration: 70 })), withTiming(1, { duration: 110 }), withDelay(2200, withTiming(1, { duration: 1 })), withTiming(0.1, { duration: 60 }), withTiming(1, { duration: 100 }), withDelay(180, withTiming(0.1, { duration: 60 })), withTiming(1, { duration: 100 })), -1);
    return () => { cancelAnimation(breathe); cancelAnimation(blink); };
  }, [reduce, breathe, blink]);

  // Mood → lean, gaze behaviour, chest glow and cheer hop.
  useEffect(() => {
    const p = POSE[mood];
    if (reduce) {
      gx.value = p.gx; gy.value = p.gy; lean.value = p.lean; glow.value = p.glow; hop.value = 0;
      return;
    }
    lean.value = withSpring(p.lean, { damping: 12, stiffness: 160 });
    moodPop.value = withSequence(withTiming(1.06, { duration: 110 }), withSpring(1, { damping: 7, stiffness: 240 }));
    const ease = { duration: 260, easing: Easing.inOut(Easing.quad) };
    if (mood === 'thinking') {
      // Eyes up and aside, drifting a little as if working something out.
      gx.value = withSequence(withTiming(p.gx, ease), withRepeat(withSequence(withDelay(900, withTiming(0.35, { duration: 500 })), withDelay(700, withTiming(p.gx, { duration: 500 }))), -1));
      gy.value = withTiming(p.gy, ease);
    } else {
      // Periodic glance: right… back… left-up… back.
      gx.value = withSequence(withTiming(p.gx, ease), withRepeat(withSequence(
        withDelay(2600, withTiming(0.85, ease)), withDelay(650, withTiming(p.gx, ease)),
        withDelay(3200, withTiming(-0.8, ease)), withDelay(600, withTiming(p.gx, ease)),
      ), -1));
      gy.value = withSequence(withTiming(p.gy, ease), withRepeat(withSequence(
        withDelay(2600, withTiming(p.gy, ease)), withDelay(650, withTiming(p.gy, ease)),
        withDelay(3200, withTiming(-0.6, ease)), withDelay(600, withTiming(p.gy, ease)),
      ), -1));
    }
    if (mood === 'cheer') {
      glow.value = withRepeat(withSequence(withTiming(1, { duration: 520, easing: Easing.inOut(Easing.sin) }), withTiming(0.55, { duration: 620, easing: Easing.inOut(Easing.sin) })), -1);
      hop.value = withRepeat(withSequence(withDelay(900, withTiming(-size * 0.09, { duration: 170, easing: Easing.out(Easing.quad) })), withTiming(0, { duration: 260, easing: Easing.bounce })), -1);
    } else {
      glow.value = withTiming(p.glow, { duration: 300 });
      hop.value = withTiming(0, { duration: 160 });
    }
    return () => { cancelAnimation(gx); cancelAnimation(gy); cancelAnimation(glow); cancelAnimation(hop); };
  }, [mood, reduce, size, gx, gy, lean, glow, hop, moodPop]);

  // Tap: squash (wide/short) → stretch (tall/thin, small jump) → spring back; wink the right eye.
  useEffect(() => {
    if (!tapKey || reduce) return;
    sx.value = withSequence(withTiming(1.14, { duration: 80 }), withTiming(0.92, { duration: 110 }), withSpring(1, { damping: 5, stiffness: 260 }));
    sy.value = withSequence(withTiming(0.85, { duration: 80 }), withTiming(1.1, { duration: 110 }), withSpring(1, { damping: 5, stiffness: 260 }));
    jump.value = withSequence(withTiming(0, { duration: 80 }), withTiming(-size * 0.12, { duration: 120, easing: Easing.out(Easing.quad) }), withSpring(0, { damping: 8, stiffness: 220 }));
    tilt.value = withSequence(withTiming(-8, { duration: 90 }), withSpring(0, { damping: 5, stiffness: 200 }));
    wink.value = withSequence(withTiming(0.1, { duration: 80 }), withDelay(300, withTiming(1, { duration: 120 })));
  }, [tapKey, reduce, size, sx, sy, jump, tilt, wink]);

  // Speaking: mouth flaps over the mood mouth.
  useEffect(() => {
    talk.value = reduce ? (speaking ? 1 : 0) : withTiming(speaking ? 1 : 0, { duration: 160 });
    if (speaking && !reduce) mouth.value = withRepeat(withSequence(withTiming(1, { duration: 130 }), withTiming(0.25, { duration: 110 }), withTiming(0.8, { duration: 120 }), withTiming(0, { duration: 140 })), -1);
    else mouth.value = withTiming(speaking ? 0.6 : 0, { duration: 120 });
  }, [speaking, reduce, mouth, talk]);

  // Tiny solid oval dot eyes: kept ≥ ~2dp so they read at 36dp.
  const eyeW = Math.max(compact ? 2.4 : 2.2, size * 0.036);
  const eyeH = eyeW * 1.25;
  const body = useAnimatedStyle(() => {
    const k = breathe.value * moodPop.value;
    return {
      transform: [
        // keep the squash grounded: shift down by the height lost
        { translateY: hop.value + jump.value + (1 - sy.value) * size * 0.45 },
        { rotate: `${tilt.value + lean.value}deg` },
        { scaleX: k * sx.value },
        { scaleY: k * sy.value },
      ],
    };
  });
  const eyeL = useAnimatedStyle(() => ({
    transform: [{ translateX: gx.value * size * 0.02 }, { translateY: gy.value * size * 0.016 }, { scaleY: blink.value }],
  }));
  const eyeR = useAnimatedStyle(() => ({
    transform: [{ translateX: gx.value * size * 0.02 }, { translateY: gy.value * size * 0.016 }, { scaleY: Math.min(blink.value, wink.value) }],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value, transform: [{ scale: 0.85 + 0.25 * glow.value }] }));
  const talkH = size * (compact ? 0.05 : 0.035);
  const mouthStyle = useAnimatedStyle(() => ({ opacity: talk.value, height: talkH * (0.6 + 1.4 * mouth.value) }));
  const moodMouthStyle = useAnimatedStyle(() => ({ opacity: 1 - talk.value }));

  const figure = useMemo(
    () => <FurryBody id={gid} compact={compact} mood={mood} scarf={scarf} w={w} />,
    [gid, compact, mood, scarf, w],
  );
  const viewBox = `${vb.x} ${vb.y} ${vb.w} ${vb.w}`;
  const dots = mood === 'idle' || mood === 'thinking';
  const talkW = px(115, vb.x) - px(100, vb.x);

  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <Animated.View style={[{ width: size, height: size }, body]}>
        <Svg width={size} height={size} viewBox={viewBox} style={{ position: 'absolute' }}>{figure}</Svg>
        {/* warm chest glow over the chevron (pulses when cheering) */}
        {!compact && (
          <Animated.View style={[{ position: 'absolute', left: px(66, vb.x), top: px(160, vb.y), width: px(134, vb.x) - px(66, vb.x), height: px(204, vb.y) - px(160, vb.y) }, glowStyle]}>
            <Svg width="100%" height="100%" viewBox="0 0 10 10" preserveAspectRatio="none">
              <Defs>
                <RadialGradient id={`${gid}pulse`} cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor={GOLD} stopOpacity={0.55} />
                  <Stop offset="1" stopColor={GOLD} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Ellipse cx={5} cy={5} rx={5} ry={5} fill={`url(#${gid}pulse)`} />
            </Svg>
          </Animated.View>
        )}
        {/* dot eyes (idle / thinking) */}
        {dots && EYES.map(([ex, ey], i) => (
          <Animated.View
            key={i}
            style={[{ position: 'absolute', left: px(ex, vb.x) - eyeW / 2, top: px(ey, vb.y) - eyeH / 2, width: eyeW, height: eyeH, borderRadius: eyeW, backgroundColor: EYE }, i === 0 ? eyeL : eyeR]}
          />
        ))}
        {/* mood mouth */}
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: size, height: size }, moodMouthStyle]}>
          <Svg width={size} height={size} viewBox={viewBox}><Mouth mood={mood} w={w} /></Svg>
        </Animated.View>
        {/* talking mouth */}
        <View style={{ position: 'absolute', top: px(107, vb.y), left: px(100, vb.x) - talkW / 2, width: talkW, alignItems: 'center' }}>
          <Animated.View style={[{ width: talkW, backgroundColor: MOUTH_IN, borderTopLeftRadius: talkW * 0.2, borderTopRightRadius: talkW * 0.2, borderBottomLeftRadius: talkW * 0.5, borderBottomRightRadius: talkW * 0.5, overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-end' }, mouthStyle]}>
            <View style={{ width: talkW * 0.6, height: talkH * 0.45, borderTopLeftRadius: size, borderTopRightRadius: size, backgroundColor: TONGUE }} />
          </Animated.View>
        </View>
      </Animated.View>
      {mood === 'cheer' && (
        <>
          <Sparkle size={size * 0.18} delay={0} run={!reduce} style={{ left: -size * 0.06, top: size * 0.12 }} />
          <Sparkle size={size * 0.15} delay={380} run={!reduce} style={{ right: -size * 0.06, top: size * 0.18 }} />
          <Sparkle size={size * 0.12} delay={760} run={!reduce} style={{ left: size * 0.0, bottom: size * 0.1 }} />
        </>
      )}
    </View>
  );
}
