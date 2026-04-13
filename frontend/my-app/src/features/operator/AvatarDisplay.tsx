import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import { motion } from 'motion/react';
import type { TalkingHead } from '@met4citizen/talkinghead';

import type { TtsPlayback, TtsSpeechPayload } from '@/shared/api/ttsClient';
import {
  avatarDefinition,
  avatarOptions,
  avatarStatePresets,
  type AvatarState,
} from './avatarDisplay.config';

interface AvatarDisplayProps {
  state: AvatarState;
  disabled?: boolean;
  overlay?: ReactNode;
}

export type AvatarDisplayHandle = {
  canPlaySpeech: () => boolean;
  speak: (payload: TtsSpeechPayload) => Promise<TtsPlayback>;
  stopSpeech: () => void;
};

type BrowserAudioContext = AudioContext;
type BrowserWindowWithWebkitAudio = typeof window & {
  webkitAudioContext?: typeof AudioContext;
};

function supportsWebGL() {
  const canvas = document.createElement('canvas');

  return Boolean(
    canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl'),
  );
}

function hasUserActivation() {
  return typeof navigator !== 'undefined' && (navigator.userActivation?.hasBeenActive ?? false);
}

function getGlowClass(state: AvatarState) {
  switch (state) {
    case 'listening':
      return 'bg-sky-400/30';
    case 'thinking':
      return 'bg-amber-400/30';
    case 'speaking':
      return 'bg-violet-400/35';
    default:
      return 'bg-emerald-400/20';
  }
}

function getSpeechDurationMs(payload: TtsSpeechPayload) {
  if (payload.durationMs > 0) {
    return payload.durationMs;
  }

  const visemeEnd =
    payload.vtimes && payload.vdurations && payload.vtimes.length === payload.vdurations.length
      ? Math.max(...payload.vtimes.map((time, index) => time + (payload.vdurations?.[index] ?? 0)), 0)
      : 0;
  const wordEnd = Math.max(
    ...payload.wtimes.map((time, index) => time + (payload.wdurations[index] ?? 0)),
    0,
  );

  return Math.max(visemeEnd, wordEnd);
}

function getAudioContextConstructor(): typeof AudioContext | undefined {
  return window.AudioContext || (window as BrowserWindowWithWebkitAudio).webkitAudioContext;
}

async function getOrCreateDecodeAudioContext(
  audioContextRef: MutableRefObject<BrowserAudioContext | null>,
): Promise<BrowserAudioContext> {
  if (audioContextRef.current) {
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume().catch(() => undefined);
    }
    return audioContextRef.current;
  }

  const AudioContextCtor = getAudioContextConstructor();

  if (!AudioContextCtor) {
    throw new Error('Web Audio API non disponibile per il decoding del TTS');
  }

  const audioContext = new AudioContextCtor();
  audioContextRef.current = audioContext;
  return audioContext;
}

async function decodeSpeechAudio(
  audioContextRef: MutableRefObject<BrowserAudioContext | null>,
  buffer: ArrayBuffer,
): Promise<AudioBuffer> {
  const audioContext = await getOrCreateDecodeAudioContext(audioContextRef);
  return audioContext.decodeAudioData(buffer.slice(0));
}

function disposeTalkingHeadSafely(head: TalkingHead | null): void {
  if (!head) {
    return;
  }

  try {
    head.stopSpeaking();
  } catch (error) {
    console.warn('TalkingHead stopSpeaking failed during cleanup:', error);
  }

  try {
    head.dispose();
  } catch (error) {
    console.warn('TalkingHead dispose failed during cleanup:', error);
  }
}

