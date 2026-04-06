import { useCallback, useEffect, useMemo, useState } from 'react';

import API_ENDPOINTS, { API_BASE_URL } from '@/shared/api/config';
import { useApiClient } from '@/shared/api/apiClient';
import { useAuth } from '@/shared/auth/AuthContext';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Activity, CheckCircle2, Info, RefreshCw, Server, ShieldCheck, Volume2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

interface TtsHealthResponse {
  enabled: boolean;
  ready: boolean;
  voice_models_dir: string;
  voice_manifest_path: string;
  default_voice_key: string;
  default_language: string;
  preferred_qualities: string[];
  available_models: string[];
  available_languages: string[];
}

const formatDateTime = (timestamp: string | null) => {
  if (!timestamp) {
    return 'Non disponibile';
  }

  const parsedTimestamp = Number(timestamp);
  if (!Number.isFinite(parsedTimestamp)) {
    return 'Non disponibile';
  }

  return new Date(parsedTimestamp).toLocaleString('it-IT');
};

const formatSeconds = (seconds: number | null) => {
  if (!seconds) {
    return 'Non disponibile';
  }

  if (seconds < 60) {
    return `${seconds} secondi`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes} min ${remainingSeconds} sec` : `${minutes} minuti`;
};

const getEndpointPath = (endpoint: string) => endpoint.replace(API_BASE_URL, '');

const getTtsBadge = (ttsHealth: TtsHealthResponse | null, hasError: boolean) => {
  if (hasError) {
    return {
      label: 'Non raggiungibile',
      className: 'border-red-200 bg-red-50 text-red-700',
      Icon: XCircle,
    };
  }

  if (!ttsHealth) {
    return {
      label: 'In caricamento',
      className: 'border-slate-200 bg-slate-50 text-slate-600',
      Icon: Activity,
    };
  }

  if (ttsHealth.ready) {
    return {
      label: 'Pronto',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      Icon: CheckCircle2,
    };
  }

  return {
    label: ttsHealth.enabled ? 'Non pronto' : 'Disabilitato',
    className: 'border-amber-200 bg-amber-50 text-amber-700',
    Icon: Info,
  };
};

export const SettingsPanel = () => {
  const { apiCall } = useApiClient();
  const { expiresIn, isAdmin, isLoggedIn, user } = useAuth();
  const [ttsHealth, setTtsHealth] = useState<TtsHealthResponse | null>(null);
  const [isLoadingTtsHealth, setIsLoadingTtsHealth] = useState(true);
  const [ttsHealthError, setTtsHealthError] = useState<string | null>(null);

  const loginTimestamp = useMemo(() => localStorage.getItem('loginTimestamp'), []);

  const loadTtsHealth = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setIsLoadingTtsHealth(true);
    }
    setTtsHealthError(null);

    try {
      const response = await apiCall(API_ENDPOINTS.TTS_HEALTH);
      if (!response.ok) {
        throw new Error(`Stato TTS non disponibile (${response.status})`);
      }

      setTtsHealth((await response.json()) as TtsHealthResponse);
      if (silent) {
        toast.success('Stato TTS aggiornato');
      }
    } catch (error) {
      console.error(error);
      setTtsHealth(null);
      setTtsHealthError(error instanceof Error ? error.message : 'Stato TTS non disponibile');
      if (silent) {
        toast.error('Impossibile aggiornare lo stato TTS');
      }
    } finally {
      setIsLoadingTtsHealth(false);
    }
  }, [apiCall]);

  useEffect(() => {
    void loadTtsHealth();
  }, [loadTtsHealth]);

  const ttsBadge = getTtsBadge(ttsHealth, Boolean(ttsHealthError));
  const TtsBadgeIcon = ttsBadge.Icon;
  const runtimeRows = [
    { label: 'Server backend', value: API_BASE_URL },
    { label: 'Ambiente', value: import.meta.env.DEV ? 'Development' : 'Production' },
    { label: 'Origine frontend', value: window.location.origin },
    { label: 'URL TTS health', value: getEndpointPath(API_ENDPOINTS.TTS_HEALTH) },
  ];

  const endpointGroups = [
    { label: 'Autenticazione', value: getEndpointPath(API_ENDPOINTS.AUTH_ME) },
    { label: 'Panoramica admin', value: getEndpointPath(API_ENDPOINTS.ADMIN_DASHBOARD_SUMMARY) },
    { label: 'Stream macchinari', value: getEndpointPath(API_ENDPOINTS.ADMIN_MACHINE_EVENTS) },
    { label: 'Log audit', value: getEndpointPath(API_ENDPOINTS.LIST_LOGS) },
    { label: 'Sintesi vocale', value: getEndpointPath(API_ENDPOINTS.TTS_SYNTHESIZE) },
  ];

  return (
    <div className="space-y-6">
      <Alert className="border-sky-200 bg-sky-50 text-sky-900">
        <Info className="h-4 w-4" />
        <AlertTitle>Diagnostica read-only</AlertTitle>
        <AlertDescription>
          Questa sezione espone lo stato del sistema senza modificare configurazioni, database o preferenze locali.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-slate-900">
                <Volume2 className="h-5 w-5 text-sky-600" />
                <h3 className="text-lg font-semibold">Sintesi vocale</h3>
              </div>
              <p className="text-sm text-slate-500">Stato runtime del servizio Piper TTS usato dall avatar.</p>
            </div>
            <Badge variant="outline" className={`gap-1.5 ${ttsBadge.className}`}>
              <TtsBadgeIcon className="h-3.5 w-3.5" />
              {ttsBadge.label}
            </Badge>
          </div>

          {ttsHealthError ? (
            <Alert variant="destructive" className="mt-4">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Servizio TTS non raggiungibile</AlertTitle>
              <AlertDescription>{ttsHealthError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Abilitato</p>
              <p className="mt-1 font-medium text-slate-900">
                {isLoadingTtsHealth && !ttsHealth ? 'Caricamento...' : ttsHealth?.enabled ? 'Si' : 'No'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Voce default</p>
              <p className="mt-1 break-words font-medium text-slate-900">
                {isLoadingTtsHealth && !ttsHealth ? 'Caricamento...' : ttsHealth?.default_voice_key || '-'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Lingua default</p>
              <p className="mt-1 font-medium text-slate-900">{ttsHealth?.default_language || '-'}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Modelli disponibili</p>
              <p className="mt-1 font-medium text-slate-900">{ttsHealth?.available_models.length ?? '-'}</p>
            </div>
          </div>

          <div className="mt-4 space-y-3 rounded-lg border border-slate-200 p-4 text-sm">
            <div>
              <p className="font-medium text-slate-900">Lingue disponibili</p>
              <p className="mt-1 text-slate-600">
                {ttsHealth?.available_languages.length ? ttsHealth.available_languages.join(', ') : 'Nessuna lingua rilevata'}
              </p>
            </div>
            <div>
              <p className="font-medium text-slate-900">Qualita preferite</p>
              <p className="mt-1 text-slate-600">
                {ttsHealth?.preferred_qualities.length ? ttsHealth.preferred_qualities.join(', ') : 'Non disponibile'}
              </p>
            </div>
            <div>
              <p className="font-medium text-slate-900">Repository modelli</p>
              <p className="mt-1 break-all text-slate-600">{ttsHealth?.voice_models_dir || 'Non disponibile'}</p>
            </div>
            <div>
              <p className="font-medium text-slate-900">Manifest voci</p>
              <p className="mt-1 break-all text-slate-600">{ttsHealth?.voice_manifest_path || 'Non disponibile'}</p>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              disabled={isLoadingTtsHealth}
              onClick={() => void loadTtsHealth({ silent: true })}
            >
              <RefreshCw className={`h-4 w-4 ${isLoadingTtsHealth ? 'animate-spin' : ''}`} />
              {isLoadingTtsHealth ? 'Aggiornamento...' : 'Aggiorna stato'}
            </Button>
          </div>
        </Card>

        <Card className="border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-slate-900">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            <h3 className="text-lg font-semibold">Sessione admin</h3>
          </div>
          <p className="text-sm text-slate-500">Riepilogo locale senza token o credenziali.</p>

          <div className="mt-5 space-y-3">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Utente</p>
              <p className="mt-1 font-medium text-slate-900">{user?.nome || 'Amministratore'}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Ruolo</p>
                <p className="mt-1 font-medium text-slate-900">{isAdmin ? 'Admin' : 'Non admin'}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Stato sessione</p>
                <p className="mt-1 font-medium text-slate-900">{isLoggedIn ? 'Attiva' : 'Non attiva'}</p>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Login locale</p>
              <p className="mt-1 font-medium text-slate-900">{formatDateTime(loginTimestamp)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Durata access token</p>
              <p className="mt-1 font-medium text-slate-900">{formatSeconds(expiresIn)}</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-slate-900">
            <Server className="h-5 w-5 text-sky-600" />
            <h3 className="text-lg font-semibold">Runtime frontend</h3>
          </div>
          <div className="mt-4 space-y-3">
            {runtimeRows.map((row) => (
              <div key={row.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">{row.label}</p>
                <p className="mt-1 break-all text-sm font-medium text-slate-900">{row.value}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-slate-900">
            <Activity className="h-5 w-5 text-sky-600" />
            <h3 className="text-lg font-semibold">Endpoint monitorati</h3>
          </div>
          <p className="text-sm text-slate-500">Riferimenti usati dall interfaccia admin e dalla console operatore.</p>
          <div className="mt-4 space-y-3">
            {endpointGroups.map((endpoint) => (
              <div key={endpoint.label} className="flex flex-col gap-1 rounded-lg border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-medium text-slate-900">{endpoint.label}</p>
                <p className="break-all text-sm text-slate-500">{endpoint.value}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};
