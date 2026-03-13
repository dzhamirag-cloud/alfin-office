let soundEnabled = true;
let audioCtx: AudioContext | null = null;
let bongBuffer: AudioBuffer | null = null;
let bufferLoading = false;

export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled;
}

export function isSoundEnabled(): boolean {
  return soundEnabled;
}

async function ensureBuffer(): Promise<AudioBuffer | null> {
  if (bongBuffer) return bongBuffer;
  if (bufferLoading) return null;
  bufferLoading = true;

  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    // Load the taco bell bong WAV
    const resp = await fetch('assets/taco-bell-bong.wav');
    const arrayBuf = await resp.arrayBuffer();
    bongBuffer = await audioCtx.decodeAudioData(arrayBuf);
    return bongBuffer;
  } catch {
    bufferLoading = false;
    return null;
  }
}

export async function playDoneSound(): Promise<void> {
  if (!soundEnabled) return;
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    const buffer = await ensureBuffer();
    if (!buffer) return;

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;

    const gain = audioCtx.createGain();
    gain.gain.value = 0.5;

    source.connect(gain);
    gain.connect(audioCtx.destination);
    source.start(0);
  } catch {
    // Audio may not be available
  }
}

/** Call from any user-gesture handler to ensure AudioContext is unlocked */
export function unlockAudio(): void {
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    // Pre-load the buffer
    ensureBuffer();
  } catch {
    // ignore
  }
}
