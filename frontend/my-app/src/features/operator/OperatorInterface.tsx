import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Mic, MicOff, Radio, X } from 'lucide-react';
import { AvatarDisplay, type AvatarDisplayHandle } from './AvatarDisplay';
import { BadgeReader } from './BadgeReader';
import { StartupChecklistDialog } from './StartupChecklistDialog';
import { useAuth, type AuthMachine } from '@/shared/auth/AuthContext';
import { playTtsAudio, synthesizeTts, type TtsPlayback, type TtsSpeechPayload } from '@/shared/api/ttsClient';
import { API_ENDPOINTS } from '@/shared/api/config';
import { ScrollArea } from '@/shared/ui/scroll-area';
import { useVoskWakeWord, type VoskWakeWordStatus } from './voice/useVoskWakeWord';

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
  interaction_id?: number | null;
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

type InteractionFeedbackStatus = 'resolved' | 'unresolved' | 'not_applicable';
type QuickActionType = 'maintenance' | 'emergency';

type QuickActionApiResponse = {
  interaction_id: number;
  action_type: QuickActionType;
  priority: 'normal' | 'critical';
  feedback_status: InteractionFeedbackStatus;
  message: string;
  timestamp: string;
};

type PendingResolution = {
  interactionId: number;
  message: string;
  resolvedByName?: string | null;
  resolutionTimestamp?: string | null;
};

type InteractionResolutionResponse = {
  interaction_id: number;
  feedback_status: 'resolved';
  feedback_timestamp: string;
  resolved_by_user_id: number;
  resolved_by_user_name: string;
  resolution_note?: string | null;
  resolution_timestamp: string;
};

const UNRESOLVED_CONFIRMATION_MESSAGE =
  "L'assistenza è stata informata del tuo problema e inviera al piu presto un tecnico. Quando il tecnico avra risolto il problema, l'intervento potra essere confermato nel sistema.";

const VOSK_MODEL_URL = import.meta.env.VITE_VOSK_MODEL_URL || '/models/vosk-model-small-it-0.22.tar.gz';

const quickActions = [
  { actionType: 'emergency', title: 'Emergenza', subtitle: 'Alert rapido' },
  { actionType: 'maintenance', title: 'Manutenzione', subtitle: 'Chiama tecnico' },
] as const satisfies readonly {
  actionType: QuickActionType;
  title: string;
  subtitle: string;
}[];

const quickActionFallbackMessages: Record<QuickActionType, string> = {
  maintenance: 'La richiesta di manutenzione e stata inviata.',
  emergency: 'Emergenza inviata. Allontanati dalla macchina e segui le procedure di sicurezza del reparto.',
};

const quickActionButtonStyles: Record<QuickActionType, string> = {
  emergency: 'border-red-400/40 bg-red-500/15 text-red-50 hover:bg-red-500/25 disabled:border-red-500/20 disabled:bg-red-500/10 disabled:text-red-200',
  maintenance: 'border-amber-400/30 bg-amber-500/10 text-amber-50 hover:bg-amber-500/20 disabled:border-amber-500/20 disabled:bg-amber-500/10 disabled:text-amber-200',
};

const quickActionTitleStyles: Record<QuickActionType, string> = {
  emergency: 'text-red-200',
  maintenance: 'text-amber-200',
};

const quickActionSubtitleStyles: Record<QuickActionType, string> = {
  emergency: 'text-white',
  maintenance: 'text-white',
};

function getWakeWordLabel(status: VoskWakeWordStatus, error: string | null): string {
  switch (status) {
    case 'loading-model':
      return 'Caricamento wake word';
    case 'requesting-microphone':
      return 'Permesso microfono';
    case 'wake-listening':
      return 'Wake word attivo';
    case 'command-listening':
      return 'In ascolto domanda';
    case 'error':
      return error ? 'Wake word non disponibile' : 'Errore wake word';
    case 'ready':
      return 'Wake word in pausa';
    case 'disabled':
    default:
      return 'Wake word disattivato';
  }
}

