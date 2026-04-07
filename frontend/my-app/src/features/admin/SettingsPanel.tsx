import { useCallback, useEffect, useMemo, useState } from 'react';

import API_ENDPOINTS, { API_BASE_URL } from '@/shared/api/config';
import { useApiClient } from '@/shared/api/apiClient';
import { useAuth } from '@/shared/auth/AuthContext';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Switch } from '@/shared/ui/switch';
import { Textarea } from '@/shared/ui/textarea';
import { Activity, CheckCircle2, Info, RefreshCw, Save, Server, ShieldCheck, Volume2, XCircle } from 'lucide-react';
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

type SettingValueType = 'string' | 'integer' | 'number' | 'boolean' | 'csv' | 'url' | 'enum';

interface AdminSetting {
  key: string;
  label: string;
  description: string;
  value: string;
  has_value: boolean;
  value_type: SettingValueType;
  required: boolean;
  requires_restart: boolean;
  sensitive: boolean;
  min_value?: number | null;
  max_value?: number | null;
  options: string[];
}

interface AdminSettingsGroup {
  name: string;
  settings: AdminSetting[];
}

interface AdminSettingsResponse {
  groups: AdminSettingsGroup[];
  pending_restart: boolean;
  requires_restart: boolean;
}

interface SettingsPanelProps {
  canEdit: boolean;
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

const validateSettingValue = (setting: AdminSetting, value: string) => {
  const trimmedValue = value.trim();
  if (setting.sensitive && !trimmedValue) {
    return null;
  }
  if (setting.required && !trimmedValue) {
    return 'Valore obbligatorio';
  }
  if (trimmedValue.includes('\n') || trimmedValue.includes('\r')) {
    return 'Il valore non puo contenere nuove righe';
  }
  if (setting.value_type === 'integer') {
    const parsedValue = Number(trimmedValue);
    if (!Number.isInteger(parsedValue)) {
      return 'Inserisci un numero intero';
    }
    if (setting.min_value != null && parsedValue < setting.min_value) {
      return `Valore minimo: ${setting.min_value}`;
    }
    if (setting.max_value != null && parsedValue > setting.max_value) {
      return `Valore massimo: ${setting.max_value}`;
    }
  }
  if (setting.value_type === 'number') {
    const parsedValue = Number(trimmedValue);
    if (!Number.isFinite(parsedValue)) {
      return 'Inserisci un numero';
    }
    if (setting.min_value != null && parsedValue < setting.min_value) {
      return `Valore minimo: ${setting.min_value}`;
    }
    if (setting.max_value != null && parsedValue > setting.max_value) {
      return `Valore massimo: ${setting.max_value}`;
    }
  }
  if (setting.value_type === 'url') {
    try {
      const parsedUrl = new URL(trimmedValue);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return 'Inserisci un URL http/https valido';
      }
    } catch {
      return 'Inserisci un URL valido';
    }
  }
  if (setting.key === 'ALLOWED_ORIGINS' && trimmedValue) {
    const invalidOrigin = trimmedValue.split(',').some((origin) => {
      try {
        const parsedUrl = new URL(origin.trim());
        return !['http:', 'https:'].includes(parsedUrl.protocol);
      } catch {
        return true;
      }
    });
    if (invalidOrigin) {
      return 'Usa URL http/https separati da virgola';
    }
  }
  return null;
};

