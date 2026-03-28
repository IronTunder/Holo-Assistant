import { useEffect, useRef, useState } from 'react';
import { Mic, Radio, X } from 'lucide-react';
import { AvatarDisplay, type AvatarDisplayHandle } from './AvatarDisplay';
import { BadgeReader } from './BadgeReader';
import { useAuth } from '@/shared/auth/AuthContext';
import { playTtsAudio, synthesizeTts, type TtsPlayback, type TtsSpeechPayload } from '@/shared/api/ttsClient';
import { API_BASE_URL, API_ENDPOINTS } from '@/shared/api/config';
import { ScrollArea } from '@/shared/ui/scroll-area';

type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking';
type SessionStatusReason = 'ok' | 'machine_released' | 'machine_reassigned' | 'machine_not_found';

type SessionStatusPayload = {
  session_valid: boolean;
  machine_assigned: boolean;
  machine_in_use: boolean;
  operator_matches: boolean;
  should_logout: boolean;
  reason: SessionStatusReason;
};

type ClarificationOption = {
  knowledge_item_id: number;
  label: string;
  category_name?: string | null;
};

type AskQuestionApiResponse = {
  response: string;
  mode: 'answer' | 'clarification' | 'fallback';
  reason_code: 'matched' | 'clarification' | 'no_match' | 'out_of_scope';
  confidence: number;
  clarification_options: ClarificationOption[];
  category_id?: number | null;
  category_name?: string | null;
  knowledge_item_id?: number | null;
  knowledge_item_title?: string | null;
};

const quickActions = [
  { title: 'Emergenza', subtitle: 'Alert rapido' },
  { title: 'Manutenzione', subtitle: 'Chiama tecnico' },
  { title: 'Supporto', subtitle: 'Apri aiuto' },
];

