/**
 * Phoneme -> VRM blend-shape mapping.
 *
 * VRM spec defines 14 viseme blend shapes (aa, E, I, O, U, e, o, b, p, m,
 * f, v, l, w, etc). Our mapping reduces them to 7 common buckets so we
 * don't need the full 14-shape enum in the procedural fallback either.
 *
 * The producer side is text -> a time-sliced stream of viseme tags.
 * Each tag carries a single phoneme bucket + a duration. The avatar
 * loop schedules mouth shapes from the stream and blends them in.
 *
 * Why a custom function (vs eSpeak/NHK): we don't have a real TTS in
 * the prototype, so this is a heuristic. It's *good enough* that the
 * mouth opens and closes in roughly the right places; M4 will swap in
 * a real TTS that hands us a pre-baked phoneme timeline.
 */

/** VRM-style viseme buckets. Order matters for setVisemes() lookahead. */
export type Viseme =
  | 'sil' | 'aa' | 'E' | 'I' | 'O' | 'U' | 'bmp' | 'fv' | 'l' | 'wq' | 'etc';

/** A single frame of mouth shape. */
export interface VisemeFrame {
  v: Viseme;
  /** Duration in ms. */
  dur: number;
}

/* Lightweight CN/EN digraph -> viseme table. The matrix is small
 * but the rules cover the most common syllables. */
const DIGRAPHS: Record<string, Viseme> = {
  // English vowel teams + digraph consonants.
  'th': 'l', 'sh': 'E', 'ch': 'E', 'ph': 'fv', 'wh': 'wq',
  'ea': 'E', 'ee': 'I', 'oa': 'O', 'oo': 'U', 'ue': 'U',
  'mb': 'bmp', 'mp': 'bmp', 'ng': 'I', 'nk': 'I',
  // Chinese pinyin finals (vowel nuclei) -- they win over EN pair matches
  // because the text is in CJK most of the time.
  'ai': 'aa', 'ei': 'E', 'ui': 'U', 'ao': 'aa', 'ou': 'O',
  'iu': 'U', 'ie': 'I', 've': 'E', 'er': 'E',
  'an': 'aa', 'en': 'E', 'in': 'I', 'un': 'U', 'vn': 'U',
  'ang': 'aa', 'eng': 'E', 'ing': 'I', 'ong': 'O',
};

const SINGLES: Record<string, Viseme> = {
  a: 'aa', e: 'E', i: 'I', o: 'O', u: 'U',
  b: 'bmp', p: 'bmp', m: 'bmp',
  f: 'fv', v: 'fv',
  l: 'l', t: 'l', d: 'l', n: 'l',
  s: 'E', z: 'E', x: 'E', h: 'E', k: 'E', g: 'E',
  w: 'wq', q: 'E', j: 'E', y: 'I', c: 'E', r: 'E',
};

/** Convert text -> a stream of viseme frames.
 *  Each character is mapped via DIGRAPHS (longest match) then SINGLES
 *  (fallback). Spaces produce 'sil' frames. */
export function textToVisemes(text: string): VisemeFrame[] {
  const frames: VisemeFrame[] = [];
  const lower = text.toLowerCase();
  let i = 0;
  while (i < lower.length) {
    const c = lower[i];
    if (c === ' ' || c === '\n' || c === '\t') {
      frames.push({ v: 'sil', dur: 60 });
      i++;
      continue;
    }
    // Punctuation -> 80ms silence.
    if (/[\u3002\uff0c\uff01\uff1f.,!?;:]/.test(c)) {
      frames.push({ v: 'sil', dur: 90 });
      i++;
      continue;
    }
    // Latin-alphabet range: try the digraph table first.
    if (/[a-z]/.test(c)) {
      const pair = lower.slice(i, i + 2);
      const tri = lower.slice(i, i + 3);
      let v: Viseme | undefined = DIGRAPHS[pair] ?? DIGRAPHS[tri] ?? SINGLES[c];
      // Some 'v' cases are caught as 'U'; that's fine.
      if (c === 'w' || c === 'q') v = 'wq';
      if (!v) v = 'etc';
      // Faster letters = shorter frames.
      const dur = c === ' ' ? 60 : 90 + (i % 3) * 15;
      frames.push({ v, dur });
      i += pair in DIGRAPHS ? 2 : (tri in DIGRAPHS ? 3 : 1);
      continue;
    }
    // Han chars: bin into rough vowel nuclei.
    const hanMatch = matchHan(lower, i);
    frames.push({ v: hanMatch, dur: 110 + (i % 3) * 10 });
    i += 1;
  }
  // Collapse consecutive identical visemes.
  const out: VisemeFrame[] = [];
  for (const f of frames) {
    const last = out[out.length - 1];
    if (last && last.v === f.v) last.dur += f.dur;
    else out.push({ ...f });
  }
  return out.length ? out : [{ v: 'sil', dur: 80 }];
}

/** Tiny rule table for CJK. We match a final-vowel cluster against the
 *  character to bias which viseme it gets. */
function matchHan(text: string, i: number): Viseme {
  // Common finals, checked with a sliding window so 'n' before 'h'/'g'
  // tends to close (m/n/g), etc.
  const tail = text.slice(i, i + 4);
  if (/[aeiouāáǎà]/i.test(tail)) return 'aa';
  if (/[oóǒò]/i.test(tail)) return 'O';
  if (/[eéěè]/i.test(tail)) return 'E';
  if (/i|í|ǐ|ì/.test(tail)) return 'I';
  if (/u|ú|ǔ|ù|ü/.test(tail)) return 'U';
  if (/[bpm]/.test(tail)) return 'bmp';
  if (/[fvw]/.test(tail)) return 'fv';
  if (/[lndt]/.test(tail)) return 'l';
  return 'etc';
}

/** Helper used by the avatar loop: pick the next frame after a given
 *  cursor. Returns the frame index and the time the cursor will be
 *  "inside" that frame. */
export function scheduleVisemes(frames: VisemeFrame[], cursorMs: number): {
  cursorMs: number;
  frame: VisemeFrame;
  index: number;
} {
  if (frames.length === 0) return { cursorMs, frame: { v: 'sil', dur: 1000 }, index: -1 };
  let acc = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (cursorMs < acc + f.dur) return { cursorMs: acc, frame: f, index: i };
    acc += f.dur;
  }
  const last = frames.length - 1;
  return { cursorMs: acc, frame: frames[last], index: last };
}
