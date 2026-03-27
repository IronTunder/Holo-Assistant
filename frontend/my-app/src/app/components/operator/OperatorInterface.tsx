import { useEffect, useRef, useState } from 'react';
import { Mic, Radio, X } from 'lucide-react';
import { AvatarDisplay } from './AvatarDisplay';
import { BadgeReader } from './BadgeReader';
import { useAuth } from '../../AuthContext';
import { playTts, type TtsPlayback } from '../../ttsClient';
import API_ENDPOINTS from '../../../api/config';

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
  const [transcript, setTranscript] = useState('');
  const [wakeWordActive, setWakeWordActive] = useState(true);
  const [showSubtitles, setShowSubtitles] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logoutMessage, setLogoutMessage] = useState<string | null>(null);
  const [logoutMessageKey, setLogoutMessageKey] = useState(0);
  const [questionInput, setQuestionInput] = useState('');
  const [currentTranscription, setCurrentTranscription] = useState('');
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const pollingTimeoutRef = useRef<number | null>(null);
  const pollingInFlightRef = useRef(false);
  const mountedAtRef = useRef<number>(Date.now());
  const eventSourceRef = useRef<EventSource | null>(null);
  const sseRetryTimeoutRef = useRef<number | null>(null);
  const sseConnectedRef = useRef(false);
  const logoutMessageTimeoutRef = useRef<number | null>(null);
  const manualLogoutInProgressRef = useRef(false);

  const API_URL = import.meta.env.VITE_API_URL;

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
          return 'Macchinario non più disponibile';
        default:
          return 'Sessione non più valida';
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
      const response = await fetch(`${API_URL}/auth/badge-login`, {
        method: 'POST',
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
        data.refresh_token,
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
      const response = await fetch(`${API_URL}/auth/credentials-login`, {
        method: 'POST',
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
        data.refresh_token,
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
    setAvatarState('idle');
    setTranscript('');
    setQuestionInput('');
    setCurrentTranscription('');
    setShowFollowUp(false);
    setIsTyping(false);
    setShowSubtitles(false);
    setWakeWordActive(true);
    await logout();
  };

  const handleQuestionSubmit = async () => {
    if (questionInput.trim() && user && machine) {
      const userQuestion = questionInput;
      setQuestionInput('');
      setAvatarState('thinking');
      
      try {
        // Chiama il backend per ottenere la risposta
        const response = await fetch(`${API_URL}/api/interactions/ask`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            machine_id: machine.id,
            user_id: user.id,
            question: userQuestion,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.detail || 'Errore nel processamento della domanda');
        }

        const data = await response.json();
        const playback = await handleTTS(data.response);

        setAvatarState('speaking');
        await startTypingEffect(data.response, playback?.durationMs);

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
        setShowFollowUp(true);
      } catch (error) {
        console.error('Error asking question:', error);
        setAvatarState('idle');
        const errorMsg = error instanceof Error ? error.message : 'Errore sconosciuto';
        alert(`Errore: ${errorMsg}`);
      }
    }
  };

    const handleTTS = async (text: string): Promise<TtsPlayback | null> => {
    if (!isLoggedIn) {
      return null;
    }
    try {
      return await playTts(text, accessToken ?? undefined);
    } catch (error) {
      console.error('TTS test error:', error);
      alert(error instanceof Error ? error.message : 'Errore durante il test TTS');
      return null;
    }
  };

  const handleFollowUpResponse = (resolved: boolean) => {
    console.log(`Problema risolto: ${resolved}`);
    setShowFollowUp(false);
    setCurrentTranscription('');
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

  /*
  const simulateWakeWord = () => {
    if (avatarState === 'idle' && isLoggedIn) {
      setAvatarState('listening');
      setShowSubtitles(true);
      setTranscript('In ascolto...');
      
      setTimeout(() => {
        setTranscript('Come cambio l\'olio?');
        setAvatarState('thinking');
        
        setTimeout(() => {
          const response = 'Per cambiare l\'olio della Pressa A7: \n1. Spegnere la macchina. \n2. Attendere il raffreddamento. \n3. Posizionare un contenitore sotto lo scarico';
          setTranscript('');
          setAvatarState('speaking');
          
          // Start typing effect during speaking state
          startTypingEffect(response);
          
          // After typing is complete, return to idle and show follow-up
          // The follow-up will be shown by startTypingEffect when typing completes
        }, 2000);
      }, 3000);
    }
  };
  */
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white relative overflow-hidden">
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

      {/* Header with machine info */}
      <div className="relative z-10 p-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="text-blue-400">DITTO</span> Assistente
          </h1>
          {machine && (
            <p className="text-sm text-gray-400 mt-1">
              Postazione: {machine.nome} - {machine.id_postazione}
            </p>
          )}
        </div>
        
        <div className="flex items-center gap-4">
          {isLoggedIn && user && (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm text-gray-400">Operatore</p>
                <p className="font-semibold">{user.nome}</p>
                <p className="text-xs text-gray-500">{user.livello_esperienza} - {user.turno}</p>
              </div>
              <button
                onClick={handleLogout}
                disabled={isTyping || avatarState === 'speaking'}
                className={`px-4 py-2 rounded-lg transition-colors border border-red-500/50 ${isTyping || avatarState === 'speaking' ? 'bg-red-500/10 text-red-300 cursor-not-allowed' : 'bg-red-500/20 hover:bg-red-500/30 text-white'}`}
              >
                Logout
              </button>
            </div>
          )}
          
          <div className="flex items-center gap-2">
            <Radio className={`h-5 w-5 ${wakeWordActive ? 'text-green-400 animate-pulse' : 'text-gray-500'}`} />
            <span className="text-sm text-gray-400">
              {wakeWordActive ? 'Wake word attivo' : 'Disattivato'}
            </span>
          </div>
        </div>
      </div>

      {/* Main content */}
      {!isLoggedIn ? (
        <BadgeReader 
          onBadgeDetected={handleBadgeLogin}
          onCredentialsLogin={handleCredentialsLogin}
        />
      ) : (
        <div className="relative z-10 flex flex-col items-center justify-center" style={{ minHeight: 'calc(100vh - 120px)' }}>
          {loading ? (
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-400">Accesso in corso...</p>
            </div>
          ) : (
            <>
              {/* Avatar Display */}
              <AvatarDisplay state={avatarState} />

              {/* Status indicator */}
              <div className="mt-8 text-center">
                <div className="inline-flex items-center gap-2 px-6 py-3 bg-white/10 backdrop-blur-md rounded-full border border-white/20">
                  {avatarState === 'idle' && (
                    <>
                      <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
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
                        <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      </div>
                      <span>Elaborazione in corso...</span>
                    </>
                  )}
                  {avatarState === 'speaking' && (
                    <>
                      <div className="w-3 h-3 bg-purple-400 rounded-full animate-pulse"></div>
                      <span>Risposta in corso...</span>
                    </>
                  )}
                </div>
              </div>

              {/* Text input for questions */}
              <div className="mt-8 w-full max-w-md mx-auto px-6">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={questionInput}
                    onChange={(e) => {
                      setQuestionInput(e.target.value);
                      // Reset transcription when user starts typing a new question
                      if (currentTranscription && !isTyping) {
                        setCurrentTranscription('');
                        setShowFollowUp(false);
                      }
                    }}
                    placeholder="Scrivi la tua domanda..."
                    disabled={isTyping}
                    className="flex-1 px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
                    onKeyPress={(e) => e.key === 'Enter' && !isTyping && handleQuestionSubmit()}
                  />
                  <button
                    onClick={handleQuestionSubmit}
                    disabled={isTyping || !questionInput.trim()}
                    className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-500 disabled:cursor-not-allowed rounded-lg transition-colors"
                  >
                    Invia
                  </button>
                </div>
              </div>

              {/* Transcription display */}
              {currentTranscription && (
                <div className="mt-6 w-full max-w-2xl mx-auto px-6">
                  <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-gray-300 mb-2">Risposta Assistente</h3>
                    <div className="text-sm text-gray-200 whitespace-pre-line">
                      {currentTranscription}
                      {isTyping && <span className="animate-pulse">|</span>}
                    </div>
                  </div>
                </div>
              )}

              {/* Follow-up question */}
              {showFollowUp && (
                <div className="mt-6 w-full max-w-md mx-auto px-6">
                  <div className="bg-white/10 border border-white/20 rounded-lg p-4 text-center">
                    <p className="text-lg font-semibold mb-4">Hai risolto il problema?</p>
                    <div className="flex gap-4 justify-center">
                      <button
                        onClick={() => handleFollowUpResponse(true)}
                        className="px-6 py-2 bg-green-500 hover:bg-green-600 rounded-lg transition-colors"
                      >
                        Sì
                      </button>
                      <button
                        onClick={() => handleFollowUpResponse(false)}
                        className="px-6 py-2 bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
                      >
                        No
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Quick actions */}
              <div className="mt-12 grid grid-cols-3 gap-4 max-w-2xl mx-auto px-6">
                <button className="p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors">
                  <span className="block text-sm text-gray-400 mb-1">Emergenza</span>
                  <span className="block font-semibold">🚨 Alert</span>
                </button>
                <button className="p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors">
                  <span className="block text-sm text-gray-400 mb-1">Manutenzione</span>
                  <span className="block font-semibold">🔧 Chiama</span>
                </button>
                <button className="p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors">
                  <span className="block text-sm text-gray-400 mb-1">Supporto</span>
                  <span className="block font-semibold">❓ Aiuto</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
