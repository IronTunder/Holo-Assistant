import { useState } from 'react';
import {
  ArrowLeft,
  AudioLines,
  Database,
  HardDriveDownload,
  LockKeyhole,
  LogOut,
  Mic,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';

import {
  DEFAULT_OPERATOR_DISPLAY_PREFERENCES,
  OPERATOR_DISPLAY_PREFERENCES_KEY,
  applyLegacyGraphicsPreference,
} from '@/features/operator/operatorDisplayPreferences';
import { useAuth } from '@/shared/auth/AuthContext';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';

const SIDEBAR_COOKIE_NAME = 'sidebar_state';

const SESSION_STORAGE_KEYS = [
  'accessToken',
  'user',
  'workingStation',
  'assignedMachine',
  'chatSessionId',
  'expiresIn',
  'loginTimestamp',
  'isAdmin',
  'refreshToken',
] as const;

const PREFERENCE_STORAGE_KEYS = [
  OPERATOR_DISPLAY_PREFERENCES_KEY,
  'holo-assistant.debugVosk',
] as const;

const cookieRows = [
  {
    name: 'Refresh token HTTP-only',
    type: 'Cookie tecnico di autenticazione',
    purpose:
      'Supporta login, refresh della sessione e continuita di accesso senza esporre il token al JavaScript della pagina.',
    scope: 'Impostato dal backend sulle richieste di login e refresh.',
    duration: 'Per la durata configurata lato backend.',
  },
  {
    name: 'sidebar_state',
    type: 'Cookie tecnico di preferenza',
    purpose:
      'Ricorda apertura o chiusura della sidebar quando viene usata l interfaccia con navigazione laterale.',
    scope: 'Creato dal frontend solo quando il componente sidebar e presente.',
    duration: '7 giorni.',
  },
] as const;

const localStorageRows = [
  {
    name: 'Snapshot sessione applicativa',
    keys: 'user, workingStation, assignedMachine, chatSessionId, expiresIn, loginTimestamp, isAdmin',
    purpose:
      'Ripristina il contesto locale della sessione dopo un refresh della pagina, fino a nuova verifica col backend.',
  },
  {
    name: 'Preferenze postazione operatore',
    keys: OPERATOR_DISPLAY_PREFERENCES_KEY,
    purpose:
      'Conserva impostazioni locali della UI operatore come wake word, ologramma e grafica legacy forzata.',
  },
  {
    name: 'Diagnostica manuale',
    keys: 'holo-assistant.debugVosk',
    purpose: 'Abilita log tecnici locali per il riconoscimento vocale solo se richiesto manualmente.',
  },
] as const;

const technologyRows = [
  {
    name: 'Permesso microfono',
    icon: Mic,
    description:
      'Viene richiesto solo se la wake word vocale e attivata. Senza consenso del browser la funzione resta disabilitata.',
  },
  {
    name: 'Wake word Vosk nel browser',
    icon: AudioLines,
    description:
      'Il riconoscimento iniziale della parola chiave viene eseguito nel client con asset locali dell applicazione. Il flusso audio non viene usato per marketing o profilazione.',
  },
  {
    name: 'Chiamate API, SSE e TTS',
    icon: HardDriveDownload,
    description:
      'Il frontend dialoga con il backend per autenticazione, stato sessione, richieste operative e riproduzione audio di risposta.',
  },
] as const;

function clearBrowserCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0`;
  document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function removeStorageKeys(keys: readonly string[]) {
  keys.forEach((key) => window.localStorage.removeItem(key));
}

export function CookiePolicyPage() {
  const { isAdmin, isLoggedIn, logout } = useAuth();
  const [isClearingPreferences, setIsClearingPreferences] = useState(false);
  const [isClearingSessionSnapshot, setIsClearingSessionSnapshot] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleClearPreferences = () => {
    setIsClearingPreferences(true);

    try {
      removeStorageKeys(PREFERENCE_STORAGE_KEYS);
      clearBrowserCookie(SIDEBAR_COOKIE_NAME);
      applyLegacyGraphicsPreference(DEFAULT_OPERATOR_DISPLAY_PREFERENCES.forceLegacyGraphics);
      toast.success('Preferenze locali e cookie tecnico della sidebar rimossi.');
    } catch (error) {
      console.error('Errore durante la pulizia delle preferenze locali:', error);
      toast.error('Non sono riuscito a cancellare le preferenze locali.');
    } finally {
      setIsClearingPreferences(false);
    }
  };

  const handleClearSessionSnapshot = () => {
    setIsClearingSessionSnapshot(true);

    try {
      removeStorageKeys(SESSION_STORAGE_KEYS);
      toast.success('Dati di sessione locali rimossi dal browser.');
    } catch (error) {
      console.error('Errore durante la pulizia della sessione locale:', error);
      toast.error('Non sono riuscito a cancellare i dati di sessione locali.');
    } finally {
      setIsClearingSessionSnapshot(false);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);

    try {
      await logout();
      toast.success('Sessione terminata e dati locali rimossi.');
    } catch (error) {
      console.error('Errore durante il logout dalla pagina legale:', error);
      toast.error('Logout non riuscito.');
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_35%,#f8fafc_100%)] px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <Link
          to={isLoggedIn ? (isAdmin ? '/admin' : '/') : '/'}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Torna all applicazione
        </Link>

        <Card className="overflow-hidden border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
                <ShieldCheck className="h-4 w-4" />
                Cookie, tecnologie utilizzate e privacy
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                Informativa tecnica e gestione locale dei dati browser
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
                Holo-Assistant usa strumenti tecnici per autenticazione, continuita di sessione, preferenze di interfaccia,
                funzioni vocali opzionali e collegamento sicuro al backend. Alla data del 13 aprile 2026 non risultano
                attivi cookie o tecnologie frontend per marketing, profilazione o analytics di terze parti.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:w-[26rem] lg:grid-cols-1">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <p className="font-semibold text-slate-900">Solo uso tecnico</p>
                <p className="mt-1">Cookie e storage servono a login, preferenze e operativita locale.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <p className="font-semibold text-slate-900">Nessun tracciamento marketing</p>
                <p className="mt-1">Nessun pixel, remarketing, heatmap o profilazione frontend attiva.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <p className="font-semibold text-slate-900">Controlli lato utente</p>
                <p className="mt-1">Puoi rimuovere preferenze locali e dati browser direttamente da questa pagina.</p>
              </div>
            </div>
          </div>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <Card className="border-slate-200 bg-white/90 p-6 shadow-sm">
              <div className="flex items-center gap-2 text-slate-900">
                <LockKeyhole className="h-5 w-5 text-sky-600" />
                <h2 className="text-xl font-semibold">Cookie tecnici realmente usati</h2>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                I cookie presenti nel frontend sono limitati a sessione autenticata e preferenze strettamente funzionali.
              </p>

              <div className="mt-5 space-y-3">
                {cookieRows.map((row) => (
                  <div key={row.name} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-medium text-slate-900">{row.name}</p>
                      <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-700">
                        {row.type}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{row.purpose}</p>
                    <p className="mt-2 text-xs text-slate-500">Ambito: {row.scope}</p>
                    <p className="mt-1 text-xs text-slate-500">Durata: {row.duration}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="border-slate-200 bg-white/90 p-6 shadow-sm">
              <div className="flex items-center gap-2 text-slate-900">
                <Database className="h-5 w-5 text-emerald-600" />
                <h2 className="text-xl font-semibold">Storage locale e preferenze tecniche</h2>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Il browser conserva alcuni dati locali per ripristinare sessione, contesto operatore e impostazioni della UI.
              </p>

              <div className="mt-5 space-y-3">
                {localStorageRows.map((row) => (
                  <div key={row.name} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="font-medium text-slate-900">{row.name}</p>
                    <p className="mt-2 break-all text-xs text-slate-500">{row.keys}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{row.purpose}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="border-slate-200 bg-white/90 p-6 shadow-sm">
              <div className="flex items-center gap-2 text-slate-900">
                <Mic className="h-5 w-5 text-fuchsia-600" />
                <h2 className="text-xl font-semibold">Tecnologie locali aggiuntive e impatto privacy</h2>
              </div>
              <div className="mt-4 space-y-3">
                {technologyRows.map((row) => {
                  const Icon = row.icon;
                  return (
                    <div key={row.name} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700">
                          <Icon className="h-5 w-5" />
                        </div>
                        <p className="font-medium text-slate-900">{row.name}</p>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-600">{row.description}</p>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="border-slate-200 bg-white/90 p-6 shadow-sm">
              <div className="flex items-center gap-2 text-slate-900">
                <ShieldOff className="h-5 w-5 text-amber-600" />
                <h2 className="text-xl font-semibold">Cosa non viene usato</h2>
              </div>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                <li>Non risultano attivi cookie di profilazione.</li>
                <li>Non risultano attivi strumenti pubblicitari o remarketing.</li>
                <li>Non risultano attivi analytics di terze parti nel frontend esaminato.</li>
                <li>Non risultano attivi pixel marketing, heatmap o session replay.</li>
              </ul>
            </Card>

            <Card className="border-slate-200 bg-white/90 p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">Sintesi privacy</h2>
              <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                <p>
                  Nell assetto attuale i dati trattati lato browser riguardano soprattutto identificazione utente, ruolo,
                  postazione, macchina associata, stato della sessione e preferenze tecniche dell interfaccia.
                </p>
                <p>
                  Se usi le funzioni vocali, il browser chiede il permesso microfono. Il riconoscimento iniziale della wake
                  word avviene localmente; quando invii una domanda o un comando, il testo risultante puo essere usato come
                  input operativo verso il backend.
                </p>
                <p>
                  Il titolare del trattamento, i tempi di conservazione completi e i canali per esercitare i diritti GDPR
                  dipendono dalla tua organizzazione o dall installazione che gestisce Holo-Assistant.
                </p>
              </div>
            </Card>

            <Card className="border-slate-200 bg-white/90 p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">Quando servirebbe un banner consenso</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Un banner esplicito diventerebbe normalmente necessario se venissero introdotti strumenti non tecnici, come
                analytics non anonimizzati, tracciamento cross-site, pixel pubblicitari o moduli di profilazione.
              </p>
            </Card>

            <Card className="border-slate-200 bg-white/90 p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">Gestisci cookie e privacy locale</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Qui puoi cancellare cio che il frontend controlla direttamente. Il cookie HTTP-only di autenticazione non e
                leggibile da JavaScript e viene rimosso correttamente con il logout.
              </p>

              <div className="mt-5 space-y-3">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={handleClearPreferences}
                  disabled={isClearingPreferences}
                >
                  <Trash2 className="h-4 w-4" />
                  {isClearingPreferences ? 'Pulizia preferenze in corso...' : 'Cancella preferenze locali e cookie sidebar'}
                </Button>

                {isLoggedIn ? (
                  <Button
                    type="button"
                    className="w-full justify-start gap-2 bg-slate-900 text-white hover:bg-slate-800"
                    onClick={() => void handleLogout()}
                    disabled={isLoggingOut}
                  >
                    <LogOut className="h-4 w-4" />
                    {isLoggingOut ? 'Logout in corso...' : 'Esci e termina la sessione attiva'}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start gap-2"
                    onClick={handleClearSessionSnapshot}
                    disabled={isClearingSessionSnapshot}
                  >
                    <Trash2 className="h-4 w-4" />
                    {isClearingSessionSnapshot
                      ? 'Pulizia sessione locale in corso...'
                      : 'Cancella eventuali dati di sessione salvati nel browser'}
                  </Button>
                )}
              </div>

              <p className="mt-4 text-xs leading-5 text-slate-500">
                Dopo la pulizia delle preferenze, alcune opzioni dell interfaccia tornano ai valori predefiniti. Se sei gia
                autenticato, usa il logout per invalidare anche la sessione gestita dal backend.
              </p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
