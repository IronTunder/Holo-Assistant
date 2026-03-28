import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { TalkingHead } from '@met4citizen/talkinghead';

import {
  avatarDefinition,
  avatarOptions,
  avatarStatePresets,
  type AvatarState,
} from './avatarDisplay.config';

interface AvatarDisplayProps {
  state: AvatarState;
}

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

export function AvatarDisplay({ state }: AvatarDisplayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<TalkingHead | null>(null);
  const stateRef = useRef<AvatarState>(state);
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
          head.dispose();
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
      headRef.current?.dispose();
      headRef.current = null;
    };
  }, [isActivated]);

  useEffect(() => {
    const head = headRef.current;
    if (!head || isLoading || errorMessage) {
      return;
    }

    applyStatePreset(head, state);
  }, [errorMessage, isLoading, state]);

  useEffect(() => {
    const head = headRef.current;
    if (!head || isLoading || errorMessage) {
      return;
    }

    if (state !== 'speaking') {
      resetSpeakingMorphs(head);
      return;
    }

    const animateMouth = () => {
      const jawOpen = 0.12 + Math.random() * 0.28;
      const mouthOpen = Math.min(0.55, jawOpen + 0.12);
      const mouthFunnel = Math.random() > 0.65 ? 0.18 + Math.random() * 0.22 : 0.02;
      const mouthPucker = Math.random() > 0.75 ? 0.1 + Math.random() * 0.18 : 0;

      head.setValue('jawOpen', jawOpen, 90);
      head.setValue('mouthOpen', mouthOpen, 90);
      head.setValue('mouthFunnel', mouthFunnel, 110);
      head.setValue('mouthPucker', mouthPucker, 110);
    };

    animateMouth();
    const interval = window.setInterval(animateMouth, 120);

    return () => {
      window.clearInterval(interval);
      resetSpeakingMorphs(head);
    };
  }, [errorMessage, isLoading, state]);

  const showOverlay = !isActivated || isLoading || errorMessage;

  return (
    <motion.div
      initial={{ scale: 0.82, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.45 }}
      className="relative"
    >
      <div className={`absolute inset-0 rounded-full blur-3xl transition-all duration-500 ${getGlowClass(state)}`} />

      <div className="relative flex h-80 w-80 items-center justify-center overflow-hidden rounded-full border-4 border-white/20 bg-gradient-to-br from-slate-900/85 via-slate-800/70 to-slate-950/90 backdrop-blur-sm">
        <div
          ref={containerRef}
          className={`h-full w-full transition-opacity duration-500 ${showOverlay ? 'opacity-0' : 'opacity-100'}`}
        />

        {showOverlay && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
            {!isActivated ? (
              <>
                <div className="flex h-24 w-24 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-500/10">
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
          <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1">
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
      </div>
    </motion.div>
  );
}

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

function resetSpeakingMorphs(head: TalkingHead) {
  head.setValue('jawOpen', 0, 120);
  head.setValue('mouthOpen', 0, 120);
  head.setValue('mouthFunnel', 0, 140);
  head.setValue('mouthPucker', 0, 140);
}