export function OperatorInterface() {
  const { 
    isLoggedIn, 
    isAdmin,
    accessToken, 
    refreshAccessToken,
    user, 
    machine, 
    login, 
    logout 
  } = useAuth();
  
  const [avatarState, setAvatarState] = useState<AvatarState>('idle');
  const [, setTranscript] = useState('');
  const [wakeWordActive, setWakeWordActive] = useState(true);
  const [, setShowSubtitles] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logoutMessage, setLogoutMessage] = useState<string | null>(null);
  const [logoutMessageKey, setLogoutMessageKey] = useState(0);
  const [questionInput, setQuestionInput] = useState('');
  const [currentTranscription, setCurrentTranscription] = useState('');
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [clarificationOptions, setClarificationOptions] = useState<ClarificationOption[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [fallbackReasonCode, setFallbackReasonCode] = useState<'matched' | 'clarification' | 'no_match' | 'out_of_scope' | null>(null);
  const pollingTimeoutRef = useRef<number | null>(null);
  const pollingInFlightRef = useRef(false);
  const mountedAtRef = useRef<number>(Date.now());
  const eventSourceRef = useRef<EventSource | null>(null);
  const sseRetryTimeoutRef = useRef<number | null>(null);
  const sseConnectedRef = useRef(false);
  const logoutMessageTimeoutRef = useRef<number | null>(null);
  const manualLogoutInProgressRef = useRef(false);
  const avatarDisplayRef = useRef<AvatarDisplayHandle | null>(null);

  const dismissLogoutMessage = () => {
    if (logoutMessageTimeoutRef.current !== null) {
      window.clearTimeout(logoutMessageTimeoutRef.current);
      logoutMessageTimeoutRef.current = null;
    }
    setLogoutMessage(null);
    setLogoutMessageKey(0);
  };

  const showTimedLogoutMessage = (message: string) => {
    setLogoutMessage(message);
    setLogoutMessageKey(Date.now());
  };

  useEffect(() => {
    if (!logoutMessage) {
      if (logoutMessageTimeoutRef.current !== null) {
        window.clearTimeout(logoutMessageTimeoutRef.current);
        logoutMessageTimeoutRef.current = null;
      }
      return;
    }

    logoutMessageTimeoutRef.current = window.setTimeout(() => {
      dismissLogoutMessage();
    }, 10_000);

    return () => {
      if (logoutMessageTimeoutRef.current !== null) {
        window.clearTimeout(logoutMessageTimeoutRef.current);
        logoutMessageTimeoutRef.current = null;
      }
    };
  }, [logoutMessage]);

  useEffect(() => {
    if (isLoggedIn) {
      manualLogoutInProgressRef.current = false;
    }
  }, [isLoggedIn]);

  useEffect(() => {
    const clearPollingTimeout = () => {
      if (pollingTimeoutRef.current !== null) {
        window.clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
      }
    };

    const clearSseRetryTimeout = () => {
      if (sseRetryTimeoutRef.current !== null) {
        window.clearTimeout(sseRetryTimeoutRef.current);
        sseRetryTimeoutRef.current = null;
      }
    };

    const closeEventSource = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      sseConnectedRef.current = false;
    };

    const getLogoutMessage = (reason: SessionStatusReason | string) => {
      switch (reason) {
        case 'machine_released':
          return 'Macchina liberata dall\'amministratore';
        case 'machine_reassigned':
          return 'Macchina assegnata a un altro operatore';
        case 'machine_not_found':
          return 'Macchinario non piu disponibile';
        default:
          return 'Sessione non piu valida';
      }
    };

    const scheduleNextPoll = (delayMs: number) => {
      if (sseConnectedRef.current) {
        return;
      }

      clearPollingTimeout();
      pollingTimeoutRef.current = window.setTimeout(() => {
        void pollSessionStatus();
      }, delayMs);
    };

    const scheduleSseRetry = (delayMs = 5000) => {
      clearSseRetryTimeout();
      sseRetryTimeoutRef.current = window.setTimeout(() => {
        void startSseConnection();
      }, delayMs);
    };

    const getPollingDelay = () => {
      const elapsedMs = Date.now() - mountedAtRef.current;
      return elapsedMs < 60_000 ? 10_000 : 30_000;
    };

    const stopAndLogout = async (message: string) => {
      if (manualLogoutInProgressRef.current) {
        return;
      }

      clearPollingTimeout();
      clearSseRetryTimeout();
      closeEventSource();
      pollingInFlightRef.current = false;
      await handleLogout();
      showTimedLogoutMessage(message);
    };

    const handleSessionStatusEvent = async (sessionStatus: SessionStatusPayload) => {
      if (!sessionStatus.should_logout) {
        return;
      }

      await stopAndLogout(getLogoutMessage(sessionStatus.reason));
    };

    const pollSessionStatus = async () => {
      if (
        pollingInFlightRef.current ||
        sseConnectedRef.current ||
        !isLoggedIn ||
        isAdmin ||
        !machine ||
        !user ||
        !accessToken ||
        document.visibilityState !== 'visible'
      ) {
        return;
      }

      pollingInFlightRef.current = true;

      try {
        const response = await fetch(API_ENDPOINTS.SESSION_STATUS(machine.id), {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.status === 401) {
          const refreshSucceeded = await refreshAccessToken();
          if (!refreshSucceeded) {
            await stopAndLogout('Sessione scaduta');
            return;
          }

          scheduleNextPoll(getPollingDelay());
          return;
        }

        if (!response.ok) {
          console.error(`Polling session-status failed with status: ${response.status}`);
          scheduleNextPoll(getPollingDelay());
          return;
        }

        const sessionStatus: SessionStatusPayload = await response.json();
        await handleSessionStatusEvent(sessionStatus);
        if (sessionStatus.should_logout) return;

        scheduleNextPoll(getPollingDelay());
      } catch (error) {
        console.error('Error polling session status:', error);
        scheduleNextPoll(getPollingDelay());
      } finally {
        pollingInFlightRef.current = false;
      }
    };

    const startPollingFallback = () => {
      closeEventSource();
      if (document.visibilityState !== 'visible') {
        return;
      }
      void pollSessionStatus();
    };

    const startSseConnection = async () => {
      if (
        !isLoggedIn ||
        isAdmin ||
        !machine ||
        !user ||
        !accessToken ||
        document.visibilityState !== 'visible'
      ) {
        return;
      }

      clearSseRetryTimeout();
      closeEventSource();

      try {
        const tokenResponse = await fetch(API_ENDPOINTS.SSE_TOKEN, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ machine_id: machine.id }),
        });

        if (tokenResponse.status === 401) {
          const refreshSucceeded = await refreshAccessToken();
          if (!refreshSucceeded) {
            await stopAndLogout('Sessione scaduta');
            return;
          }

          scheduleSseRetry(1000);
          return;
        }

        if (!tokenResponse.ok) {
          console.error(`SSE token creation failed with status: ${tokenResponse.status}`);
          startPollingFallback();
          scheduleSseRetry();
          return;
        }

        const { token } = await tokenResponse.json();
        const eventSource = new EventSource(API_ENDPOINTS.SESSION_EVENTS(machine.id, token));
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          sseConnectedRef.current = true;
          clearPollingTimeout();
          clearSseRetryTimeout();
        };

        eventSource.addEventListener('session_status', (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent<string>).data) as SessionStatusPayload;
            void handleSessionStatusEvent(payload);
          } catch (error) {
            console.error('Errore parsing evento session_status:', error);
          }
        });

        eventSource.addEventListener('heartbeat', () => {
          sseConnectedRef.current = true;
        });

        eventSource.onerror = () => {
          closeEventSource();
          startPollingFallback();
          scheduleSseRetry();
        };
      } catch (error) {
        console.error('Errore apertura SSE:', error);
        startPollingFallback();
        scheduleSseRetry();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        mountedAtRef.current = Date.now();
        void startSseConnection();
        return;
      }

      closeEventSource();
      clearSseRetryTimeout();
      clearPollingTimeout();
    };

    closeEventSource();
    clearSseRetryTimeout();
    clearPollingTimeout();
    mountedAtRef.current = Date.now();

    if (
      isLoggedIn &&
      !isAdmin &&
      machine &&
      user &&
      accessToken &&
      document.visibilityState === 'visible'
    ) {
      void startSseConnection();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      closeEventSource();
      clearSseRetryTimeout();
      clearPollingTimeout();
      pollingInFlightRef.current = false;
    };
  }, [isLoggedIn, isAdmin, machine, user, accessToken, refreshAccessToken, logout]);

  const handleBadgeLogin = async (badgeId: string, machineId: number) => {
    setLoading(true);
    try {
      const response = await fetch(API_ENDPOINTS.BADGE_LOGIN, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ badge_id: badgeId, machine_id: machineId }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Errore durante il login');
      }
      const data = await response.json();
      login(
        data.access_token,
        data.user,
        data.machine,
        data.expires_in
      );
    } catch (error) {
      console.error('Login error:', error);
      alert(error instanceof Error ? error.message : 'Errore durante il login');
    } finally {
      setLoading(false);
    }
  };

  const handleCredentialsLogin = async (username: string, password: string, machineId: number) => {
    setLoading(true);
    try {
      const response = await fetch(API_ENDPOINTS.CREDENTIALS_LOGIN, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password, machine_id: machineId }),
      });

      if (!response.ok) {
        throw new Error('Credenziali non valide');
      }
      const data = await response.json();
      login(
        data.access_token,
        data.user,
        data.machine,
        data.expires_in
      );
    } catch (error) {
      console.error('Login error:', error);
      alert(error instanceof Error ? error.message : 'Errore durante il login');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    manualLogoutInProgressRef.current = true;
    dismissLogoutMessage();
    avatarDisplayRef.current?.stopSpeech();
    setAvatarState('idle');
    setTranscript('');
    setQuestionInput('');
    setCurrentTranscription('');
    setShowFollowUp(false);
    setClarificationOptions([]);
    setPendingQuestion(null);
    setFallbackReasonCode(null);
    setIsTyping(false);
    setShowSubtitles(false);
    setWakeWordActive(true);
    await logout();
  };

  const submitQuestion = async (userQuestion: string, selectedKnowledgeItemId?: number) => {
    if (!user || !machine || !accessToken) {
      return;
    }

    setAvatarState('thinking');
    setShowFollowUp(false);
    setClarificationOptions([]);
    setFallbackReasonCode(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/interactions/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          machine_id: machine.id,
          user_id: user.id,
          question: userQuestion,
          selected_knowledge_item_id: selectedKnowledgeItemId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Errore nel processamento della domanda');
      }

      const data = (await response.json()) as AskQuestionApiResponse;
      const speechPayload = await handleTTS(data.response);
      let playback: TtsPlayback | null = null;

      if (speechPayload) {
        setAvatarState('speaking');
        playback = await startSpeechPlayback(speechPayload);
      }

      await startTypingEffect(data.response, speechPayload?.durationMs);

      if (playback) {
        try {
          await playback.finished;
        } catch (playbackError) {
          console.error('Audio playback error:', playbackError);
        }
      }

      setIsTyping(false);
      setAvatarState('idle');
      setShowSubtitles(false);

      if (data.mode === 'clarification') {
        setPendingQuestion(userQuestion);
        setClarificationOptions(data.clarification_options);
        return;
      }

      setPendingQuestion(null);
      setClarificationOptions([]);
      setFallbackReasonCode(data.mode === 'fallback' ? data.reason_code : null);
      setShowFollowUp(data.mode === 'answer');
    } catch (error) {
      console.error('Error asking question:', error);
      setAvatarState('idle');
      const errorMsg = error instanceof Error ? error.message : 'Errore sconosciuto';
      alert(`Errore: ${errorMsg}`);
    }
  };

  const handleQuestionSubmit = async () => {
    if (questionInput.trim() && user && machine) {
      const userQuestion = questionInput.trim();
      setQuestionInput('');
      await submitQuestion(userQuestion);
    }
  };

    const handleTTS = async (text: string): Promise<TtsSpeechPayload | null> => {
    if (!isLoggedIn) {
      return null;
    }
    try {
      return await synthesizeTts(text, accessToken ?? undefined);
    } catch (error) {
      console.error('TTS test error:', error);
      alert(error instanceof Error ? error.message : 'Errore durante il test TTS');
      return null;
    }
  };

  const startSpeechPlayback = async (payload: TtsSpeechPayload): Promise<TtsPlayback> => {
    const avatar = avatarDisplayRef.current;

    if (avatar?.canPlaySpeech()) {
      try {
        return await avatar.speak(payload);
      } catch (error) {
        console.warn('Avatar playback failed, using audio fallback:', error);
      }
    }

    return playTtsAudio(payload);
  };

  const handleFollowUpResponse = (resolved: boolean) => {
    console.log(`Problema risolto: ${resolved}`);
    setShowFollowUp(false);
    setCurrentTranscription('');
  };

  const handleClarificationSelection = async (knowledgeItemId: number) => {
    if (!pendingQuestion) {
      return;
    }
    await submitQuestion(pendingQuestion, knowledgeItemId);
  };

  const startTypingEffect = (fullText: string, durationMs?: number) => {
    setCurrentTranscription('');
    setIsTyping(true);
    setShowSubtitles(true);

    const effectiveDurationMs =
      durationMs && durationMs > 0
        ? durationMs
        : Math.max(fullText.length * 45, 1500);
    const charDelayMs = Math.max(
      15,
      Math.min(90, effectiveDurationMs / Math.max(fullText.length, 1))
    );

    return new Promise<void>((resolve) => {
      let index = 0;

      const typeNextChar = () => {
        if (index < fullText.length) {
          setCurrentTranscription(fullText.substring(0, index + 1));
          index++;
          window.setTimeout(typeNextChar, charDelayMs);
          return;
        }

        resolve();
      };

      typeNextChar();
    });
  };

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      {/* Logout notification */}
      {logoutMessage && (
        <div
          key={logoutMessageKey}
          className="fixed top-4 left-4 right-4 z-50 bg-red-500/20 border border-red-500/50 rounded-lg p-4 pr-12 text-red-100 backdrop-blur-md"
        >
          <button
            type="button"
            onClick={dismissLogoutMessage}
            className="absolute right-3 top-3 text-red-200 transition-colors hover:text-white"
            aria-label="Chiudi notifica"
          >
            <X className="h-4 w-4" />
          </button>
          <p className="font-semibold">{logoutMessage}</p>
          <p className="text-sm text-red-200 mt-1">Sei stato disconnesso dalla macchina</p>
        </div>
      )}

      {/* Background pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0" style={{
          backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
          backgroundSize: '40px 40px'
        }}></div>
      </div>

      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <header className="shrink-0 border-b border-white/10 bg-slate-950/20 px-4 py-3 backdrop-blur-sm sm:px-6 sm:py-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
                <span className="text-blue-400">DITTO</span> Assistente
              </h1>
              {machine ? (
                <p className="mt-1 truncate text-sm text-slate-300">
                  Postazione: {machine.nome} - {machine.id_postazione}
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-400">
                  Seleziona una postazione per iniziare la sessione operatore.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-start gap-3 xl:justify-end">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                <Radio className={`h-4 w-4 ${wakeWordActive ? 'text-green-400 animate-pulse' : 'text-slate-500'}`} />
                <span>{wakeWordActive ? 'Wake word attivo' : 'Wake word disattivato'}</span>
              </div>

              {isLoggedIn && user && (
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Operatore</p>
                    <p className="truncate font-semibold text-white">{user.nome}</p>
                    <p className="truncate text-xs text-slate-400">{user.livello_esperienza} - {user.turno}</p>
                  </div>
                  <button
                    onClick={handleLogout}
                    disabled={isTyping || avatarState === 'speaking'}
                    className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${isTyping || avatarState === 'speaking' ? 'cursor-not-allowed border-red-500/20 bg-red-500/10 text-red-300' : 'border-red-500/40 bg-red-500/20 text-white hover:bg-red-500/30'}`}
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 min-h-0 px-4 py-4 sm:px-6 sm:py-5">
          {!isLoggedIn ? (
            <BadgeReader
              onBadgeDetected={handleBadgeLogin}
              onCredentialsLogin={handleCredentialsLogin}
            />
          ) : loading ? (
            <div className="flex h-full items-center justify-center rounded-[28px] border border-white/10 bg-slate-950/20 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-4">
                <div className="h-16 w-16 animate-spin rounded-full border-4 border-blue-400 border-t-transparent"></div>
                <p className="text-slate-300">Accesso in corso...</p>
              </div>
            </div>
          ) : (
            <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(320px,0.95fr)_minmax(380px,1.05fr)]">
              <section className="flex min-h-0 flex-col rounded-[28px] border border-white/10 bg-slate-950/20 p-4 backdrop-blur-sm sm:p-6">
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 text-center">
                  <AvatarDisplay ref={avatarDisplayRef} state={avatarState} />

                  <div className="space-y-3">
                    <div className="inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-white/15 bg-white/10 px-5 py-3 text-sm text-slate-100">
                  {avatarState === 'idle' && (
                    <>
                          <div className="h-3 w-3 rounded-full bg-green-400 animate-pulse"></div>
                      <span>In attesa - Di' "Ehi Ditto" per iniziare</span>
                    </>
                  )}
                  {avatarState === 'listening' && (
                    <>
                          <Mic className="h-5 w-5 text-blue-400 animate-pulse" />
                      <span>In ascolto...</span>
                    </>
                  )}
                  {avatarState === 'thinking' && (
                    <>
                      <div className="flex gap-1">
                            <div className="h-2 w-2 rounded-full bg-yellow-400 animate-bounce"></div>
                            <div className="h-2 w-2 rounded-full bg-yellow-400 animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                            <div className="h-2 w-2 rounded-full bg-yellow-400 animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      </div>
                      <span>Elaborazione in corso...</span>
                    </>
                  )}
                  {avatarState === 'speaking' && (
                    <>
                          <div className="h-3 w-3 rounded-full bg-violet-400 animate-pulse"></div>
                      <span>Risposta in corso...</span>
                    </>
                  )}
                    </div>

                    <p className="mx-auto max-w-md text-sm text-slate-300">
                      Il tuo assistente digitale per il supporto tecnico. Fai domande, ricevi risposte e accedi a procedure guidate senza distogliere lo sguardo dal tuo lavoro.
                    </p>
                  </div>
                </div>
              </section>

              <section className="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/25 backdrop-blur-sm">
                <div className="shrink-0 border-b border-white/10 px-4 py-4 sm:px-5">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Console operatore</p>
                  <h2 className="mt-1 text-lg font-semibold text-white">Domande, risposte e azioni rapide</h2>
                  <p className="mt-1 text-sm text-slate-400">
                      Fai domande tecniche o seleziona azioni rapide. Le risposte appariranno qui senza far scorrere la pagina, così puoi mantenere il focus sul tuo lavoro.
                  </p>
                </div>

                <div className="min-h-0 flex-1 px-4 py-4 sm:px-5">
                  <ScrollArea className="h-full pr-3">
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold text-slate-200">Risposta assistente</h3>
                          {isTyping && (
                            <span className="rounded-full border border-blue-400/20 bg-blue-500/10 px-2 py-1 text-xs text-blue-200">
                              In scrittura
                            </span>
                          )}
                        </div>

                        {currentTranscription ? (
                          <>
                            <div className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-100">
                              {currentTranscription}
                              {isTyping && <span className="animate-pulse">|</span>}
                            </div>
                            {!isTyping && fallbackReasonCode === 'out_of_scope' && (
                              <p className="mt-3 text-xs text-amber-200">
                                Questa richiesta sembra fuori ambito rispetto al supporto macchina.
                              </p>
                            )}
                            {!isTyping && fallbackReasonCode === 'no_match' && (
                              <p className="mt-3 text-xs text-slate-400">
                                Non ho trovato una procedura tecnica affidabile per questa richiesta.
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="mt-3 text-sm leading-6 text-slate-400">
                            Scrivi o pronuncia una domanda tecnica. La risposta apparira qui senza far scorrere la pagina.
                          </p>
                        )}
                      </div>

                      {clarificationOptions.length > 0 && (
                        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4">
                          <h3 className="text-sm font-semibold text-amber-200">Aiutami a capire meglio</h3>
                          <div className="mt-3 grid gap-3">
                            {clarificationOptions.map((option) => (
                              <button
                                key={option.knowledge_item_id}
                                type="button"
                                onClick={() => handleClarificationSelection(option.knowledge_item_id)}
                                disabled={isTyping}
                                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-slate-100 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {showFollowUp && (
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center">
                          <p className="text-lg font-semibold text-white">Hai risolto il problema?</p>
                          <div className="mt-4 flex flex-wrap justify-center gap-3">
                            <button
                              onClick={() => handleFollowUpResponse(true)}
                              className="rounded-xl bg-green-500 px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-600"
                            >
                              Si
                            </button>
                            <button
                              onClick={() => handleFollowUpResponse(false)}
                              className="rounded-xl bg-red-500 px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600"
                            >
                              No
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </div>

                <div className="shrink-0 border-t border-white/10 px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="text"
                        value={questionInput}
                        onChange={(e) => {
                          setQuestionInput(e.target.value);
                          if (currentTranscription && !isTyping) {
                            setCurrentTranscription('');
                            setShowFollowUp(false);
                            setClarificationOptions([]);
                            setPendingQuestion(null);
                            setFallbackReasonCode(null);
                          }
                        }}
                        placeholder="Scrivi la tua domanda..."
                        disabled={isTyping}
                        className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !isTyping) {
                            void handleQuestionSubmit();
                          }
                        }}
                      />
                      <button
                        onClick={handleQuestionSubmit}
                        disabled={isTyping || !questionInput.trim()}
                        className="rounded-xl bg-blue-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-600"
                      >
                        Invia
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {quickActions.map((action) => (
                        <button
                          key={action.title}
                          type="button"
                          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition-colors hover:bg-white/10"
                        >
                          <span className="block text-xs uppercase tracking-[0.18em] text-slate-400">{action.title}</span>
                          <span className="mt-1 block text-sm font-semibold text-white">{action.subtitle}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
