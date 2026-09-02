/**
 * Speech in and out for the prototype, over the Web Speech API.
 *
 * M3-C/D: Web Speech synthesis + recognition are the cheap path that
 * works today in a webview. M3-E: barge-in — when the user starts
 * talking while we're speaking, we cancel the current utterance and
 * route the partial transcript to the session send().
 * M3-F: continuous listening — start a recogniser that stays open
 * until the user explicitly stops it, with a small VAD window that
 * auto-flushes after 800ms of silence.
 */

interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  start(): void;
  stop(): void;
}

type Ctor = new () => Recognizer;

declare global {
  interface Window {
    SpeechRecognition?: Ctor;
    webkitSpeechRecognition?: Ctor;
  }
}

export interface VoiceHandlers {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
  /** 0..1 envelope, sampled from the mic while listening. */
  onLevel?: (level: number) => void;
  /** Fires when barge-in is detected (user spoke while we were speaking). */
  onBargeIn?: (text: string) => void;
}

export interface ContinuousOptions extends VoiceHandlers {
  /** ms of silence before auto-flushing as final. Default 800. */
  silenceMs?: number;
  /** lang attribute. Default 'zh-CN'. */
  lang?: string;
}

export class VoiceIO {
  private recognition: Recognizer | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private levelRaf = 0;
  private handlers: VoiceHandlers = {};
  private silenceTimer: number | null = null;
  private continuousMode = false;
  private partialBuffer = '';
  /** True while the speech synthesiser is producing audio. */
  speaking = false;

  get supported() {
    return Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);
  }

  /** Single-shot listen. */
  async listen(handlers: VoiceHandlers) {
    this.handlers = handlers;
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) throw new Error('SpeechRecognition unavailable');

    const rec = new Recognition();
    rec.lang = 'zh-CN';
    rec.continuous = false;
    rec.interimResults = true;

    rec.onstart = () => handlers.onStart?.();
    rec.onerror = () => this.stopListening();
    rec.onend = () => {
      handlers.onEnd?.();
      this.teardownMeter();
    };
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) handlers.onFinal?.(r[0].transcript.trim());
        else interim += r[0].transcript;
      }
      if (interim) handlers.onPartial?.(interim);
    };

    this.recognition = rec;
    rec.start();
    void this.startMeter();
  }

  stopListening() {
    this.recognition?.stop();
    this.recognition = null;
    this.teardownMeter();
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.continuousMode = false;
  }

  /**
   * M3-F: continuous listen. The recogniser stays open across many
   * phrases; after each utterance we let Chrome restart it. Silence
   * longer than `silenceMs` flushes the accumulated partial as final.
   */
  startContinuous(opts: ContinuousOptions) {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) throw new Error('SpeechRecognition unavailable');
    this.continuousMode = true;
    this.handlers = opts;
    this.partialBuffer = '';
    void this.openRecogniser(opts.lang ?? 'zh-CN', opts.silenceMs ?? 800);
    void this.startMeter();
  }

  private openRecogniser(lang: string, silenceMs: number) {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition || !this.continuousMode) return;
    const rec = new Recognition();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.onstart = () => this.handlers.onStart?.();
    rec.onerror = () => this.scheduleReopen(lang, silenceMs);
    rec.onend = () => this.scheduleReopen(lang, silenceMs);
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const txt = r[0].transcript.trim();
          this.partialBuffer = '';
          // M3-E: if we're currently speaking, this is barge-in.
          if (this.speaking) {
            this.cancelSpeech();
            this.handlers.onBargeIn?.(txt);
          } else {
            this.handlers.onFinal?.(txt);
          }
        } else {
          interim += r[0].transcript;
        }
      }
      if (interim) {
        this.partialBuffer = interim;
        this.handlers.onPartial?.(interim);
        // VAD: reset silence timer on every new partial.
        if (this.silenceTimer) clearTimeout(this.silenceTimer);
        this.silenceTimer = window.setTimeout(() => {
          if (this.partialBuffer.trim() && !this.speaking) {
            const txt = this.partialBuffer.trim();
            this.partialBuffer = '';
            this.handlers.onFinal?.(txt);
          }
        }, silenceMs);
      }
    };
    this.recognition = rec;
    try {
      rec.start();
    } catch {
      this.scheduleReopen(lang, silenceMs);
    }
  }

  private scheduleReopen(lang: string, silenceMs: number) {
    if (!this.continuousMode) return;
    window.setTimeout(() => this.openRecogniser(lang, silenceMs), 200);
  }

  /** Speak `text`, reporting a synthetic envelope so the avatar can move.
   *  M3-E: while speaking, the recogniser (if continuous) will see its
   *  onresult events fire and call onBargeIn — the avatar goes silent. */
  speak(text: string, onLevel?: (level: number) => void) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'zh-CN';
    utter.rate = 1.04;
    utter.pitch = 0.94;

    let raf = 0;
    let energy = 0;
    const tick = () => {
      energy *= 0.92;
      onLevel?.(Math.min(1, energy + Math.random() * 0.06));
      raf = requestAnimationFrame(tick);
    };

    utter.onstart = () => {
      this.speaking = true;
      tick();
    };
    utter.onboundary = () => {
      energy = 0.55 + Math.random() * 0.4;
    };
    utter.onend = () => {
      this.speaking = false;
      cancelAnimationFrame(raf);
      onLevel?.(0);
    };

    window.speechSynthesis.speak(utter);
  }

  cancelSpeech() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    this.speaking = false;
  }

  /* ----------------------------------------------------------- metering */

  private async startMeter() {
    if (!this.handlers.onLevel) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioCtx = new AudioContext();
      const source = this.audioCtx.createMediaStreamSource(this.stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      source.connect(this.analyser);

      const buf = new Uint8Array(this.analyser.frequencyBinCount);
      const sample = () => {
        if (!this.analyser) return;
        this.analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) {
          const x = (v - 128) / 128;
          sum += x * x;
        }
        this.handlers.onLevel?.(Math.min(1, Math.sqrt(sum / buf.length) * 4.2));
        this.levelRaf = requestAnimationFrame(sample);
      };
      sample();
    } catch {
      /* Mic denied — text input still works, avatar just stays calm. */
    }
  }

  private teardownMeter() {
    cancelAnimationFrame(this.levelRaf);
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.audioCtx?.close();
    this.stream = null;
    this.audioCtx = null;
    this.analyser = null;
    this.handlers.onLevel?.(0);
  }
}

export const voice = new VoiceIO();
