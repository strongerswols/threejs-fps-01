// All sound is synthesised with WebAudio: no audio files, no network, nothing to load.
// A shot is a short filtered noise burst with a low thump; the plant beep, the explosion
// and the round stingers are oscillators and noise shaped by envelopes.
export function createAudio() {
  let context = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (context) return true;
    try {
      const AudioContext = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioContext) return false;
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = 0.35;
      master.connect(context.destination);
      noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      return false;
    }
    return true;
  }

  function unlock() {
    if (ensure() && context.state === 'suspended') context.resume().catch(() => {});
  }

  function noise({ duration, frequency, type = 'lowpass', gain = 0.5, when = 0 }) {
    if (!ensure()) return;
    const t = context.currentTime + when;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const amp = context.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(amp).connect(master);
    source.start(t);
    source.stop(t + duration + 0.02);
  }

  function tone({ frequency, endFrequency = null, duration, type = 'sine', gain = 0.3, when = 0 }) {
    if (!ensure()) return;
    const t = context.currentTime + when;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, t);
    if (endFrequency !== null) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, t + duration);
    const amp = context.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    oscillator.connect(amp).connect(master);
    oscillator.start(t);
    oscillator.stop(t + duration + 0.02);
  }

  return {
    unlock,
    // distance 0..1 scales the shot down; near shots stay loud.
    shot(kind, distance = 0) {
      const volume = Math.max(0.08, 0.6 - distance * 0.5);
      if (kind === 'rifle') {
        noise({ duration: 0.09, frequency: 1800, type: 'bandpass', gain: volume });
        tone({ frequency: 160, endFrequency: 55, duration: 0.1, type: 'triangle', gain: volume * 0.8 });
      } else if (kind === 'smg') {
        noise({ duration: 0.06, frequency: 2400, type: 'bandpass', gain: volume * 0.8 });
        tone({ frequency: 200, endFrequency: 70, duration: 0.07, type: 'triangle', gain: volume * 0.6 });
      } else {
        noise({ duration: 0.08, frequency: 1400, type: 'bandpass', gain: volume });
        tone({ frequency: 130, endFrequency: 50, duration: 0.09, type: 'triangle', gain: volume * 0.8 });
      }
    },
    dryFire() {
      tone({ frequency: 900, duration: 0.03, type: 'square', gain: 0.12 });
    },
    reload() {
      tone({ frequency: 500, duration: 0.04, type: 'square', gain: 0.12 });
      tone({ frequency: 350, duration: 0.04, type: 'square', gain: 0.12, when: 0.35 });
      tone({ frequency: 620, duration: 0.04, type: 'square', gain: 0.14, when: 0.7 });
    },
    hit(headshot) {
      tone({ frequency: headshot ? 1500 : 1050, duration: 0.05, type: 'sine', gain: 0.2 });
    },
    hurt() {
      tone({ frequency: 220, endFrequency: 110, duration: 0.12, type: 'sawtooth', gain: 0.16 });
    },
    step() {
      noise({ duration: 0.05, frequency: 500, type: 'lowpass', gain: 0.05 });
    },
    grenadeThrow() {
      noise({ duration: 0.12, frequency: 900, type: 'bandpass', gain: 0.15 });
    },
    explosion() {
      noise({ duration: 0.9, frequency: 400, type: 'lowpass', gain: 0.9 });
      tone({ frequency: 90, endFrequency: 28, duration: 0.8, type: 'sine', gain: 0.7 });
    },
    beep(final = false) {
      tone({ frequency: final ? 1400 : 980, duration: final ? 0.3 : 0.09, type: 'sine', gain: 0.2 });
    },
    plantTick() {
      tone({ frequency: 700, duration: 0.05, type: 'sine', gain: 0.12 });
    },
    buy() {
      tone({ frequency: 660, duration: 0.07, type: 'sine', gain: 0.18 });
      tone({ frequency: 990, duration: 0.09, type: 'sine', gain: 0.18, when: 0.08 });
    },
    roundWin() {
      [523, 659, 784].forEach((frequency, i) => tone({ frequency, duration: 0.16, type: 'triangle', gain: 0.2, when: i * 0.11 }));
    },
    roundLose() {
      [392, 330, 262].forEach((frequency, i) => tone({ frequency, duration: 0.18, type: 'triangle', gain: 0.18, when: i * 0.12 }));
    },
  };
}