export const SettingsPanel = ({ canEdit }: SettingsPanelProps) => {
  const { apiCall } = useApiClient();
  const { expiresIn, isAdmin, isLoggedIn, user } = useAuth();
  const [ttsHealth, setTtsHealth] = useState<TtsHealthResponse | null>(null);
  const [isLoadingTtsHealth, setIsLoadingTtsHealth] = useState(true);
  const [ttsHealthError, setTtsHealthError] = useState<string | null>(null);
  const [settingsGroups, setSettingsGroups] = useState<AdminSettingsGroup[]>([]);
  const [settingsValues, setSettingsValues] = useState<Record<string, string>>({});
  const [settingsErrors, setSettingsErrors] = useState<Record<string, string>>({});
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [pendingRestart, setPendingRestart] = useState(false);

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

  const loadSettings = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setIsLoadingSettings(true);
    }
    try {
      const response = await apiCall(API_ENDPOINTS.ADMIN_SETTINGS);
      if (!response.ok) {
        throw new Error(`Impostazioni non disponibili (${response.status})`);
      }

      const payload = (await response.json()) as AdminSettingsResponse;
      const nextValues: Record<string, string> = {};
      payload.groups.forEach((group) => {
        group.settings.forEach((setting) => {
          nextValues[setting.key] = setting.value ?? '';
        });
      });
      setSettingsGroups(payload.groups);
      setSettingsValues(nextValues);
      setSettingsErrors({});
      setPendingRestart(payload.pending_restart);
      if (silent) {
        toast.success('Impostazioni aggiornate');
      }
    } catch (error) {
      console.error(error);
      toast.error('Errore nel caricamento impostazioni');
    } finally {
      setIsLoadingSettings(false);
    }
  }, [apiCall]);

  useEffect(() => {
    void loadTtsHealth();
    void loadSettings();
  }, [loadSettings, loadTtsHealth]);

  const settingByKey = useMemo(() => {
    const result = new Map<string, AdminSetting>();
    settingsGroups.forEach((group) => group.settings.forEach((setting) => result.set(setting.key, setting)));
    return result;
  }, [settingsGroups]);

  const hasChanges = useMemo(
    () => settingsGroups.some((group) => group.settings.some((setting) => settingsValues[setting.key] !== setting.value)),
    [settingsGroups, settingsValues]
  );

  const updateSettingValue = (setting: AdminSetting, value: string) => {
    setSettingsValues((currentValues) => ({ ...currentValues, [setting.key]: value }));
    const error = validateSettingValue(setting, value);
    setSettingsErrors((currentErrors) => {
      const nextErrors = { ...currentErrors };
      if (error) {
        nextErrors[setting.key] = error;
      } else {
        delete nextErrors[setting.key];
      }
      return nextErrors;
    });
  };

  const handleSaveSettings = async () => {
    const nextErrors: Record<string, string> = {};
    settingsGroups.forEach((group) => {
      group.settings.forEach((setting) => {
        const error = validateSettingValue(setting, settingsValues[setting.key] ?? '');
        if (error) {
          nextErrors[setting.key] = error;
        }
      });
    });
    setSettingsErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error('Correggi i valori non validi');
      return;
    }

    const changedSettings: Record<string, string> = {};
    settingsGroups.forEach((group) => {
      group.settings.forEach((setting) => {
        const value = settingsValues[setting.key] ?? '';
        if (value !== setting.value) {
          changedSettings[setting.key] = value;
        }
      });
    });
    if (Object.keys(changedSettings).length === 0) {
      return;
    }

    setIsSavingSettings(true);
    try {
      const response = await apiCall(API_ENDPOINTS.ADMIN_SETTINGS, {
        method: 'PUT',
        body: JSON.stringify({ settings: changedSettings }),
      });
      const payload = await response.json();
      if (!response.ok) {
        const backendErrors = payload?.detail?.errors;
        if (backendErrors && typeof backendErrors === 'object') {
          setSettingsErrors(backendErrors as Record<string, string>);
        }
        throw new Error(payload?.detail?.message || 'Errore nel salvataggio impostazioni');
      }

      const settingsPayload = payload as AdminSettingsResponse;
      const nextValues: Record<string, string> = {};
      settingsPayload.groups.forEach((group) => {
        group.settings.forEach((setting) => {
          nextValues[setting.key] = setting.value ?? '';
        });
      });
      setSettingsGroups(settingsPayload.groups);
      setSettingsValues(nextValues);
      setSettingsErrors({});
      setPendingRestart(settingsPayload.pending_restart);
      toast.success('Impostazioni salvate. Riavvia il backend per applicarle.');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Errore nel salvataggio impostazioni');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const renderSettingControl = (setting: AdminSetting) => {
    const value = settingsValues[setting.key] ?? '';
    const disabled = !canEdit || isSavingSettings;

    if (setting.value_type === 'boolean') {
      return (
        <div className="flex items-center gap-3">
          <Switch
            checked={value === 'true'}
            disabled={disabled}
            onCheckedChange={(checked) => updateSettingValue(setting, checked ? 'true' : 'false')}
          />
          <span className="text-sm font-medium text-slate-700">{value === 'true' ? 'Attivo' : 'Disattivo'}</span>
        </div>
      );
    }

    if (setting.value_type === 'enum') {
      return (
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => updateSettingValue(setting, event.target.value)}
          className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          {setting.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }

    if (setting.key === 'ALLOWED_ORIGINS' || setting.value_type === 'csv') {
      return (
        <Textarea
          value={value}
          disabled={disabled}
          onChange={(event) => updateSettingValue(setting, event.target.value)}
          rows={2}
          placeholder="valore1,valore2"
        />
      );
    }

    return (
      <Input
        value={value}
        type={
          setting.sensitive
            ? 'password'
            : setting.value_type === 'integer' || setting.value_type === 'number'
              ? 'number'
              : 'text'
        }
        min={setting.min_value ?? undefined}
        max={setting.max_value ?? undefined}
        step={setting.value_type === 'number' ? 'any' : undefined}
        disabled={disabled}
        placeholder={setting.sensitive && setting.has_value ? 'Valore gia configurato' : undefined}
        onChange={(event) => updateSettingValue(setting, event.target.value)}
      />
    );
  };

  const ttsBadge = getTtsBadge(ttsHealth, Boolean(ttsHealthError));
  const TtsBadgeIcon = ttsBadge.Icon;
  const runtimeRows = [
    { label: 'Server backend', value: API_BASE_URL },
    { label: 'Ambiente', value: import.meta.env.DEV ? 'Development' : 'Production' },
    { label: 'Origine frontend', value: window.location.origin },
    { label: 'URL settings', value: getEndpointPath(API_ENDPOINTS.ADMIN_SETTINGS) },
    { label: 'URL TTS health', value: getEndpointPath(API_ENDPOINTS.TTS_HEALTH) },
  ];

  return (
    <div className="space-y-6">
      <Alert className="border-amber-200 bg-amber-50 text-amber-900">
        <Info className="h-4 w-4" />
        <AlertTitle>Riavvio necessario</AlertTitle>
        <AlertDescription>
          Le impostazioni salvate aggiornano backend/.env e vengono applicate al prossimo riavvio del backend o dello stack.
        </AlertDescription>
      </Alert>

      {!canEdit ? (
        <Alert className="border-slate-200 bg-slate-50 text-slate-700">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Sola lettura</AlertTitle>
          <AlertDescription>Il tuo ruolo puo consultare le impostazioni, ma non modificarle.</AlertDescription>
        </Alert>
      ) : null}

      {pendingRestart ? (
        <Alert className="border-sky-200 bg-sky-50 text-sky-900">
          <RefreshCw className="h-4 w-4" />
          <AlertTitle>Modifiche in attesa</AlertTitle>
          <AlertDescription>Le ultime modifiche sono state salvate. Riavvia il backend per renderle operative.</AlertDescription>
        </Alert>
      ) : null}

      <Card className="border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-slate-900">
              <Server className="h-5 w-5 text-sky-600" />
              <h3 className="text-lg font-semibold">Configurazione ambiente</h3>
            </div>
            <p className="text-sm text-slate-500">Configura le impostazioni dell'ambiente di esecuzione.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              disabled={isLoadingSettings || isSavingSettings}
              onClick={() => void loadSettings({ silent: true })}
            >
              <RefreshCw className={`h-4 w-4 ${isLoadingSettings ? 'animate-spin' : ''}`} />
              Aggiorna
            </Button>
            {canEdit ? (
              <Button
                type="button"
                className="gap-2"
                disabled={!hasChanges || isSavingSettings || Object.keys(settingsErrors).length > 0}
                onClick={() => void handleSaveSettings()}
              >
                <Save className="h-4 w-4" />
                {isSavingSettings ? 'Salvataggio...' : 'Salva modifiche'}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-5 space-y-5">
          {isLoadingSettings ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              Caricamento impostazioni...
            </div>
          ) : settingsGroups.map((group) => (
            <section key={group.name} className="rounded-lg border border-slate-200 p-4">
              <h4 className="font-semibold text-slate-900">{group.name}</h4>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {group.settings.map((setting) => (
                  <div key={setting.key} className="space-y-2 rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <label className="text-sm font-medium text-slate-900">{setting.label}</label>
                        <p className="text-xs text-slate-500">{setting.key}</p>
                      </div>
                      {setting.requires_restart ? <Badge variant="outline">Riavvio</Badge> : null}
                    </div>
                    <p className="text-xs text-slate-500">{setting.description}</p>
                    {renderSettingControl(setting)}
                    {settingsErrors[setting.key] ? (
                      <p className="text-xs font-medium text-red-600">{settingsErrors[setting.key]}</p>
                    ) : null}
                    {setting.sensitive && setting.has_value && !settingsValues[setting.key] ? (
                      <p className="text-xs text-slate-500">Valore gia configurato e non mostrato.</p>
                    ) : null}
                    {settingByKey.get(setting.key)?.value !== settingsValues[setting.key] ? (
                      <p className="text-xs text-amber-700">Modifica non salvata</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </Card>

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

      <Card className="border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-slate-900">
          <Server className="h-5 w-5 text-sky-600" />
          <h3 className="text-lg font-semibold">Runtime frontend</h3>
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {runtimeRows.map((row) => (
            <div key={row.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">{row.label}</p>
              <p className="mt-1 break-all text-sm font-medium text-slate-900">{row.value}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
