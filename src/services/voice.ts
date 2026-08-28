/**
 * Speech in and out for the prototype, over the Web Speech API.
 *
 * This is deliberately the cheap path: it works today in a webview with no
 * model download and no native dependency. The production path — local Whisper
 * for capture and a viseme-emitting TTS for playback — is described in
 * docs/DESIGN.md § 语音链路; both sit behind this same interface.
 */

/**
 * `SpeechRecognition` ships in browsers but not in every lib.dom, so declare the
 * slice we use rather than pulling in an ambient dependency.
 */
interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
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
}

export class VoiceIO {
  private recognition: Recognizer | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private levelRaf = 0;
  private handlers: VoiceHandlers = {};

  get supported() {
    return Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);
  }

  /** True while the speech synthesiser is producing audio. */
  speaking = false;

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
  }

  /** Speak `text`, reporting a synthetic envelope so the avatar can move. */
  speak(text: string, onLevel?: (level: number) => void) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'zh-CN';
    utter.rate = 1.04;
    utter.pitch = 0.94;

    // The Web Speech API exposes no amplitude, so drive the avatar from
    // boundary events plus a decaying oscillator. Replaced wholesale by real
    // viseme data once a proper TTS is wired in.
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
        // RMS, scaled so ordinary speech lands around 0.5.
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
