import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KaldiRecognizer, Model } from 'vosk-browser';

export type VoskWakeWordStatus =
  | 'disabled'
  | 'loading-model'
  | 'requesting-microphone'
  | 'ready'
  | 'wake-listening'
  | 'command-listening'
  | 'error';

type UseVoskWakeWordOptions = {
  enabled: boolean;
  paused: boolean;
  wakePhrase: string;
  modelUrl: string;
  onWake: () => void;
  onTranscriptFinal: (transcript: string) => void;
  onError?: (error: Error) => void;
};

type VoskWakeWordControls = {
  status: VoskWakeWordStatus;
  partialTranscript: string;
  lastTranscript: string;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
};

const COMMAND_TIMEOUT_MS = 8000;
const COMMAND_SILENCE_TIMEOUT_MS = 2200;
const MIN_MODEL_BYTES = 10 * 1024 * 1024;
const MODEL_LOAD_TIMEOUT_MS = 120_000;
const VOSK_AUDIO_WORKLET_URL = '/assets/speech-audio-processor.js';
const WAKE_VARIANTS = [
  'ehi ditto',
  'ehi dito',
  'ehi detto',
  'ehi ditta',
  'hei ditto',
  'hei dito',
  'hei detto',
  'hei ditta',
  'hey ditto',
  'hey dito',
  'hey detto',
  'hey ditta',
  'e ditto',
  'e dito',
  'e detto',
  'e ditta',
  'editto',
];
const DEBUG_VOSK_WAKE_WORD =
  new URLSearchParams(window.location.search).has('debugVosk') ||
  localStorage.getItem('ditto.debugVosk') === '1';

type VoskAudioNode = AudioWorkletNode | ScriptProcessorNode;
type VoskBrowserGlobal = {
  Model: new (modelUrl: string, logLevel?: number) => Model;
};

const VOSK_BROWSER_SCRIPT_URL = `${import.meta.env.BASE_URL}vendor/vosk-browser.js`;
const VOSK_BROWSER_SCRIPT_ID = 'ditto-vosk-browser-script';

let voskBrowserLoadPromise: Promise<VoskBrowserGlobal> | null = null;

function getVoskBrowserGlobal(): VoskBrowserGlobal | null {
  const globalScope = globalThis as typeof globalThis & { Vosk?: VoskBrowserGlobal };
  return globalScope.Vosk ?? null;
}