function isWakeWordActive(status: VoskWakeWordStatus): boolean {
  return status === 'wake-listening' || status === 'command-listening';
}

function shouldAutoMarkAsNotApplicable(response: AskQuestionApiResponse): boolean {
  return response.mode === 'fallback' || response.reason_code === 'out_of_scope' || response.reason_code === 'no_match';
}

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
  const [activeInteractionId, setActiveInteractionId] = useState<number | null>(null);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [quickActionInFlight, setQuickActionInFlight] = useState<QuickActionType | null>(null);
  const [showEmergencyConfirmation, setShowEmergencyConfirmation] = useState(false);
  const [wakeWordMuted, setWakeWordMuted] = useState(false);
  const [pendingResolution, setPendingResolution] = useState<PendingResolution | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [technicianUsername, setTechnicianUsername] = useState('');
  const [technicianPassword, setTechnicianPassword] = useState('');
  const [isResolvingInteraction, setIsResolvingInteraction] = useState(false);
  const activeInteractionIdRef = useRef<number | null>(null);
  const [showStartupChecklist, setShowStartupChecklist] = useState(false);
  const [startupChecklistCompleted, setStartupChecklistCompleted] = useState(false);
  const [pendingLoginData, setPendingLoginData] = useState<{
    access_token: string;
    user: { id: number; nome: string; badge_id: string; livello_esperienza: string; department_id: number | null; department_name: string | null; reparto: string; turno: string; created_at: string };
    machine: AuthMachine;
    expires_in: number;
  } | null>(null);
  const pollingTimeoutRef = useRef<number | null>(null);
  const pollingInFlightRef = useRef(false);
  const mountedAtRef = useRef<number>(Date.now());
  const eventSourceRef = useRef<EventSource | null>(null);
  const sseRetryTimeoutRef = useRef<number | null>(null);
  const sseConnectedRef = useRef(false);
  const logoutMessageTimeoutRef = useRef<number | null>(null);
  const manualLogoutInProgressRef = useRef(false);
  const avatarDisplayRef = useRef<AvatarDisplayHandle | null>(null);

  // Effetto per mostrare la checklist di startup dopo il login
  useEffect(() => {
    if (isLoggedIn && !isAdmin && machine && !startupChecklistCompleted) {
      setShowStartupChecklist(true);
    }
  }, [isLoggedIn, isAdmin, machine, startupChecklistCompleted]);

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

  const setTrackedActiveInteractionId = (interactionId: number | null) => {
    activeInteractionIdRef.current = interactionId;
    setActiveInteractionId(interactionId);
  };

  const resetResolutionForm = () => {
    setResolutionNote('');
    setTechnicianUsername('');
    setTechnicianPassword('');
    setIsResolvingInteraction(false);
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
    if (!pendingResolution?.resolvedByName) {
      return;
    }

    const hideResolutionBannerTimeout = window.setTimeout(() => {
      setPendingResolution(null);
      resetResolutionForm();
    }, 5000);

    return () => {
      window.clearTimeout(hideResolutionBannerTimeout);
    };
  }, [pendingResolution?.resolvedByName]);

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

        if (tokenResponse.status === 409) {
          await stopAndLogout('Sessione non piu valida');
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

  const submitInteractionFeedback = async (
    interactionId: number,
    feedbackStatus: InteractionFeedbackStatus,
    token: string
  ) => {
    const response = await fetch(API_ENDPOINTS.INTERACTION_FEEDBACK(interactionId), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        feedback_status: feedbackStatus,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Errore nel salvataggio del feedback');
    }
  };

  const submitInteractionResolution = async (
    interactionId: number,
    token: string,
    technicianAuth: { technician_badge_id?: string; technician_username?: string; technician_password?: string }
  ): Promise<InteractionResolutionResponse> => {
    const response = await fetch(API_ENDPOINTS.INTERACTION_RESOLVE(interactionId), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        resolution_note: resolutionNote.trim() || null,
        ...technicianAuth,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Errore nella conferma della risoluzione');
    }

    return (await response.json()) as InteractionResolutionResponse;
  };

  const markActiveInteractionAsNotApplicable = async () => {
    const interactionId = activeInteractionIdRef.current;

    if (!interactionId || !accessToken || isSubmittingFeedback) {
      return;
    }

    try {
      await submitInteractionFeedback(interactionId, 'not_applicable', accessToken);
      setShowFollowUp(false);
      setTrackedActiveInteractionId(null);
    } catch (error) {
      console.error('Errore salvataggio feedback non rilevante durante logout:', error);
    }
  };

  const handleLogout = async () => {
    manualLogoutInProgressRef.current = true;
    dismissLogoutMessage();
    await markActiveInteractionAsNotApplicable();
    avatarDisplayRef.current?.stopSpeech();
    setAvatarState('idle');
    setTranscript('');
    setQuestionInput('');
    setCurrentTranscription('');
    setShowFollowUp(false);
    setClarificationOptions([]);
    setPendingQuestion(null);
    setFallbackReasonCode(null);
    setTrackedActiveInteractionId(null);
    setIsSubmittingFeedback(false);
    setQuickActionInFlight(null);
    setShowEmergencyConfirmation(false);
    setWakeWordMuted(false);
    setPendingResolution(null);
    resetResolutionForm();
    setIsTyping(false);
    setShowSubtitles(false);
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
    setTrackedActiveInteractionId(null);

    try {
      const response = await fetch(API_ENDPOINTS.INTERACTION_ASK, {
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
      const interactionId = data.interaction_id ?? null;

      if (interactionId) {
        setTrackedActiveInteractionId(interactionId);
      }

      if (interactionId && manualLogoutInProgressRef.current) {
        await submitInteractionFeedback(interactionId, 'not_applicable', accessToken);
        setTrackedActiveInteractionId(null);
        return;
      }

      const speechPayload = await handleTTS(data.response);
      let playback: TtsPlayback | null = null;

      if (manualLogoutInProgressRef.current) {
        return;
      }

      if (speechPayload) {
        setAvatarState('speaking');
        playback = await startSpeechPlayback(speechPayload);
      }

      if (manualLogoutInProgressRef.current) {
        return;
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

      if (manualLogoutInProgressRef.current) {
        return;
      }

      if (shouldAutoMarkAsNotApplicable(data)) {
        setPendingQuestion(null);
        setClarificationOptions([]);
        setFallbackReasonCode(data.reason_code);
        setShowFollowUp(false);

        if (interactionId) {
          try {
            await submitInteractionFeedback(interactionId, 'not_applicable', accessToken);
            setTrackedActiveInteractionId(null);
          } catch (feedbackError) {
            console.error('Errore salvataggio feedback non rilevante per risposta fallback:', feedbackError);
          }
        }

        return;
      }

      if (data.mode === 'clarification') {
        setPendingQuestion(userQuestion);
        setClarificationOptions(data.clarification_options);
        return;
      }

      setPendingQuestion(null);
      setClarificationOptions([]);
      setFallbackReasonCode(data.mode === 'fallback' ? data.reason_code : null);
      setTrackedActiveInteractionId(interactionId);
      setShowFollowUp(Boolean(data.interaction_id));
    } catch (error) {
      if (manualLogoutInProgressRef.current) {
        return;
      }

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

  const playAssistantMessage = async (message: string) => {
    const speechPayload = await handleTTS(message);
    let playback: TtsPlayback | null = null;

    if (speechPayload) {
      setAvatarState('speaking');
      playback = await startSpeechPlayback(speechPayload);
    }

    await startTypingEffect(message, speechPayload?.durationMs);

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
  };

  const resetInteractionStateForQuickAction = () => {
    setQuestionInput('');
    setShowFollowUp(false);
    setClarificationOptions([]);
    setPendingQuestion(null);
    setFallbackReasonCode(null);
    setTrackedActiveInteractionId(null);
  };

  const submitQuickAction = async (actionType: QuickActionType) => {
    if (!user || !machine || !accessToken || quickActionInFlight || isTyping || avatarState === 'speaking' || avatarState === 'thinking') {
      return;
    }

    setQuickActionInFlight(actionType);
    setShowEmergencyConfirmation(false);
    resetInteractionStateForQuickAction();

    try {
      const response = await fetch(API_ENDPOINTS.INTERACTION_QUICK_ACTION, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          machine_id: machine.id,
          user_id: user.id,
          action_type: actionType,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Errore durante l invio della segnalazione');
      }

      const data = (await response.json()) as QuickActionApiResponse;
      setPendingResolution({
        interactionId: data.interaction_id,
        message: actionType === 'emergency'
          ? 'Emergenza aperta: attendi il tecnico e conferma la risoluzione dopo l intervento.'
          : 'Richiesta manutenzione aperta: il tecnico potra confermare la risoluzione da questa postazione.',
      });
      resetResolutionForm();
      await playAssistantMessage(data.message || quickActionFallbackMessages[actionType]);
    } catch (error) {
      console.error('Errore invio segnalazione rapida:', error);
      setAvatarState('idle');
      setIsTyping(false);
      setShowSubtitles(false);
      alert(error instanceof Error ? error.message : 'Errore durante l invio della segnalazione');
    } finally {
      setQuickActionInFlight(null);
    }
  };

  const handleFollowUpResponse = async (feedbackStatus: InteractionFeedbackStatus) => {
    if (!activeInteractionId || !accessToken || isSubmittingFeedback) {
      return;
    }

    setIsSubmittingFeedback(true);
    try {
      await submitInteractionFeedback(activeInteractionId, feedbackStatus, accessToken);

      setShowFollowUp(false);
      if (feedbackStatus === 'unresolved') {
        setPendingResolution({
          interactionId: activeInteractionId,
          message: 'Problema aperto: attendi il tecnico e conferma la risoluzione dopo l intervento.',
        });
        resetResolutionForm();
      } else {
        setPendingResolution(null);
        resetResolutionForm();
      }
      setTrackedActiveInteractionId(null);
      if (feedbackStatus === 'unresolved') {
        const speechPayload = await handleTTS(UNRESOLVED_CONFIRMATION_MESSAGE);
        let playback: TtsPlayback | null = null;

        if (speechPayload) {
          setAvatarState('speaking');
          playback = await startSpeechPlayback(speechPayload);
        }

        await startTypingEffect(UNRESOLVED_CONFIRMATION_MESSAGE, speechPayload?.durationMs);

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
      } else {
        setCurrentTranscription('');
      }
    } catch (error) {
      console.error('Errore invio feedback interazione:', error);
      alert(error instanceof Error ? error.message : 'Errore nel salvataggio del feedback');
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  const handleTechnicianBadgeResolution = async () => {
    if (!pendingResolution || !accessToken || isResolvingInteraction) {
      return;
    }

    setIsResolvingInteraction(true);
    try {
      const data = await submitInteractionResolution(
        pendingResolution.interactionId,
        accessToken,
        { technician_badge_id: 'NFT-001' }
      );
      setPendingResolution({
        interactionId: data.interaction_id,
        message: 'Intervento confermato e problema segnato come risolto.',
        resolvedByName: data.resolved_by_user_name,
        resolutionTimestamp: data.resolution_timestamp,
      });
      setResolutionNote('');
    } catch (error) {
      console.error('Errore conferma risoluzione con badge:', error);
      alert(error instanceof Error ? error.message : 'Errore nella conferma della risoluzione');
    } finally {
      setIsResolvingInteraction(false);
    }
  };

  const handleTechnicianCredentialsResolution = async () => {
    if (!pendingResolution || !accessToken || isResolvingInteraction) {
      return;
    }
    if (!technicianUsername.trim() || !technicianPassword) {
      alert('Inserisci credenziali tecnico');
      return;
    }

    setIsResolvingInteraction(true);
    try {
      const data = await submitInteractionResolution(
        pendingResolution.interactionId,
        accessToken,
        {
          technician_username: technicianUsername.trim(),
          technician_password: technicianPassword,
        }
      );
      setPendingResolution({
        interactionId: data.interaction_id,
        message: 'Intervento confermato e problema segnato come risolto.',
        resolvedByName: data.resolved_by_user_name,
        resolutionTimestamp: data.resolution_timestamp,
      });
      resetResolutionForm();
    } catch (error) {
      console.error('Errore conferma risoluzione con credenziali:', error);
      alert(error instanceof Error ? error.message : 'Errore nella conferma della risoluzione');
    } finally {
      setIsResolvingInteraction(false);
    }
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

  const wakeWordAutomaticallyPaused = loading || isTyping || avatarState === 'thinking' || avatarState === 'speaking';
  const wakeWordPaused = wakeWordMuted || wakeWordAutomaticallyPaused;
  const {
    status: wakeWordStatus,
    partialTranscript: voicePartialTranscript,
    lastTranscript: voiceLastTranscript,
    error: wakeWordError,
  } = useVoskWakeWord({
    enabled: isLoggedIn && !isAdmin && Boolean(user) && Boolean(machine),
    paused: wakeWordPaused,
    wakePhrase: 'Ehi Ditto',
    modelUrl: VOSK_MODEL_URL,
    onWake: () => {
      setAvatarState('listening');
      setQuestionInput('');
      setCurrentTranscription('');
      setShowFollowUp(false);
      setClarificationOptions([]);
      setPendingQuestion(null);
      setFallbackReasonCode(null);
      setTrackedActiveInteractionId(null);
    },
    onTranscriptFinal: (transcript) => {
      setQuestionInput(transcript);
      setAvatarState('idle');
      void submitQuestion(transcript);
    },
    onError: (voiceError) => {
      console.error('Wake word Vosk error:', voiceError);
      setAvatarState('idle');
    },
  });
  const wakeWordActive = isWakeWordActive(wakeWordStatus);
  const wakeWordLabel = getWakeWordLabel(wakeWordStatus, wakeWordError);
  const canToggleWakeWord = isLoggedIn && !isAdmin && Boolean(user) && Boolean(machine);
  const voiceDebugTranscript = voicePartialTranscript || voiceLastTranscript;
  const quickActionsDisabled = Boolean(quickActionInFlight) || isTyping || avatarState === 'thinking' || avatarState === 'speaking';

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
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

      {/* Startup Checklist Dialog - viene mostrato dopo il login */}
      {showStartupChecklist && machine && accessToken && (
        <StartupChecklistDialog
          machineId={machine.id}
          machineName={machine.nome}
          accessToken={accessToken}
          onComplete={() => {
            setStartupChecklistCompleted(true);
            setShowStartupChecklist(false);
          }}
        />
      )}

      {/* Background pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0" style={{
          backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
          backgroundSize: '40px 40px'
        }}></div>
      </div>

      <div className="relative z-10 flex min-h-[100dvh] flex-col">
        <header className="shrink-0 border-b border-white/10 bg-slate-950/20 px-4 py-3 backdrop-blur-sm sm:px-6 sm:py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
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

            <div className="flex flex-wrap items-center justify-end gap-3">
              <div
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm ${
                  wakeWordStatus === 'error'
                    ? 'border-red-400/30 bg-red-500/10 text-red-100'
                    : wakeWordMuted
                      ? 'border-slate-400/20 bg-slate-500/10 text-slate-200'
                    : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'
                }`}
                title={wakeWordError || 'Il browser chiedera il permesso microfono al primo avvio.'}
              >
                <Radio className={`h-4 w-4 ${wakeWordActive ? 'text-green-400 animate-pulse' : 'text-slate-500'}`} />
                <span>{wakeWordMuted ? 'Wake word mutato' : wakeWordLabel}</span>
              </div>

              {canToggleWakeWord && (
                <button
                  type="button"
                  onClick={() => setWakeWordMuted((current) => !current)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition-colors ${
                    wakeWordMuted
                      ? 'border-blue-400/30 bg-blue-500/10 text-blue-100 hover:bg-blue-500/20'
                      : 'border-white/10 bg-white/5 text-slate-100 hover:bg-white/10'
                  }`}
                  aria-pressed={wakeWordMuted}
                  title={wakeWordMuted ? 'Riattiva ascolto wake word' : 'Metti in pausa la wake word'}
                >
                  {wakeWordMuted ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                  <span>{wakeWordMuted ? 'Riattiva wake word' : 'Muta wake word'}</span>
                </button>
              )}

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

        <main className="flex-1 px-3 py-3 sm:px-6 sm:py-5">
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
            <div className="grid gap-4 md:min-h-0 md:grid-cols-[minmax(280px,0.95fr)_minmax(360px,1.05fr)]">
              <section className="flex min-h-[280px] flex-col rounded-[24px] border border-white/10 bg-slate-950/20 p-4 backdrop-blur-sm sm:min-h-[340px] sm:p-6 md:min-h-0">
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
                      <span>{voicePartialTranscript || 'In ascolto...'}</span>
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
                    {wakeWordActive && voiceDebugTranscript && (
                      <p className="mx-auto max-w-md break-words text-xs text-slate-400">
                        Riconosciuto: {voiceDebugTranscript}
                      </p>
                    )}
                  </div>
                </div>
              </section>

              <section className="flex min-h-[420px] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/25 backdrop-blur-sm md:min-h-0">
                <div className="shrink-0 border-b border-white/10 px-4 py-4 sm:px-5">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Console operatore</p>
                  <h2 className="mt-1 text-lg font-semibold text-white">Domande, risposte e azioni rapide</h2>
                  <p className="mt-1 text-sm text-slate-400">
                      Scrivi o pronuncia le tue domande tecniche. L'assistente fornirà risposte dettagliate, suggerimenti e procedure guidate per aiutarti a risolvere i problemi senza dover consultare manuali o cercare online.
                  </p>
                </div>

                <div className="flex-1 px-4 py-4 sm:px-5 md:min-h-0">
                  <ScrollArea className="h-full md:pr-3">
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold text-slate-200">Risposta assistente</h3>
                          {isTyping && (
                            <span className="rounded-full border border-blue-400/20 bg-blue-500/10 px-2 py-1 text-xs text-blue-200">
                              In scrittura
                            </span>
                          )}
                        </div>

                        {currentTranscription ? (
                          <>
                          <div className="mt-3 break-words whitespace-pre-line text-sm leading-6 text-slate-100">
                              {currentTranscription}
                              {isTyping && <span className="animate-pulse">|</span>}
                            </div>
                            {!isTyping && fallbackReasonCode === 'out_of_scope' && (
                              <p className="mt-3 text-xs text-amber-200">
                                Richiesta fuori ambito: posso aiutarti solo con macchine, sicurezza e procedure di reparto.
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
                            Scrivi una domanda tecnica per iniziare.
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
                              onClick={() => void handleFollowUpResponse('resolved')}
                              disabled={isSubmittingFeedback}
                              className="rounded-xl bg-green-500 px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Si
                            </button>
                            <button
                              onClick={() => void handleFollowUpResponse('unresolved')}
                              disabled={isSubmittingFeedback}
                              className="rounded-xl bg-red-500 px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              No
                            </button>
                            <button
                              onClick={() => void handleFollowUpResponse('not_applicable')}
                              disabled={isSubmittingFeedback}
                              className="rounded-xl bg-slate-500 px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Non rilevante
                            </button>
                          </div>
                        </div>
                      )}

                      {pendingResolution && (
                        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4">
                          <div className="flex flex-col gap-4">
                            <div>
                              <p className="text-xs uppercase tracking-[0.22em] text-amber-200">In attesa tecnico</p>
                              <h3 className="mt-1 text-lg font-semibold text-white">Conferma intervento tecnico</h3>
                              <p className="mt-1 text-sm leading-6 text-amber-50">{pendingResolution.message}</p>
                              {pendingResolution.resolvedByName ? (
                                <p className="mt-2 text-sm font-semibold text-emerald-200">
                                  Risolto da {pendingResolution.resolvedByName}
                                  {pendingResolution.resolutionTimestamp
                                    ? ` - ${new Date(pendingResolution.resolutionTimestamp).toLocaleString('it-IT')}`
                                    : ''}
                                </p>
                              ) : null}
                            </div>

                            {!pendingResolution.resolvedByName && (
                              <>
                                <textarea
                                  value={resolutionNote}
                                  onChange={(event) => setResolutionNote(event.target.value)}
                                  placeholder="Nota tecnica opzionale..."
                                  className="min-h-24 w-full resize-none rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-300"
                                />

                                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <input
                                      type="text"
                                      value={technicianUsername}
                                      onChange={(event) => setTechnicianUsername(event.target.value)}
                                      placeholder="Nome tecnico"
                                      className="min-w-0 rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-300"
                                    />
                                    <input
                                      type="password"
                                      value={technicianPassword}
                                      onChange={(event) => setTechnicianPassword(event.target.value)}
                                      placeholder="Password tecnico"
                                      className="min-w-0 rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-300"
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => void handleTechnicianCredentialsResolution()}
                                    disabled={isResolvingInteraction}
                                    className="rounded-xl bg-amber-400 px-4 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    Conferma con login
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => void handleTechnicianBadgeResolution()}
                                  disabled={isResolvingInteraction}
                                  className="rounded-xl border border-amber-300/50 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-50 transition-colors hover:bg-amber-300/20 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {isResolvingInteraction ? 'Conferma in corso...' : 'Simula badge manutentore'}
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      {showEmergencyConfirmation && (
                        <div className="rounded-2xl border border-red-400/50 bg-red-500/15 p-4">
                          <div className="flex items-start gap-3">
                            <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-red-200" />
                            <div className="min-w-0 flex-1">
                              <h3 className="text-base font-semibold text-red-50">Conferma emergenza</h3>
                              <p className="mt-1 text-sm leading-6 text-red-100">
                                Invia un segnale critico all'area admin per questa macchina. Non arresta fisicamente la macchina.
                              </p>
                              <div className="mt-4 flex flex-wrap gap-3">
                                <button
                                  type="button"
                                  onClick={() => void submitQuickAction('emergency')}
                                  disabled={quickActionsDisabled}
                                  className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {quickActionInFlight === 'emergency' ? 'Invio emergenza...' : 'Conferma emergenza'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setShowEmergencyConfirmation(false)}
                                  disabled={Boolean(quickActionInFlight)}
                                  className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Annulla
                                </button>
                              </div>
                            </div>
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
                            setTrackedActiveInteractionId(null);
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
                        className="w-full rounded-xl bg-blue-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-600 sm:w-auto"
                      >
                        Invia
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {quickActions.map((action) => (
                        <button
                          key={action.title}
                          type="button"
                          onClick={() => {
                            if (action.actionType === 'emergency') {
                              setShowEmergencyConfirmation(true);
                              return;
                            }
                            void submitQuickAction(action.actionType);
                          }}
                          disabled={quickActionsDisabled}
                          className={`rounded-2xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${quickActionButtonStyles[action.actionType]}`}
                        >
                          <span className={`block text-xs uppercase tracking-[0.18em] ${quickActionTitleStyles[action.actionType]}`}>{action.title}</span>
                          <span className={`mt-1 block text-sm font-semibold ${quickActionSubtitleStyles[action.actionType]}`}>
                            {quickActionInFlight === action.actionType ? 'Invio in corso...' : action.subtitle}
                          </span>
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
