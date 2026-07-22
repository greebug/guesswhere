// Synthesized feedback tones (Web Audio API) rather than shipped audio
// assets -- no files to source, license, or host for two short beeps.

let ctx: AudioContext | null = null;
function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

function tone(freq: number, startOffset: number, duration: number, gainPeak = 0.15) {
  const audio = getCtx();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = freq;
  osc.type = 'sine';
  const t0 = audio.currentTime + startOffset;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(gainPeak, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/** Two-note rising chime. */
export function playCorrect() {
  tone(660, 0, 0.15);
  tone(880, 0.1, 0.25);
}

/** Short low buzz. */
export function playIncorrect() {
  tone(180, 0, 0.2, 0.12);
}