async function loadVoskBrowser(): Promise<VoskBrowserGlobal> {
  const existingVosk = getVoskBrowserGlobal();
  if (existingVosk) {
    return existingVosk;
  }

  if (voskBrowserLoadPromise) {
    return voskBrowserLoadPromise;
  }

  voskBrowserLoadPromise = new Promise<VoskBrowserGlobal>((resolve, reject) => {
    const existingScript = document.getElementById(VOSK_BROWSER_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existingScript ?? document.createElement('script');

    script.addEventListener(
      'load',
      () => {
        const loadedVosk = getVoskBrowserGlobal();
        if (loadedVosk) {
          resolve(loadedVosk);
          return;
        }

        voskBrowserLoadPromise = null;
        reject(new Error('Libreria Vosk non disponibile dopo il caricamento'));
      },
      { once: true },
    );
    script.addEventListener(
      'error',
      () => {
        voskBrowserLoadPromise = null;
        reject(new Error('Impossibile caricare la libreria Vosk'));
      },
      { once: true },
    );

    if (!existingScript) {
      script.id = VOSK_BROWSER_SCRIPT_ID;
      script.src = VOSK_BROWSER_SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return voskBrowserLoadPromise;
}

function normalizeSpeech(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildWakeVariants(wakePhrase: string): string[] {
  const normalizedWakePhrase = normalizeSpeech(wakePhrase);
  return Array.from(new Set([normalizedWakePhrase, ...WAKE_VARIANTS].filter(Boolean)));
}

function includesWakePhrase(text: string, wakeVariants: string[]): boolean {
  const normalizedText = normalizeSpeech(text);
  return wakeVariants.some((variant) => normalizedText.includes(variant));
}

function stripWakePhrase(text: string, wakeVariants: string[]): string {
  const normalizedText = normalizeSpeech(text);
  const matchedVariant = wakeVariants.find((variant) => normalizedText.includes(variant));

  if (!matchedVariant) {
    return text.trim();
  }

  const wakeIndex = normalizedText.indexOf(matchedVariant);
  const commandStart = wakeIndex + matchedVariant.length;
  return normalizedText.slice(commandStart).trim();
}

function createVoskError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === 'string' && error.trim()) {
    return new Error(error);
  }

  return new Error(fallbackMessage);
}

function debugVosk(message: string, details?: unknown): void {
  if (!DEBUG_VOSK_WAKE_WORD) {
    return;
  }

  if (details === undefined) {
    console.info(`[Vosk wake-word] ${message}`);
    return;
  }

  console.info(`[Vosk wake-word] ${message}`, details);
}

async function assertModelAssetAvailable(modelUrl: string): Promise<void> {
  const response = await fetch(modelUrl, { method: 'HEAD', cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Modello Vosk non trovato: ${modelUrl} (${response.status})`);
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > 0 && contentLength < MIN_MODEL_BYTES) {
    throw new Error(`Il file modello Vosk sembra incompleto: ${modelUrl}`);
  }

  debugVosk('model asset available', {
    modelUrl,
    contentLength: contentLength || 'unknown',
  });
}

async function loadVoskModel(modelUrl: string): Promise<Model> {
  await assertModelAssetAvailable(modelUrl);
  const { Model: VoskModel } = await loadVoskBrowser();
  const model = new VoskModel(modelUrl, -1);

  return new Promise<Model>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      model.terminate();
      reject(new Error('Timeout caricamento modello Vosk'));
    }, MODEL_LOAD_TIMEOUT_MS);

    model.on('load', (message) => {
      window.clearTimeout(timeoutId);
      if (message.event === 'load' && message.result) {
        resolve(model);
        return;
      }

      model.terminate();
      reject(new Error('Caricamento modello Vosk non riuscito'));
    });

    model.on('error', (message) => {
      window.clearTimeout(timeoutId);
      model.terminate();
      reject(new Error(message.error || 'Errore caricamento modello Vosk'));
    });
  });
}

export function useVoskWakeWord({
  enabled,
  paused,
  wakePhrase,
  modelUrl,
  onWake,
  onTranscriptFinal,
  onError,
}: UseVoskWakeWordOptions): VoskWakeWordControls {
  const [status, setStatus] = useState<VoskWakeWordStatus>(enabled ? 'ready' : 'disabled');
  const [partialTranscript, setPartialTranscript] = useState('');
  const [lastTranscript, setLastTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const audioChunksRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const commandTimeoutRef = useRef<number | null>(null);
  const silenceTimeoutRef = useRef<number | null>(null);
  const modelRef = useRef<Model | null>(null);
  const processorRef = useRef<VoskAudioNode | null>(null);
  const recognizerRef = useRef<KaldiRecognizer | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const commandPartialRef = useRef('');
  const modeRef = useRef<'wake' | 'command'>('wake');
  const startTokenRef = useRef(0);
  const onErrorRef = useRef(onError);
  const onTranscriptFinalRef = useRef(onTranscriptFinal);
  const onWakeRef = useRef(onWake);

  const wakeVariants = useMemo(() => buildWakeVariants(wakePhrase), [wakePhrase]);

  useEffect(() => {
    onWakeRef.current = onWake;
    onTranscriptFinalRef.current = onTranscriptFinal;
    onErrorRef.current = onError;
  }, [onError, onTranscriptFinal, onWake]);

  const clearCommandTimers = useCallback(() => {
    if (commandTimeoutRef.current !== null) {
      window.clearTimeout(commandTimeoutRef.current);
      commandTimeoutRef.current = null;
    }

    if (silenceTimeoutRef.current !== null) {
      window.clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
  }, []);

  const resetCommandMode = useCallback(() => {
    clearCommandTimers();
    modeRef.current = 'wake';
    commandPartialRef.current = '';
    setPartialTranscript('');
  }, [clearCommandTimers]);

  const finishCommand = useCallback(
    (rawTranscript: string) => {
      const transcript = normalizeSpeech(rawTranscript);
      resetCommandMode();
      setStatus(enabled && !paused ? 'wake-listening' : enabled ? 'ready' : 'disabled');

      if (!transcript) {
        return;
      }

      setLastTranscript(transcript);
      onTranscriptFinalRef.current(transcript);
    },
    [enabled, paused, resetCommandMode]
  );

  const scheduleCommandSilenceTimeout = useCallback(() => {
    if (silenceTimeoutRef.current !== null) {
      window.clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }

    silenceTimeoutRef.current = window.setTimeout(() => {
      finishCommand(commandPartialRef.current);
    }, COMMAND_SILENCE_TIMEOUT_MS);
  }, [finishCommand]);

  const enterCommandMode = useCallback(
    (triggerText: string) => {
      if (modeRef.current === 'command') {
        return;
      }

      modeRef.current = 'command';
      debugVosk('wake detected', { triggerText });
      setStatus('command-listening');
      setError(null);
      commandPartialRef.current = stripWakePhrase(triggerText, wakeVariants);
      setPartialTranscript(commandPartialRef.current);
      onWakeRef.current();

      clearCommandTimers();
      commandTimeoutRef.current = window.setTimeout(() => {
        finishCommand(commandPartialRef.current);
      }, COMMAND_TIMEOUT_MS);

      if (commandPartialRef.current) {
        scheduleCommandSilenceTimeout();
      }
    },
    [clearCommandTimers, finishCommand, scheduleCommandSilenceTimeout, wakeVariants]
  );

  const handleFailure = useCallback((rawError: unknown, fallbackMessage: string) => {
    const voskError = createVoskError(rawError, fallbackMessage);
    setError(voskError.message);
    setStatus('error');
    onErrorRef.current?.(voskError);
  }, []);

  const removeRecognizer = useCallback(() => {
    if (!recognizerRef.current) {
      return;
    }

    recognizerRef.current.remove();
    recognizerRef.current = null;
  }, []);

  const stop = useCallback(() => {
    startTokenRef.current += 1;
    debugVosk('stop');
    resetCommandMode();
    removeRecognizer();

    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      if ('onaudioprocess' in processorRef.current) {
        processorRef.current.onaudioprocess = null;
      } else {
        processorRef.current.port.close();
      }
      processorRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }

    setStatus(enabled ? 'ready' : 'disabled');
  }, [enabled, removeRecognizer, resetCommandMode]);

  const start = useCallback(async () => {
    if (!enabled || paused || recognizerRef.current) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      handleFailure(new Error('Microfono non disponibile in questo browser'), 'Microfono non disponibile');
      return;
    }

    const startToken = startTokenRef.current + 1;
    startTokenRef.current = startToken;
    setError(null);

    try {
      if (!modelRef.current) {
        setStatus('loading-model');
        debugVosk('loading model', { modelUrl });
        modelRef.current = await loadVoskModel(modelUrl);
        debugVosk('model ready');
      }

      if (startTokenRef.current !== startToken || !enabled || paused) {
        return;
      }

      setStatus('requesting-microphone');
      debugVosk('requesting microphone');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
          sampleRate: 16000,
        },
      });

      if (startTokenRef.current !== startToken || !enabled || paused) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const AudioContextCtor =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error('Web Audio API non disponibile in questo browser');
      }

      const audioContext = new AudioContextCtor();
      audioChunksRef.current = 0;
      const source = audioContext.createMediaStreamSource(stream);
      const recognizer = new modelRef.current.KaldiRecognizer(audioContext.sampleRate);
      debugVosk('recognizer ready', { sampleRate: audioContext.sampleRate });

      recognizer.on('result', (message) => {
        if (message.event === 'error') {
          handleFailure(message.error, 'Errore nel riconoscimento vocale');
          return;
        }

        const text = message.result.text.trim();
        if (!text) {
          return;
        }

        debugVosk('final result', { text, mode: modeRef.current });

        if (modeRef.current === 'wake') {
          if (includesWakePhrase(text, wakeVariants)) {
            enterCommandMode(text);
          }
          return;
        }

        const command = stripWakePhrase(text, wakeVariants);
        if (command) {
          finishCommand(command);
        }
      });

      recognizer.on('partialresult', (message) => {
        if (message.event === 'error') {
          handleFailure(message.error, 'Errore nel riconoscimento vocale');
          return;
        }

        const text = message.result.partial.trim();
        if (!text) {
          return;
        }

        debugVosk('partial result', { text, mode: modeRef.current });

        if (modeRef.current === 'wake') {
          if (includesWakePhrase(text, wakeVariants)) {
            enterCommandMode(text);
          }
          return;
        }

        const command = stripWakePhrase(text, wakeVariants);
        commandPartialRef.current = command;
        setPartialTranscript(command);
        if (command) {
          scheduleCommandSilenceTimeout();
        }
      });

      let processor: VoskAudioNode;
      if (audioContext.audioWorklet) {
        await audioContext.audioWorklet.addModule(VOSK_AUDIO_WORKLET_URL);
        processor = new AudioWorkletNode(audioContext, 'vosk-audio-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        processor.port.onmessage = (event: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => {
          try {
            audioChunksRef.current += 1;
            if (audioChunksRef.current === 1 || audioChunksRef.current % 100 === 0) {
              debugVosk('audio chunks received', {
                chunks: audioChunksRef.current,
                sampleRate: event.data.sampleRate,
                samples: event.data.samples.length,
              });
            }
            recognizer.acceptWaveformFloat(event.data.samples, event.data.sampleRate);
          } catch (acceptError) {
            handleFailure(acceptError, 'Errore nel processamento audio Vosk');
          }
        };
      } else {
        processor = audioContext.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (event) => {
          try {
            recognizer.acceptWaveform(event.inputBuffer);
          } catch (acceptError) {
            handleFailure(acceptError, 'Errore nel processamento audio Vosk');
          }
        };
      }

      source.connect(processor);
      processor.connect(audioContext.destination);

      audioContextRef.current = audioContext;
      processorRef.current = processor;
      recognizerRef.current = recognizer;
      sourceRef.current = source;
      streamRef.current = stream;
      setStatus('wake-listening');
      debugVosk('wake listening');
    } catch (startError) {
      stop();
      handleFailure(startError, 'Impossibile avviare il riconoscimento vocale');
    }
  }, [
    enabled,
    enterCommandMode,
    finishCommand,
    handleFailure,
    modelUrl,
    paused,
    scheduleCommandSilenceTimeout,
    stop,
    wakeVariants,
  ]);

  const reset = useCallback(() => {
    setLastTranscript('');
    setError(null);
    resetCommandMode();
  }, [resetCommandMode]);

  useEffect(() => {
    if (!enabled || paused) {
      stop();
      return;
    }

    void start();
  }, [enabled, paused, start, stop]);

  useEffect(() => {
    return () => {
      stop();
      if (modelRef.current) {
        modelRef.current.terminate();
        modelRef.current = null;
      }
    };
  }, [stop]);

  return {
    status,
    partialTranscript,
    lastTranscript,
    error,
    start,
    stop,
    reset,
  };
}
