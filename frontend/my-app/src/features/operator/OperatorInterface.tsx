import { memo, useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { AlertTriangle, Info, Mic, MicOff, Radio, Settings, Siren, Trash2, Wrench, X } from 'lucide-react';
import { AvatarDisplay, type AvatarDisplayHandle } from './AvatarDisplay';
import { BadgeReader } from './BadgeReader';
import { OperatorSettingsDialog } from './OperatorSettingsDialog';
import { StartupChecklistDialog } from './StartupChecklistDialog';
import {
  applyLegacyGraphicsPreference,
  readOperatorDisplayPreferences,
  writeOperatorDisplayPreferences,
  type OperatorDisplayPreferences,
} from './operatorDisplayPreferences';
import { useAuth } from '@/shared/auth/AuthContext';
import { playTtsAudio, synthesizeTts, type TtsPlayback, type TtsSpeechPayload } from '@/shared/api/ttsClient';
import { API_ENDPOINTS } from '@/shared/api/config';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { ScrollArea } from '@/shared/ui/scroll-area';
import { useVoskWakeWord, type VoskWakeWordStatus } from './voice/useVoskWakeWord';

type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking';
type SessionStatusReason = 'ok' | 'working_station_released' | 'working_station_reassigned' | 'working_station_not_found';

type SessionStatusPayload = {
  session_valid: boolean;
  working_station_assigned: boolean;
  working_station_in_use: boolean;
  operator_matches: boolean;
  should_logout: boolean;
  reason: SessionStatusReason;
};

type ClarificationOption = {
  knowledge_item_id: number;
  label: string;
  category_name?: string | null;
};

type AgentCandidateOption = {
  material_id: number;
  label: string;
  description?: string | null;
};

type AgentConfirmationPayload = {
  prompt: string;
  action: string;
  material_id?: number | null;
  material_name?: string | null;
};

type AgentExecutedAction = {
  action: string;
  status: 'completed' | 'blocked' | 'cancelled';
  ticket_id?: number | null;
  summary?: string | null;
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
  response_mode?: 'knowledge_answer' | 'agent_question' | 'confirmation_required' | 'action_completed' | 'action_blocked' | null;
  conversation_state_id?: number | null;
  workflow_type?: 'material_shortage' | null;
  pending_slots?: string[];
  candidate_options?: AgentCandidateOption[];
  confirmation_payload?: AgentConfirmationPayload | null;
  executed_action?: AgentExecutedAction | null;
  ticket_id?: number | null;
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

type PendingQuickActionApiResponse = {
  interaction_id: number;
  action_type: QuickActionType;
  priority: 'normal' | 'critical';
  feedback_status: InteractionFeedbackStatus;
  message: string;
  timestamp: string;
  resolved_by_user_id?: number | null;
  resolved_by_user_name?: string | null;
  resolution_timestamp?: string | null;
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

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  interaction_id?: number | null;
};

type SessionHistoryResponse = {
  chat_session_id?: number | null;
  working_station_id: number;
  machine_id?: number | null;
  messages: ChatMessage[];
};

const UNRESOLVED_CONFIRMATION_MESSAGE =
  "L'assistenza è stata informata del tuo problema e inviera al piu presto un tecnico. Quando il tecnico avra risolto il problema, l'intervento potra essere confermato nel sistema.";

const VOSK_MODEL_URL = import.meta.env.VITE_VOSK_MODEL_URL || '/models/vosk-model-small-it-0.22.tar.gz';

const quickActions = [
  { actionType: 'emergency', title: 'Emergenza', icon: Siren },
  { actionType: 'maintenance', title: 'Manutenzione', icon: Wrench },
] as const satisfies readonly {
  actionType: QuickActionType;
  title: string;
  icon: typeof Siren;
}[];

const quickActionFallbackMessages: Record<QuickActionType, string> = {
  maintenance: 'La richiesta di manutenzione e stata inviata.',
  emergency: 'Emergenza inviata. Allontanati dalla macchina e segui le procedure di sicurezza del reparto.',
};


const quickActionConfirmationCopy: Record<
  QuickActionType,
  {
    title: string;
    description: string;
    confirmLabel: string;
    confirmLoadingLabel: string;
    containerClassName: string;
    iconClassName: string;
    confirmButtonClassName: string;
  }
> = {
  emergency: {
    title: 'Conferma emergenza',
    description: "Invia un segnale critico all'area admin per questa postazione. Non arresta fisicamente il macchinario, se presente.",
    confirmLabel: 'Conferma emergenza',
    confirmLoadingLabel: 'Invio emergenza...',
    containerClassName: 'border-red-400/50 bg-red-500/15',
    iconClassName: 'text-red-200',
    confirmButtonClassName: 'bg-red-500 text-white hover:bg-red-600',
  },
  maintenance: {
    title: 'Conferma richiesta manutenzione',
    description: "Invia una richiesta di intervento tecnico per questa postazione e il macchinario associato, se presente.",
    confirmLabel: 'Conferma manutenzione',
    confirmLoadingLabel: 'Invio richiesta...',
    containerClassName: 'border-amber-400/50 bg-amber-500/15',
    iconClassName: 'text-amber-200',
    confirmButtonClassName: 'bg-amber-400 text-slate-950 hover:bg-amber-300',
  },
};

function normalizeVoiceCommand(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const affirmativeVoiceCommands = [
  'conferma',
  'si',
  'sì',
  'ok',
  'va bene',
  'procedi',
  'invia',
  'confermo',
] as const;

const negativeVoiceCommands = [
  'annulla',
  'no',
  'ferma',
  'cancella',
  'non confermare',
  'lascia stare',
] as const;

const ordinalVoiceCommands = [
  ['prima', 'opzione uno', 'uno', '1'],
  ['seconda', 'opzione due', 'due', '2'],
  ['terza', 'opzione tre', 'tre', '3'],
] as const;

function isVoiceCommandMatch(transcript: string, commands: readonly string[]): boolean {
  return commands.some((command) => transcript === command || transcript.startsWith(`${command} `));
}

const maintenanceKnowledgeHints = [
  'ordinaria',
  'periodica',
  'preventiva',
  'straordinaria',
  'procedura',
  'procedure',
  'controllo',
  'controlli',
  'come',
  'cosa',
  'quale',
  'quali',
  'quando',
  'fare',
  'faccio',
  'eseguire',
  'eseguo',
  'olio',
  'filtri',
  'filtro',
  'cinghia',
  'cinghie',
  'lubrificazione',
  'intervalli',
] as const;

const emergencyKnowledgeHints = [
  'arresto',
  'pulsante',
  'procedura',
  'procedure',
  'sicurezza',
  'come',
  'cosa',
  'quale',
  'quali',
  'quando',
  'fare',
  'faccio',
  'dove',
  'trovo',
  'si trova',
  'gestire',
  'gestisco',
] as const;

function shouldRouteMaintenanceToKnowledge(normalizedTranscript: string): boolean {
  if (!normalizedTranscript.includes('manutenzione')) {
    return false;
  }

  const tokens = normalizedTranscript.split(' ');
  if (tokens.length <= 1) {
    return false;
  }

  return maintenanceKnowledgeHints.some((hint) => tokens.includes(hint));
}

function shouldRouteEmergencyToKnowledge(normalizedTranscript: string): boolean {
  if (!normalizedTranscript.includes('emergenza')) {
    return false;
  }

  const tokens = normalizedTranscript.split(' ');
  if (tokens.length <= 1) {
    return false;
  }

  return emergencyKnowledgeHints.some((hint) => normalizedTranscript.includes(hint));
}

function resolveVoiceQuickActionCommand(transcript: string): QuickActionType | null {
  const normalizedTranscript = normalizeVoiceCommand(transcript);

  if (!normalizedTranscript) {
    return null;
  }

  const emergencyCommands = [
    'emergenza',
    'chiama emergenza',
    'invia emergenza',
    'segnala emergenza',
    'apri emergenza',
    'allarme emergenza',
    'serve emergenza',
    'ho un emergenza',
  ];
  const maintenanceCommands = [
    'manutenzione',
    'chiama manutenzione',
    'richiedi manutenzione',
    'invia manutenzione',
    'segnala manutenzione',
    'apri manutenzione',
    'chiama tecnico',
    'richiedi tecnico',
    'manda tecnico',
    'serve un tecnico',
    'mi serve un tecnico',
    'ho bisogno di un tecnico',
    'serve manutenzione',
  ];

  if (shouldRouteEmergencyToKnowledge(normalizedTranscript)) {
    return null;
  }

  if (emergencyCommands.some((command) => normalizedTranscript === command || normalizedTranscript.startsWith(`${command} `))) {
    return 'emergency';
  }

  if (shouldRouteMaintenanceToKnowledge(normalizedTranscript)) {
    return null;
  }

  if (maintenanceCommands.some((command) => normalizedTranscript === command || normalizedTranscript.startsWith(`${command} `))) {
    return 'maintenance';
  }

  return null;
}

function getWakeWordLabel(status: VoskWakeWordStatus, error: string | null): string {
  switch (status) {
    case 'loading-model':
      return 'Caricamento';
    case 'requesting-microphone':
      return 'Permesso microfono';
    case 'wake-listening':
      return 'In attesa';
    case 'command-listening':
      return 'In ascolto';
    case 'error':
      if (error?.toLowerCase().includes('microfono')) {
        return 'Microfono non disponibile';
      }
      return error ? 'Non disponibile' : 'Errore';
    case 'ready':
      return 'In pausa';
    case 'disabled':
      return 'Disattivata';
    default:
      return 'Non disponibile';
  }
}

function isWakeWordActive(status: VoskWakeWordStatus): boolean {
  return status === 'wake-listening' || status === 'command-listening';
}

function shouldAutoMarkAsNotApplicable(response: AskQuestionApiResponse): boolean {
  return response.mode === 'fallback' || response.reason_code === 'out_of_scope' || response.reason_code === 'no_match';
}

function getApiErrorMessage(errorPayload: unknown, fallbackMessage: string): string {
  if (
    errorPayload &&
    typeof errorPayload === 'object' &&
    'detail' in errorPayload
  ) {
    const detail = (errorPayload as { detail?: unknown }).detail;
    if (typeof detail === 'string') {
      return detail;
    }
    if (
      detail &&
      typeof detail === 'object' &&
      'message' in detail &&
      typeof (detail as { message?: unknown }).message === 'string'
    ) {
      return (detail as { message: string }).message;
    }
  }

  return fallbackMessage;
}

function buildPendingResolutionState(
  actionType: QuickActionType,
  fallbackMessage?: string,
  resolvedByName?: string | null,
  resolutionTimestamp?: string | null
): PendingResolution {
  return {
    interactionId: 0,
    message:
      fallbackMessage ||
      (actionType === 'emergency'
        ? 'Emergenza aperta: attendi il tecnico e conferma la risoluzione dopo l intervento.'
        : 'Richiesta manutenzione aperta: il tecnico potra confermare la risoluzione da questa postazione.'),
    resolvedByName,
    resolutionTimestamp,
  };
}

type OperatorHeaderProps = {
  assistantBusy: boolean;
  canClearChat: boolean;
  isLoggedIn: boolean;
  quickActionsDisabled: boolean;
  onClearChat: () => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenSessionInfo: () => void;
  onSelectQuickAction: (actionType: QuickActionType) => void;
  userName: string | null;
};

const OperatorHeader = memo(function OperatorHeader({
  assistantBusy,
  canClearChat,
  isLoggedIn,
  quickActionsDisabled,
  onClearChat,
  onLogout,
  onOpenSettings,
  onOpenSessionInfo,
  onSelectQuickAction,
  userName,
}: OperatorHeaderProps) {
  return (
    <header className="shrink-0 border-b border-white/10 bg-slate-950/20 px-4 py-2 backdrop-blur-sm sm:px-6 sm:py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold sm:text-xl">
            <span className="text-blue-400">Holo-Assistant</span>
          </h1>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Apri impostazioni operatore"
            title="Impostazioni"
          >
            <Settings className="h-4 w-4" />
          </button>
          {isLoggedIn && userName && (
            <>
              {quickActions.map((action) => {
                const Icon = action.icon;
                const isEmergency = action.actionType === 'emergency';
                return (
                  <button
                    key={action.actionType}
                    type="button"
                    onClick={() => onSelectQuickAction(action.actionType)}
                    disabled={quickActionsDisabled}
                    className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      isEmergency
                        ? 'border-red-500/35 bg-red-500/15 text-red-100 hover:bg-red-500/25'
                        : 'border-amber-400/30 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20'
                    }`}
                    aria-label={action.title}
                    title={action.title}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                );
              })}
              <button
                type="button"
                onClick={onOpenSessionInfo}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Mostra dettagli sessione"
              >
                <Info className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onClearChat}
                disabled={!canClearChat}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Svuota chat"
                title="Svuota chat"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <button
                onClick={onLogout}
                disabled={assistantBusy}
                className={`rounded-xl border px-3 py-1.5 text-sm font-semibold transition-colors ${assistantBusy ? 'cursor-not-allowed border-red-500/20 bg-red-500/10 text-red-300' : 'border-red-500/40 bg-red-500/20 text-white hover:bg-red-500/30'}`}
              >
                Logout
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
});

type OperatorAvatarPanelProps = {
  avatarDisplayRef: RefObject<AvatarDisplayHandle | null>;
  avatarState: AvatarState;
  canToggleWakeWord: boolean;
  hologramEnabled: boolean;
  voicePartialTranscript: string;
  wakeWordActive: boolean;
  wakeWordLabel: string;
  wakeWordMuted: boolean;
  wakeWordStatus: VoskWakeWordStatus;
  onToggleWakeWord: () => void;
};

const OperatorAvatarPanel = memo(function OperatorAvatarPanel({
  avatarDisplayRef,
  avatarState,
  canToggleWakeWord,
  hologramEnabled,
  voicePartialTranscript,
  wakeWordActive,
  wakeWordLabel,
  wakeWordMuted,
  wakeWordStatus,
  onToggleWakeWord,
}: OperatorAvatarPanelProps) {
  const wakeWordIndicatorClassName =
    wakeWordStatus === 'command-listening'
      ? 'text-green-400 animate-pulse'
      : wakeWordStatus === 'loading-model' || wakeWordStatus === 'requesting-microphone'
        ? 'text-blue-300 animate-pulse'
        : 'text-slate-400';

  return (
    <section className="flex min-h-0 overflow-hidden">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <AvatarDisplay
          ref={avatarDisplayRef}
          disabled={!hologramEnabled}
          state={avatarState}
          overlay={
            <div className="inline-flex max-w-full flex-wrap items-center justify-center gap-2 rounded-full border border-white/15 bg-slate-950/68 px-4 py-2 text-center text-sm text-slate-100 backdrop-blur-md">
              {avatarState === 'idle' && (
                <>
                  <Radio className={`h-4 w-4 ${wakeWordIndicatorClassName}`} />
                  <span>
                    {wakeWordMuted ? 'In pausa' : wakeWordLabel}
                    {!wakeWordMuted && wakeWordStatus === 'wake-listening'
                      ? ' - Di\' "ehi holo" per iniziare'
                      : ''}
                  </span>
                  {canToggleWakeWord && (
                    <button
                      type="button"
                      onClick={onToggleWakeWord}
                      className={`pointer-events-auto inline-flex items-center justify-center rounded-full border p-1 transition-colors ${
                        wakeWordMuted
                          ? 'border-blue-400/30 bg-blue-500/10 text-blue-100 hover:bg-blue-500/20'
                          : 'border-white/10 bg-white/5 text-slate-100 hover:bg-white/10'
                      }`}
                      aria-pressed={wakeWordMuted}
                      title={wakeWordMuted ? 'Riattiva ascolto wake word' : 'Metti in pausa la wake word'}
                    >
                      {wakeWordMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                    </button>
                  )}
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
                    <div className="h-2 w-2 rounded-full bg-yellow-400 animate-bounce" />
                    <div className="h-2 w-2 rounded-full bg-yellow-400 animate-bounce" style={{ animationDelay: '0.1s' }} />
                    <div className="h-2 w-2 rounded-full bg-yellow-400 animate-bounce" style={{ animationDelay: '0.2s' }} />
                  </div>
                  <span>Elaborazione in corso...</span>
                </>
              )}
              {avatarState === 'speaking' && (
                <>
                  <div className="h-3 w-3 rounded-full bg-violet-400 animate-pulse" />
                  <span>Risposta in corso...</span>
                </>
              )}
            </div>
          }
        />
      </div>
    </section>
  );
});

type SessionInfoDialogProps = {
  currentMachineName: string | null;
  currentWorkingStationLabel: string | null;
  open: boolean;
  operatorName: string | null;
  onOpenChange: (open: boolean) => void;
};

const SessionInfoDialog = memo(function SessionInfoDialog({
  currentMachineName,
  currentWorkingStationLabel,
  open,
  operatorName,
  onOpenChange,
}: SessionInfoDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-slate-950/95 text-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Dettagli sessione operatore</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Postazione</p>
            <p className="mt-2 break-words text-sm text-slate-100">
              {currentWorkingStationLabel || 'Nessuna postazione attiva'}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Macchinario in uso</p>
            <p className="mt-2 break-words text-sm text-slate-100">
              {currentMachineName || 'Nessun macchinario associato'}
            </p>
          </div>
          {operatorName ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Operatore</p>
              <p className="mt-2 break-words text-sm text-slate-100">{operatorName}</p>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
});

export function OperatorInterface() {
  const { 
    isLoggedIn, 
    accessToken, 
    refreshAccessToken,
    user, 
    workingStation,
    assignedMachine,
    machine, 
    login, 
    logout,
  } = useAuth();
  
  const [avatarState, setAvatarState] = useState<AvatarState>('idle');
  const [, setTranscript] = useState('');
  const [, setShowSubtitles] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logoutMessage, setLogoutMessage] = useState<string | null>(null);
  const [logoutMessageKey, setLogoutMessageKey] = useState(0);
  const [questionInput, setQuestionInput] = useState('');
  const [currentTranscription, setCurrentTranscription] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [showSessionInfo, setShowSessionInfo] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [clarificationOptions, setClarificationOptions] = useState<ClarificationOption[]>([]);
  const [agentCandidateOptions, setAgentCandidateOptions] = useState<AgentCandidateOption[]>([]);
  const [agentConfirmationPayload, setAgentConfirmationPayload] = useState<AgentConfirmationPayload | null>(null);
  const [agentConversationStateId, setAgentConversationStateId] = useState<number | null>(null);
  const [voiceInteractionActive, setVoiceInteractionActive] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [fallbackReasonCode, setFallbackReasonCode] = useState<'matched' | 'clarification' | 'no_match' | 'out_of_scope' | null>(null);
  const [activeInteractionId, setActiveInteractionId] = useState<number | null>(null);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [quickActionInFlight, setQuickActionInFlight] = useState<QuickActionType | null>(null);
  const [pendingQuickActionConfirmation, setPendingQuickActionConfirmation] = useState<QuickActionType | null>(null);
  const [wakeWordMuted, setWakeWordMuted] = useState(false);
  const [showOperatorSettings, setShowOperatorSettings] = useState(false);
  const [displayPreferences, setDisplayPreferences] = useState<OperatorDisplayPreferences>(() => readOperatorDisplayPreferences());
  const [pendingResolution, setPendingResolution] = useState<PendingResolution | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [technicianUsername, setTechnicianUsername] = useState('');
  const [technicianPassword, setTechnicianPassword] = useState('');
  const [isResolvingInteraction, setIsResolvingInteraction] = useState(false);
  const [isLoadingPendingQuickAction, setIsLoadingPendingQuickAction] = useState(false);
  const activeInteractionIdRef = useRef<number | null>(null);
  const [showStartupChecklist, setShowStartupChecklist] = useState(false);
  const [startupChecklistCompleted, setStartupChecklistCompleted] = useState(false);
  const pollingTimeoutRef = useRef<number | null>(null);
  const pollingInFlightRef = useRef(false);
  const mountedAtRef = useRef<number>(Date.now());
  const eventSourceRef = useRef<EventSource | null>(null);
  const sseRetryTimeoutRef = useRef<number | null>(null);
  const sseConnectedRef = useRef(false);
  const sseForbiddenSessionRef = useRef<string | null>(null);
  const logoutMessageTimeoutRef = useRef<number | null>(null);
  const manualLogoutInProgressRef = useRef(false);
  const avatarDisplayRef = useRef<AvatarDisplayHandle | null>(null);
  const chatScrollAreaRef = useRef<HTMLDivElement | null>(null);
  const currentWorkingStation = workingStation;
  const currentMachine = assignedMachine ?? machine;
  const hologramEnabled = displayPreferences.hologramEnabled;
  const wakeWordFeatureEnabled = displayPreferences.wakeWordEnabled;

  const scrollChatToBottom = () => {
    const scrollAreaRoot = chatScrollAreaRef.current;
    const viewport = scrollAreaRoot?.querySelector('[data-slot="scroll-area-viewport"]') as HTMLDivElement | null;
    if (!viewport) {
      return;
    }
    viewport.scrollTop = viewport.scrollHeight;
  };

  // Effetto per mostrare la checklist di startup dopo il login
  useEffect(() => {
    applyLegacyGraphicsPreference(displayPreferences.forceLegacyGraphics);
    writeOperatorDisplayPreferences(displayPreferences);
  }, [displayPreferences]);

  useEffect(() => {
    if (wakeWordFeatureEnabled) {
      return;
    }

    setWakeWordMuted(false);
  }, [wakeWordFeatureEnabled]);

  useEffect(() => {
    if (isLoggedIn && currentWorkingStation && !startupChecklistCompleted) {
      setShowStartupChecklist(true);
    }
  }, [currentWorkingStation, isLoggedIn, startupChecklistCompleted]);

  useEffect(() => {
    const fetchPendingQuickAction = async () => {
      if (!isLoggedIn || !currentWorkingStation || !accessToken) {
        setPendingResolution(null);
        return;
      }

      setIsLoadingPendingQuickAction(true);
      try {
        const response = await fetch(API_ENDPOINTS.INTERACTION_PENDING_QUICK_ACTION(currentWorkingStation.id), {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.status === 404 || response.status === 204) {
          setPendingResolution(null);
          return;
        }

        if (!response.ok) {
          const error = await response.json().catch(() => null);
          throw new Error(getApiErrorMessage(error, 'Errore nel recupero della segnalazione aperta'));
        }

        const data = (await response.json()) as PendingQuickActionApiResponse | null;
        syncPendingResolution(data);
      } catch (error) {
        console.error('Errore caricamento segnalazione aperta:', error);
      } finally {
        setIsLoadingPendingQuickAction(false);
      }
    };

    void fetchPendingQuickAction();
  }, [accessToken, currentWorkingStation, isLoggedIn]);

  const fetchSessionHistory = async () => {
    if (!isLoggedIn || !currentWorkingStation || !accessToken) {
      setChatMessages([]);
      setCurrentTranscription('');
      return;
    }

    try {
      const response = await fetch(API_ENDPOINTS.INTERACTION_SESSION_HISTORY(currentWorkingStation.id), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(getApiErrorMessage(error, 'Errore nel recupero della cronologia chat'));
      }
      const data = (await response.json()) as SessionHistoryResponse;
      setChatMessages(data.messages);
      setCurrentTranscription('');
      window.requestAnimationFrame(() => {
        scrollChatToBottom();
      });
    } catch (error) {
      console.error('Errore caricamento cronologia chat:', error);
    }
  };

  useEffect(() => {
    void fetchSessionHistory();
  }, [accessToken, currentWorkingStation?.id, isLoggedIn]);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      scrollChatToBottom();
    });
  }, [chatMessages, currentTranscription, clarificationOptions.length, agentCandidateOptions.length, agentConfirmationPayload, pendingResolution, showFollowUp]);

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

  const resetAgentInteractionState = () => {
    setAgentCandidateOptions([]);
    setAgentConfirmationPayload(null);
    setAgentConversationStateId(null);
  };

  const hasVoiceFollowUpTarget =
    Boolean(pendingQuickActionConfirmation) ||
    clarificationOptions.length > 0 ||
    agentCandidateOptions.length > 0 ||
    Boolean(agentConfirmationPayload) ||
    showFollowUp ||
    Boolean(pendingResolution?.resolvedByName);

  const assistantBusy =
    loading ||
    isTyping ||
    isSubmittingFeedback ||
    isResolvingInteraction ||
    isLoadingPendingQuickAction ||
    Boolean(quickActionInFlight) ||
    avatarState === 'thinking' ||
    avatarState === 'speaking';
  const hasOpenTechnicianRequest = Boolean(pendingResolution && !pendingResolution.resolvedByName);

  const syncPendingResolution = (pendingQuickAction: PendingQuickActionApiResponse | null) => {
    if (!pendingQuickAction || pendingQuickAction.feedback_status !== 'unresolved') {
      setPendingResolution(null);
      return;
    }

    setPendingResolution({
      interactionId: pendingQuickAction.interaction_id,
      message: pendingQuickAction.message,
      resolvedByName: pendingQuickAction.resolved_by_user_name ?? null,
      resolutionTimestamp: pendingQuickAction.resolution_timestamp ?? null,
    });
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
    if (!voiceInteractionActive) {
      return;
    }
    if (assistantBusy) {
      return;
    }
    if (hasVoiceFollowUpTarget) {
      return;
    }
    setVoiceInteractionActive(false);
  }, [assistantBusy, hasVoiceFollowUpTarget, voiceInteractionActive]);

  useEffect(() => {
    const sessionKey = currentWorkingStation && user ? `${user.id}:${currentWorkingStation.id}` : null;

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
        case 'working_station_released':
          return 'Postazione liberata dall\'amministratore';
        case 'working_station_reassigned':
          return 'Postazione assegnata a un altro operatore';
        case 'working_station_not_found':
          return 'Postazione non piu disponibile';
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
        !currentWorkingStation ||
        !user ||
        !accessToken ||
        (sessionKey !== null && sseForbiddenSessionRef.current === sessionKey) ||
        document.visibilityState !== 'visible'
      ) {
        return;
      }

      pollingInFlightRef.current = true;

      try {
        const response = await fetch(API_ENDPOINTS.SESSION_STATUS(currentWorkingStation.id), {
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
        !currentWorkingStation ||
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
          body: JSON.stringify({ working_station_id: currentWorkingStation.id }),
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

        if (tokenResponse.status === 403) {
          sseForbiddenSessionRef.current = sessionKey;
          console.info('SSE non disponibile per questa sessione: uso il polling session-status.');
          startPollingFallback();
          return;
        }

        if (!tokenResponse.ok) {
          console.error(`SSE token creation failed with status: ${tokenResponse.status}`);
          startPollingFallback();
          scheduleSseRetry();
          return;
        }

        const { token } = await tokenResponse.json();
        const eventSource = new EventSource(API_ENDPOINTS.SESSION_EVENTS(currentWorkingStation.id, token));
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
      currentWorkingStation &&
      user &&
      accessToken &&
      (sessionKey === null || sseForbiddenSessionRef.current !== sessionKey) &&
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
  }, [accessToken, currentWorkingStation, isLoggedIn, refreshAccessToken, user]);

  const handleBadgeLogin = async (badgeId: string, workingStationId: number) => {
    setLoading(true);
    try {
      const response = await fetch(API_ENDPOINTS.BADGE_LOGIN, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ badge_id: badgeId, working_station_id: workingStationId }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Errore durante il login');
      }
      const data = await response.json();
      login(
        data.access_token,
        data.user,
        data.working_station,
        data.assigned_machine ?? data.machine ?? null,
        data.chat_session_id ?? null,
        data.expires_in
      );
    } catch (error) {
      console.error('Login error:', error);
      alert(error instanceof Error ? error.message : 'Errore durante il login');
    } finally {
      setLoading(false);
    }
  };

  const handleCredentialsLogin = async (username: string, password: string, workingStationId: number) => {
    setLoading(true);
    try {
      const response = await fetch(API_ENDPOINTS.CREDENTIALS_LOGIN, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password, working_station_id: workingStationId }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        if (response.status === 403) {
          throw new Error(error?.detail || 'Non hai il permesso per accedere all interfaccia operatore');
        }
        throw new Error(error?.detail || 'Credenziali non valide');
      }
      const data = await response.json();
      login(
        data.access_token,
        data.user,
        data.working_station,
        data.assigned_machine ?? data.machine ?? null,
        data.chat_session_id ?? null,
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
      const error = await response.json().catch(() => null);
      throw new Error(getApiErrorMessage(error, 'Errore nel salvataggio del feedback'));
    }
  };

  const submitInteractionResolution = async (
    interactionId: number,
    token: string,
    technicianAuth: { technician_username?: string; technician_password?: string }
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
      const error = await response.json().catch(() => null);
      throw new Error(getApiErrorMessage(error, 'Errore nella conferma della risoluzione'));
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

  const handleLogout = useCallback(async () => {
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
    resetAgentInteractionState();
    setVoiceInteractionActive(false);
    setPendingQuestion(null);
    setFallbackReasonCode(null);
    setTrackedActiveInteractionId(null);
    setIsSubmittingFeedback(false);
    setQuickActionInFlight(null);
    setPendingQuickActionConfirmation(null);
    setWakeWordMuted(false);
    setPendingResolution(null);
    resetResolutionForm();
    setIsTyping(false);
    setShowSubtitles(false);
    await logout();
  }, [logout]);

  const handleClearChat = useCallback(async () => {
    if (!accessToken || !currentWorkingStation || assistantBusy) {
      return;
    }

    const confirmed = window.confirm(
      'Vuoi svuotare la chat operatore di questa sessione?',
    );
    if (!confirmed) {
      return;
    }

    avatarDisplayRef.current?.stopSpeech();
    setAvatarState('idle');
    setTranscript('');
    setQuestionInput('');
    setCurrentTranscription('');
    setChatMessages([]);
    setShowFollowUp(false);
    setClarificationOptions([]);
    resetAgentInteractionState();
    setVoiceInteractionActive(false);
    setPendingQuestion(null);
    setFallbackReasonCode(null);
    setTrackedActiveInteractionId(null);
    setPendingQuickActionConfirmation(null);
    setIsTyping(false);
    setShowSubtitles(false);

    try {
      const response = await fetch(API_ENDPOINTS.INTERACTION_CLEAR_SESSION_HISTORY, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          working_station_id: currentWorkingStation.id,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(getApiErrorMessage(error, 'Errore durante lo svuotamento della chat'));
      }
    } catch (error) {
      console.error('Errore svuotamento chat operatore:', error);
      alert(error instanceof Error ? error.message : 'Errore durante lo svuotamento della chat');
      void fetchSessionHistory();
    }
  }, [accessToken, assistantBusy, currentWorkingStation]);

  const handleOpenOperatorSettings = useCallback(() => {
    setShowOperatorSettings(true);
  }, []);

  const handleOpenSessionInfo = useCallback(() => {
    setShowSessionInfo(true);
  }, []);

  const handleSelectQuickActionConfirmation = useCallback((actionType: QuickActionType) => {
    setPendingQuickActionConfirmation(actionType);
  }, []);

  const handleToggleWakeWordMuted = useCallback(() => {
    setWakeWordMuted((current) => !current);
  }, []);

  const submitQuestion = async (
    userQuestion: string,
    options?: {
      selectedKnowledgeItemId?: number;
      selectedMaterialId?: number;
      conversationStateId?: number | null;
      confirmationDecision?: 'confirm' | 'cancel';
    }
  ) => {
    if (!user || !currentWorkingStation || !accessToken || assistantBusy || hasOpenTechnicianRequest) {
      return;
    }

    setAvatarState('thinking');
    setShowFollowUp(false);
    setClarificationOptions([]);
    resetAgentInteractionState();
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
          working_station_id: currentWorkingStation.id,
          question: userQuestion,
          selected_knowledge_item_id: options?.selectedKnowledgeItemId,
          selected_material_id: options?.selectedMaterialId,
          conversation_state_id: options?.conversationStateId,
          confirmation_decision: options?.confirmationDecision,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(getApiErrorMessage(error, 'Errore nel processamento della domanda'));
      }

      const data = (await response.json()) as AskQuestionApiResponse;
      const interactionId = data.interaction_id ?? null;
      setChatMessages((current) => [
        ...current,
        {
          id: `user-live-${Date.now()}`,
          role: 'user',
          content: userQuestion,
          timestamp: new Date().toISOString(),
          interaction_id: interactionId,
        },
      ]);

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
        resetAgentInteractionState();
        setFallbackReasonCode(data.reason_code);
        setShowFollowUp(false);

        if (interactionId) {
          try {
            await submitInteractionFeedback(interactionId, 'not_applicable', accessToken);
            setTrackedActiveInteractionId(null);
            await fetchSessionHistory();
          } catch (feedbackError) {
            console.error('Errore salvataggio feedback non rilevante per risposta fallback:', feedbackError);
          }
        }

        return;
      }

      if (data.mode === 'clarification') {
        setPendingQuestion(userQuestion);
        setClarificationOptions(data.clarification_options);
        resetAgentInteractionState();
        return;
      }

      if (data.response_mode === 'agent_question') {
        setPendingQuestion(userQuestion);
        setClarificationOptions([]);
        setAgentConversationStateId(data.conversation_state_id ?? null);
        setAgentCandidateOptions(data.candidate_options || []);
        setAgentConfirmationPayload(null);
        setShowFollowUp(false);
        await fetchSessionHistory();
        return;
      }

      if (data.response_mode === 'confirmation_required') {
        setPendingQuestion(userQuestion);
        setClarificationOptions([]);
        setAgentConversationStateId(data.conversation_state_id ?? null);
        setAgentCandidateOptions([]);
        setAgentConfirmationPayload(data.confirmation_payload ?? null);
        setShowFollowUp(false);
        await fetchSessionHistory();
        return;
      }

      if (data.response_mode === 'action_completed' || data.response_mode === 'action_blocked') {
        setPendingQuestion(null);
        setClarificationOptions([]);
        resetAgentInteractionState();
        setShowFollowUp(false);
        await fetchSessionHistory();
        return;
      }

      setPendingQuestion(null);
      setClarificationOptions([]);
      resetAgentInteractionState();
      setFallbackReasonCode(data.mode === 'fallback' ? data.reason_code : null);
      setTrackedActiveInteractionId(interactionId);
      setShowFollowUp(Boolean(data.interaction_id) && data.response_mode !== 'action_completed');
      await fetchSessionHistory();
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
    if (assistantBusy) {
      return;
    }

    if (questionInput.trim() && user && currentWorkingStation) {
      const userQuestion = questionInput.trim();
      setQuestionInput('');
      setVoiceInteractionActive(false);
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
    resetAgentInteractionState();
    setPendingQuestion(null);
    setFallbackReasonCode(null);
    setTrackedActiveInteractionId(null);
  };

  const submitQuickAction = async (actionType: QuickActionType) => {
    if (!user || !currentWorkingStation || !accessToken || assistantBusy || pendingResolution) {
      return;
    }

    setQuickActionInFlight(actionType);
    setPendingQuickActionConfirmation(null);
    resetInteractionStateForQuickAction();

    try {
      const response = await fetch(API_ENDPOINTS.INTERACTION_QUICK_ACTION, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          working_station_id: currentWorkingStation.id,
          user_id: user.id,
          action_type: actionType,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);

        if (
          response.status === 409 &&
          error &&
          typeof error === 'object' &&
          'detail' in error &&
          (error as { detail?: unknown }).detail &&
          typeof (error as { detail?: unknown }).detail === 'object'
        ) {
          const detail = (error as { detail: { interaction_id?: number; action_type?: QuickActionType; message?: string } }).detail;
          if (detail.interaction_id && detail.action_type) {
            setPendingResolution({
              interactionId: detail.interaction_id,
              message: detail.message || buildPendingResolutionState(detail.action_type).message,
            });
          }
        }

        throw new Error(getApiErrorMessage(error, 'Errore durante l invio della segnalazione'));
      }

      const data = (await response.json()) as QuickActionApiResponse;
      setPendingResolution({
        interactionId: data.interaction_id,
        message: buildPendingResolutionState(actionType).message,
      });
      resetResolutionForm();
      await playAssistantMessage(data.message || quickActionFallbackMessages[actionType]);
      await fetchSessionHistory();
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

  const handleVoiceTranscript = async (transcript: string) => {
    setVoiceInteractionActive(true);

    if (await tryHandleContextualVoiceCommand(transcript)) {
      setQuestionInput('');
      setAvatarState('idle');
      return;
    }

    const quickActionType = resolveVoiceQuickActionCommand(transcript);
    if (quickActionType) {
      setQuestionInput('');
      setAvatarState('idle');
      setPendingQuickActionConfirmation(quickActionType);
      return;
    }

    setQuestionInput('');
    setAvatarState('idle');
    await submitQuestion(transcript);
  };

  const handleFollowUpResponse = async (feedbackStatus: InteractionFeedbackStatus) => {
    if (!activeInteractionId || !accessToken || assistantBusy) {
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
      await fetchSessionHistory();
    } catch (error) {
      console.error('Errore invio feedback interazione:', error);
      alert(error instanceof Error ? error.message : 'Errore nel salvataggio del feedback');
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  const handleTechnicianCredentialsResolution = async () => {
    if (!pendingResolution || !accessToken || assistantBusy) {
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
      await fetchSessionHistory();
    } catch (error) {
      console.error('Errore conferma risoluzione con credenziali:', error);
      alert(error instanceof Error ? error.message : 'Errore nella conferma della risoluzione');
    } finally {
      setIsResolvingInteraction(false);
    }
  };

  const handleClarificationSelection = async (knowledgeItemId: number) => {
    if (!pendingQuestion || assistantBusy) {
      return;
    }
    await submitQuestion(pendingQuestion, { selectedKnowledgeItemId: knowledgeItemId });
  };

  const handleAgentCandidateSelection = async (option: AgentCandidateOption) => {
    if (!agentConversationStateId || assistantBusy) {
      return;
    }
    await submitQuestion(option.label, {
      selectedMaterialId: option.material_id,
      conversationStateId: agentConversationStateId,
    });
  };

  const handleAgentConfirmation = async (decision: 'confirm' | 'cancel') => {
    if (!agentConversationStateId || assistantBusy) {
      return;
    }
    const confirmationText = decision === 'confirm' ? 'Confermo' : 'Annulla';
    await submitQuestion(confirmationText, {
      conversationStateId: agentConversationStateId,
      confirmationDecision: decision,
    });
  };

  const tryHandleContextualVoiceCommand = async (transcript: string): Promise<boolean> => {
    const normalizedTranscript = normalizeVoiceCommand(transcript);
    if (!normalizedTranscript) {
      return false;
    }

    if (pendingQuickActionConfirmation) {
      if (isVoiceCommandMatch(normalizedTranscript, affirmativeVoiceCommands)) {
        await submitQuickAction(pendingQuickActionConfirmation);
        return true;
      }
      if (isVoiceCommandMatch(normalizedTranscript, negativeVoiceCommands)) {
        setPendingQuickActionConfirmation(null);
        return true;
      }
    }

    if (agentConfirmationPayload) {
      if (isVoiceCommandMatch(normalizedTranscript, affirmativeVoiceCommands)) {
        await handleAgentConfirmation('confirm');
        return true;
      }
      if (isVoiceCommandMatch(normalizedTranscript, negativeVoiceCommands)) {
        await handleAgentConfirmation('cancel');
        return true;
      }
    }

    if (showFollowUp) {
      if (isVoiceCommandMatch(normalizedTranscript, ['si', 'sì', 'risolto'])) {
        await handleFollowUpResponse('resolved');
        return true;
      }
      if (isVoiceCommandMatch(normalizedTranscript, ['no', 'non risolto', 'non ancora'])) {
        await handleFollowUpResponse('unresolved');
        return true;
      }
      if (isVoiceCommandMatch(normalizedTranscript, ['non rilevante', 'non applicabile', 'annulla'])) {
        await handleFollowUpResponse('not_applicable');
        return true;
      }
    }

    if (pendingResolution?.resolvedByName && isVoiceCommandMatch(normalizedTranscript, ['chiudi', 'ok', 'conferma'])) {
      setPendingResolution(null);
      resetResolutionForm();
      return true;
    }

    if (clarificationOptions.length > 0) {
      const clarificationIndex = ordinalVoiceCommands.findIndex((variants) =>
        variants.some((variant) => normalizedTranscript === variant)
      );
      if (clarificationIndex >= 0 && clarificationOptions[clarificationIndex]) {
        await handleClarificationSelection(clarificationOptions[clarificationIndex].knowledge_item_id);
        return true;
      }
      const matchedClarification = clarificationOptions.find((option) => {
        const label = normalizeVoiceCommand(option.label);
        return normalizedTranscript === label || label.includes(normalizedTranscript) || normalizedTranscript.includes(label);
      });
      if (matchedClarification) {
        await handleClarificationSelection(matchedClarification.knowledge_item_id);
        return true;
      }
    }

    if (agentCandidateOptions.length > 0) {
      const candidateIndex = ordinalVoiceCommands.findIndex((variants) =>
        variants.some((variant) => normalizedTranscript === variant)
      );
      if (candidateIndex >= 0 && agentCandidateOptions[candidateIndex]) {
        await handleAgentCandidateSelection(agentCandidateOptions[candidateIndex]);
        return true;
      }
      const matchedCandidate = agentCandidateOptions.find((option) => {
        const optionText = normalizeVoiceCommand(`${option.label} ${option.description || ''}`);
        return (
          normalizedTranscript === normalizeVoiceCommand(option.label) ||
          optionText.includes(normalizedTranscript) ||
          normalizedTranscript.includes(normalizeVoiceCommand(option.label))
        );
      });
      if (matchedCandidate) {
        await handleAgentCandidateSelection(matchedCandidate);
        return true;
      }
    }

    return false;
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

  const wakeWordAutomaticallyPaused = assistantBusy || hasOpenTechnicianRequest;
  const wakeWordPaused = wakeWordMuted || wakeWordAutomaticallyPaused;
  const {
    status: wakeWordStatus,
    partialTranscript: voicePartialTranscript,
    error: wakeWordError,
  } = useVoskWakeWord({
    enabled: wakeWordFeatureEnabled && isLoggedIn && Boolean(user) && Boolean(currentWorkingStation),
    paused: wakeWordPaused,
    wakePhrase: 'ehi holo',
    modelUrl: VOSK_MODEL_URL,
    commandModeRequested: voiceInteractionActive && hasVoiceFollowUpTarget && !wakeWordAutomaticallyPaused,
    onWake: () => {
      setVoiceInteractionActive(true);
      setAvatarState('listening');
      setQuestionInput('');
      setCurrentTranscription('');
      setShowFollowUp(false);
      setClarificationOptions([]);
      resetAgentInteractionState();
      setPendingQuestion(null);
      setFallbackReasonCode(null);
      setTrackedActiveInteractionId(null);
    },
    onTranscriptFinal: (transcript) => {
      void handleVoiceTranscript(transcript);
    },
    onError: (voiceError) => {
      console.error('Wake word Vosk error:', voiceError);
      setVoiceInteractionActive(false);
      setAvatarState('idle');
    },
  });
  const wakeWordActive = isWakeWordActive(wakeWordStatus);
  const wakeWordLabel = getWakeWordLabel(wakeWordStatus, wakeWordError);
  const canToggleWakeWord =
    wakeWordFeatureEnabled && isLoggedIn && Boolean(user) && Boolean(currentWorkingStation);
  const quickActionsDisabled = assistantBusy || hasOpenTechnicianRequest;

  return (
    <div
      className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white"
      style={{
        height: 'var(--app-viewport-height, 100dvh)',
        maxHeight: 'var(--app-viewport-height, 100dvh)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
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
          <p className="text-sm text-red-200 mt-1">Sei stato disconnesso dalla postazione</p>
        </div>
      )}

      {/* Startup Checklist Dialog - viene mostrato dopo il login */}
      {showStartupChecklist && currentWorkingStation && accessToken && (
        <StartupChecklistDialog
          machineId={currentWorkingStation.id}
          machineName={currentWorkingStation.name}
          accessToken={accessToken}
          onComplete={() => {
            setStartupChecklistCompleted(true);
            setShowStartupChecklist(false);
          }}
        />
      )}

      <OperatorSettingsDialog
        open={showOperatorSettings}
        onOpenChange={setShowOperatorSettings}
        preferences={displayPreferences}
        onPreferencesChange={setDisplayPreferences}
      />

      {pendingQuickActionConfirmation ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
          <div
            className={`w-full max-w-lg rounded-3xl border p-6 shadow-2xl backdrop-blur-md ${quickActionConfirmationCopy[pendingQuickActionConfirmation].containerClassName}`}
          >
            <div className="flex items-start gap-4">
              <div className="rounded-full bg-black/15 p-3">
                <AlertTriangle className={`h-6 w-6 ${quickActionConfirmationCopy[pendingQuickActionConfirmation].iconClassName}`} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-xl font-semibold text-white">
                  {quickActionConfirmationCopy[pendingQuickActionConfirmation].title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-white/90">
                  {quickActionConfirmationCopy[pendingQuickActionConfirmation].description}
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void submitQuickAction(pendingQuickActionConfirmation)}
                    disabled={quickActionsDisabled}
                    className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${quickActionConfirmationCopy[pendingQuickActionConfirmation].confirmButtonClassName}`}
                  >
                    {quickActionInFlight === pendingQuickActionConfirmation
                      ? quickActionConfirmationCopy[pendingQuickActionConfirmation].confirmLoadingLabel
                      : quickActionConfirmationCopy[pendingQuickActionConfirmation].confirmLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingQuickActionConfirmation(null)}
                    disabled={assistantBusy}
                    className="rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Annulla
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {pendingResolution ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-amber-400/30 bg-slate-900/95 p-6 shadow-2xl backdrop-blur-md">
            <div className="flex flex-col gap-5">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-amber-200">In attesa tecnico</p>
                <h3 className="mt-1 text-xl font-semibold text-white">Conferma intervento tecnico</h3>
                <p className="mt-2 text-sm leading-6 text-amber-50">{pendingResolution.message}</p>
                {pendingResolution.resolvedByName ? (
                  <p className="mt-3 text-sm font-semibold text-emerald-200">
                    Risolto da {pendingResolution.resolvedByName}
                    {pendingResolution.resolutionTimestamp
                      ? ` - ${new Date(pendingResolution.resolutionTimestamp).toLocaleString('it-IT')}`
                      : ''}
                  </p>
                ) : null}
              </div>

              {!pendingResolution.resolvedByName ? (
                <>
                  <textarea
                    value={resolutionNote}
                    onChange={(event) => setResolutionNote(event.target.value)}
                    placeholder="Nota tecnica opzionale..."
                    disabled={assistantBusy}
                    className="min-h-24 w-full resize-none rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-300"
                  />

                  <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        type="text"
                        value={technicianUsername}
                        onChange={(event) => setTechnicianUsername(event.target.value)}
                        placeholder="Nome tecnico"
                        disabled={assistantBusy}
                        className="min-w-0 rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-300"
                      />
                      <input
                        type="password"
                        value={technicianPassword}
                        onChange={(event) => setTechnicianPassword(event.target.value)}
                        placeholder="Password tecnico"
                        disabled={assistantBusy}
                        className="min-w-0 rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-300"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleTechnicianCredentialsResolution()}
                      disabled={assistantBusy}
                      className="rounded-xl bg-amber-400 px-4 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Conferma con login
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setPendingResolution(null);
                      resetResolutionForm();
                    }}
                    className="rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/15"
                  >
                    Chiudi
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <SessionInfoDialog
        currentMachineName={currentMachine?.nome ?? null}
        currentWorkingStationLabel={currentWorkingStation ? `${currentWorkingStation.name} - ${currentWorkingStation.station_code}` : null}
        open={showSessionInfo}
        operatorName={user?.nome ?? null}
        onOpenChange={setShowSessionInfo}
      />

      {/* Background pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0" style={{
          backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
          backgroundSize: '40px 40px'
        }}></div>
      </div>

      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <OperatorHeader
          assistantBusy={assistantBusy}
          canClearChat={!assistantBusy && (chatMessages.length > 0 || Boolean(currentTranscription))}
          isLoggedIn={isLoggedIn}
          quickActionsDisabled={quickActionsDisabled}
          onClearChat={() => {
            void handleClearChat();
          }}
          onLogout={() => {
            void handleLogout();
          }}
          onOpenSettings={handleOpenOperatorSettings}
          onOpenSessionInfo={handleOpenSessionInfo}
          onSelectQuickAction={handleSelectQuickActionConfirmation}
          userName={user?.nome ?? null}
        />

        <main className="flex-1 min-h-0 overflow-hidden px-3 py-3 sm:px-6 sm:py-5">
          {!isLoggedIn ? (
            <div className="h-full min-h-0 overflow-y-auto overscroll-contain md:overflow-hidden">
              <BadgeReader
                onBadgeDetected={handleBadgeLogin}
                onCredentialsLogin={handleCredentialsLogin}
              />
            </div>
          ) : loading ? (
            <div className="flex h-full items-center justify-center rounded-[28px] border border-white/10 bg-slate-950/20 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-4">
                <div className="h-16 w-16 animate-spin rounded-full border-4 border-blue-400 border-t-transparent"></div>
                <p className="text-slate-300">Accesso in corso...</p>
              </div>
            </div>
          ) : (
            <div className="grid h-full min-h-0 gap-4 overflow-hidden grid-rows-[minmax(14rem,0.8fr)_minmax(0,1.2fr)] md:grid-cols-[minmax(280px,0.95fr)_minmax(360px,1.05fr)] md:grid-rows-1">
              <OperatorAvatarPanel
                avatarDisplayRef={avatarDisplayRef}
                avatarState={avatarState}
                canToggleWakeWord={canToggleWakeWord}
                hologramEnabled={hologramEnabled}
                onToggleWakeWord={handleToggleWakeWordMuted}
                voicePartialTranscript={voicePartialTranscript}
                wakeWordActive={wakeWordActive}
                wakeWordLabel={wakeWordLabel}
                wakeWordMuted={wakeWordMuted}
                wakeWordStatus={wakeWordStatus}
              />

              <section className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/25 backdrop-blur-sm">
                <div className="flex-1 min-h-0 overflow-hidden px-4 py-4 sm:px-5">
                  <ScrollArea ref={chatScrollAreaRef} className="h-full md:pr-3">
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold text-slate-200">Chat operatore</h3>
                          {isTyping && (
                            <span className="rounded-full border border-blue-400/20 bg-blue-500/10 px-2 py-1 text-xs text-blue-200">
                              In scrittura
                            </span>
                          )}
                        </div>
                        <div className="mt-4 space-y-3">
                          {chatMessages.length === 0 && !currentTranscription ? (
                            <p className="text-sm leading-6 text-slate-400">
                              Scrivi una domanda tecnica o usa i pulsanti rapidi per iniziare la conversazione.
                            </p>
                          ) : null}
                          {chatMessages.map((message) => (
                            <div
                              key={message.id}
                              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                              <div
                                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                                  message.role === 'user'
                                    ? 'bg-cyan-500 text-slate-950'
                                    : message.role === 'system'
                                      ? 'border border-amber-400/30 bg-amber-500/10 text-amber-50'
                                      : 'border border-white/10 bg-slate-900/70 text-slate-100'
                                }`}
                              >
                                <div className="whitespace-pre-line break-words">{message.content}</div>
                                <div className={`mt-1 text-[11px] leading-none ${message.role === 'user' ? 'text-slate-900/70' : 'text-slate-400'}`}>
                                  {new Date(message.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                                  {message.role === 'user'
                                    ? (user ? ` • ${user.nome}` : '')
                                    : message.role === 'assistant'
                                      ? ' • Holo-Assistant'
                                      : ' • Sistema'}
                                </div>
                              </div>
                            </div>
                          ))}
                          {currentTranscription ? (
                            <div className="flex justify-start">
                              <div className="max-w-[85%] rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm leading-6 text-slate-100">
                                <div className="whitespace-pre-line break-words">
                                  {currentTranscription}
                                  {isTyping && <span className="animate-pulse">|</span>}
                                </div>
                              </div>
                            </div>
                          ) : null}
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
                      </div>

                    <div className="space-y-4">
                      {clarificationOptions.length > 0 && (
                        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4">
                          <h3 className="text-sm font-semibold text-amber-200">Aiutami a capire meglio</h3>
                          <div className="mt-3 grid gap-3">
                            {clarificationOptions.map((option) => (
                              <button
                                key={option.knowledge_item_id}
                                type="button"
                                onClick={() => handleClarificationSelection(option.knowledge_item_id)}
                                disabled={assistantBusy}
                                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-slate-100 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {agentCandidateOptions.length > 0 && (
                        <div className="rounded-2xl border border-cyan-400/30 bg-cyan-500/10 p-4">
                          <h3 className="text-sm font-semibold text-cyan-100">Scelta materiale</h3>
                          <div className="mt-3 grid gap-3">
                            {agentCandidateOptions.map((option) => (
                              <button
                                key={option.material_id}
                                type="button"
                                onClick={() => void handleAgentCandidateSelection(option)}
                                disabled={assistantBusy}
                                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-slate-100 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <div className="font-semibold">{option.label}</div>
                                {option.description ? (
                                  <div className="mt-1 text-xs text-slate-300">{option.description}</div>
                                ) : null}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {agentConfirmationPayload && (
                        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4">
                          <h3 className="text-sm font-semibold text-emerald-100">Conferma azione</h3>
                          <p className="mt-2 text-sm leading-6 text-emerald-50">{agentConfirmationPayload.prompt}</p>
                          <div className="mt-4 flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={() => void handleAgentConfirmation('confirm')}
                              disabled={assistantBusy}
                              className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Conferma
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleAgentConfirmation('cancel')}
                              disabled={assistantBusy}
                              className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Annulla
                            </button>
                          </div>
                        </div>
                      )}

                      {showFollowUp && (
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center">
                          <p className="text-lg font-semibold text-white">Hai risolto il problema?</p>
                          <div className="mt-4 flex flex-wrap justify-center gap-3">
                            <button
                              onClick={() => void handleFollowUpResponse('resolved')}
                              disabled={assistantBusy}
                              className="rounded-xl bg-green-500 px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Si
                            </button>
                            <button
                              onClick={() => void handleFollowUpResponse('unresolved')}
                              disabled={assistantBusy}
                              className="rounded-xl bg-red-500 px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              No
                            </button>
                            <button
                              onClick={() => void handleFollowUpResponse('not_applicable')}
                              disabled={assistantBusy}
                              className="rounded-xl bg-slate-500 px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Non rilevante
                            </button>
                          </div>
                        </div>
                      )}

                    </div>
                  </div>
                  </ScrollArea>
                </div>

                <div
                  className="shrink-0 border-t border-white/10 px-4 py-4 sm:px-5"
                  style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
                >
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
                            resetAgentInteractionState();
                            setPendingQuestion(null);
                            setFallbackReasonCode(null);
                            setTrackedActiveInteractionId(null);
                          }
                        }}
                        placeholder="Scrivi la tua domanda..."
                        disabled={assistantBusy || Boolean(pendingResolution)}
                        className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !assistantBusy && !pendingResolution) {
                            void handleQuestionSubmit();
                          }
                        }}
                      />
                      <button
                        onClick={handleQuestionSubmit}
                        disabled={assistantBusy || Boolean(pendingResolution) || !questionInput.trim()}
                        className="w-full rounded-xl bg-blue-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-600 sm:w-auto"
                      >
                        Invia
                      </button>
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