export const AvatarDisplay = forwardRef<AvatarDisplayHandle, AvatarDisplayProps>(
  function AvatarDisplay({ state, disabled = false, overlay }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const headRef = useRef<TalkingHead | null>(null);
    const decodeAudioContextRef = useRef<BrowserAudioContext | null>(null);
    const stateRef = useRef<AvatarState>(state);
    const speakingTimeoutRef = useRef<number | null>(null);
    const [isActivated, setIsActivated] = useState(hasUserActivation);
    const [isLoading, setIsLoading] = useState(true);
    const [loadProgress, setLoadProgress] = useState(0);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    stateRef.current = state;

    useEffect(() => {
      if (isActivated || hasUserActivation()) {
        if (!isActivated) {
          setIsActivated(true);
        }
        return;
      }

      const activate = () => setIsActivated(true);

      window.addEventListener('pointerdown', activate, { once: true });
      window.addEventListener('keydown', activate, { once: true });

      return () => {
        window.removeEventListener('pointerdown', activate);
        window.removeEventListener('keydown', activate);
      };
    }, [isActivated]);

    useEffect(() => {
      if (disabled) {
        setIsLoading(false);
        setErrorMessage(null);
        setLoadProgress(0);
        disposeTalkingHeadSafely(headRef.current);
        headRef.current = null;
        return;
      }

      let cancelled = false;

      const initializeAvatar = async () => {
        if (!isActivated || !containerRef.current) {
          return;
        }

        if (!supportsWebGL()) {
          setErrorMessage('WebGL non disponibile su questo dispositivo');
          setIsLoading(false);
          return;
        }

        setIsLoading(true);
        setErrorMessage(null);
        setLoadProgress(0);

        try {
          const { TalkingHead } = await import('@met4citizen/talkinghead');
          if (cancelled || !containerRef.current) {
            return;
          }

          const head = new TalkingHead(containerRef.current, avatarOptions);
          headRef.current = head;

          await head.showAvatar(avatarDefinition, (_url, event) => {
            if (
              cancelled ||
              !event ||
              typeof event.loaded !== 'number' ||
              typeof event.total !== 'number' ||
              !event.lengthComputable ||
              event.total <= 0
            ) {
              return;
            }

            setLoadProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
          });

          if (cancelled) {
            disposeTalkingHeadSafely(head);
            return;
          }

          setIsLoading(false);
          applyStatePreset(head, stateRef.current);
        } catch (error) {
          if (cancelled) {
            return;
          }

          console.error('TalkingHead initialization failed:', error);
          setErrorMessage('Avatar 3D non disponibile al momento');
          setIsLoading(false);
        }
      };

      void initializeAvatar();

      return () => {
        cancelled = true;
        if (speakingTimeoutRef.current !== null) {
          window.clearTimeout(speakingTimeoutRef.current);
          speakingTimeoutRef.current = null;
        }
        disposeTalkingHeadSafely(headRef.current);
        headRef.current = null;
        if (decodeAudioContextRef.current) {
          void decodeAudioContextRef.current.close().catch(() => undefined);
          decodeAudioContextRef.current = null;
        }
      };
    }, [disabled, isActivated]);

    useEffect(() => {
      const head = headRef.current;
      if (!head || disabled || isLoading || errorMessage) {
        return;
      }

      applyStatePreset(head, state);
    }, [disabled, errorMessage, isLoading, state]);

    useImperativeHandle(
      ref,
      () => ({
        canPlaySpeech: () => Boolean(headRef.current && isActivated && !isLoading && !errorMessage),
        speak: async (payload: TtsSpeechPayload) => {
          const head = headRef.current;
          if (!head || !isActivated || isLoading || errorMessage) {
            throw new Error('Avatar audio playback non disponibile');
          }

          head.stopSpeaking();

          if (speakingTimeoutRef.current !== null) {
            window.clearTimeout(speakingTimeoutRef.current);
            speakingTimeoutRef.current = null;
          }

          const durationMs = Math.max(1, getSpeechDurationMs(payload));
          const decodedAudio = await decodeSpeechAudio(decodeAudioContextRef, payload.audio);

          let resolved = false;
          const finished = new Promise<void>((resolve) => {
            const finish = () => {
              if (resolved) {
                return;
              }
              resolved = true;
              if (speakingTimeoutRef.current !== null) {
                window.clearTimeout(speakingTimeoutRef.current);
                speakingTimeoutRef.current = null;
              }
              resolve();
            };

            speakingTimeoutRef.current = window.setTimeout(finish, durationMs + 250);

            head.speakAudio({
              audio: decodedAudio,
              words: payload.words,
              wtimes: payload.wtimes,
              wdurations: payload.wdurations,
              visemes: payload.visemes,
              vtimes: payload.vtimes,
              vdurations: payload.vdurations,
              markers: [finish],
              mtimes: [Math.max(0, durationMs - 20)],
            });
          });

          return { durationMs, finished };
        },
        stopSpeech: () => {
          if (speakingTimeoutRef.current !== null) {
            window.clearTimeout(speakingTimeoutRef.current);
            speakingTimeoutRef.current = null;
          }
          headRef.current?.stopSpeaking();
          if (decodeAudioContextRef.current?.state === 'running') {
            void decodeAudioContextRef.current.suspend().catch(() => undefined);
          }
        },
      }),
      [errorMessage, isActivated, isLoading],
    );

    const showOverlay = disabled || !isActivated || isLoading || errorMessage;

    return (
      <motion.div
        initial={{ scale: 0.82, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.45 }}
        className="relative flex h-full w-full items-center justify-center"
      >
        <div className={`absolute inset-[30%_20%] blur-3xl transition-all duration-500 ${getGlowClass(state)}`} />

        <div className="relative h-full max-h-full w-full max-w-full">
          <div className="pointer-events-none absolute inset-x-[30%] top-[40%] h-[22%] rounded-full bg-[radial-gradient(circle_at_50%_50%,rgba(125,211,252,0.07),rgba(14,165,233,0.015)_45%,transparent_72%)]" />
          <div className="pointer-events-none absolute inset-x-[18%] bottom-[10%] h-[14%] rounded-full bg-[radial-gradient(circle_at_50%_50%,rgba(56,189,248,0.06),rgba(8,47,73,0.02)_58%,transparent_78%)] blur-xl" />

          <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
            <div
              ref={containerRef}
              className={`h-full w-full scale-[1.02] translate-y-[1.5%] transition-opacity duration-500 ${showOverlay ? 'opacity-0' : 'opacity-100'}`}
            />

            {showOverlay && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
                {disabled ? (
                  <>
                    <div className="flex h-24 w-24 items-center justify-center rounded-full border border-slate-300/20 bg-white/5">
                      <div className="h-12 w-12 rounded-full border-2 border-slate-200/70" />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-100">Ologramma disattivato</p>
                      <p className="mt-1 text-sm text-slate-300">Puoi riattivarlo dalle impostazioni della postazione.</p>
                    </div>
                  </>
                ) : !isActivated ? (
                  <>
                    <div className="flex h-24 w-24 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-500/10">
                      <div className="h-12 w-12 rounded-full border-2 border-cyan-300/70" />
                    </div>
                    <div>
                      <p className="font-semibold text-cyan-100">Attiva l'ologramma</p>
                      <p className="mt-1 text-sm text-cyan-100/75">Tocca o premi un tasto per inizializzare audio e avatar</p>
                    </div>
                  </>
                ) : errorMessage ? (
                  <>
                    <div className="flex h-24 w-24 items-center justify-center rounded-full border border-red-400/40 bg-red-500/10">
                      <div className="h-12 w-12 rounded-full border-2 border-red-300/70" />
                    </div>
                    <div>
                      <p className="font-semibold text-red-100">Avatar non disponibile</p>
                      <p className="mt-1 text-sm text-red-200/80">{errorMessage}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="h-16 w-16 rounded-full border-4 border-blue-300/30 border-t-blue-300 animate-spin" />
                    <div>
                      <p className="font-semibold text-white">Caricamento ologramma</p>
                      <p className="mt-1 text-sm text-slate-300">
                        {loadProgress > 0 ? `${loadProgress}%` : 'Preparazione scena'}
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}

            {state === 'speaking' && !showOverlay && (
              <div className="pointer-events-none absolute bottom-5 left-1/2 flex -translate-x-1/2 gap-1">
                {[...Array(5)].map((_, index) => (
                  <motion.div
                    key={index}
                    className="w-1 rounded-full bg-white/80"
                    animate={{ height: [8, 22, 8] }}
                    transition={{
                      duration: 0.5,
                      repeat: Infinity,
                      delay: index * 0.08,
                    }}
                  />
                ))}
              </div>
            )}

            {overlay ? (
              <div className="pointer-events-none absolute inset-x-4 bottom-[6%] z-10 flex justify-center">
                {overlay}
              </div>
            ) : null}
          </div>
        </div>
      </motion.div>
    );
  },
);

function applyStatePreset(head: TalkingHead, state: AvatarState) {
  const preset = avatarStatePresets[state];

  head.setMood(preset.mood);

  if (preset.view) {
    head.setView(preset.view);
  }

  head.setLighting(preset.lighting);

  if (preset.lookAtCameraMs) {
    head.lookAtCamera(preset.lookAtCameraMs);
  }
}
