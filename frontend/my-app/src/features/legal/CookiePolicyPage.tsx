import { ArrowLeft, Database, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';

import { Card } from '@/shared/ui/card';

const cookieRows = [
  {
    name: 'Refresh token HTTP-only',
    type: 'Cookie tecnico di autenticazione',
    purpose: 'Mantiene la sessione autenticata e consente il rinnovo del token senza richiedere un nuovo login immediato.',
    duration: 'Per la durata configurata lato backend.',
  },
  {
    name: 'Stato sidebar',
    type: 'Cookie tecnico di preferenza',
    purpose: 'Ricorda l’apertura o chiusura della sidebar dell’interfaccia quando il componente viene usato.',
    duration: 'Fino alla scadenza tecnica impostata nel frontend.',
  },
];

const localStorageRows = [
  {
    name: 'Sessione applicativa',
    keys: 'user, workingStation, assignedMachine, chatSessionId, expiresIn, loginTimestamp, isAdmin',
    purpose: 'Ripristina il contesto locale della sessione tra refresh della pagina.',
  },
  {
    name: 'Preferenze postazione operatore',
    keys: 'holo-assistant.operator-display-preferences',
    purpose: 'Salva opzioni locali come ologramma, wakeword e grafica legacy forzata.',
  },
  {
    name: 'Diagnostica manuale',
    keys: 'holo-assistant.debugVosk',
    purpose: 'Abilita log diagnostici locali della wakeword solo se impostato manualmente.',
  },
];

export function CookiePolicyPage() {
  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Torna all’applicazione
        </Link>

        <Card className="border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
                <ShieldCheck className="h-4 w-4" />
                Informativa cookie e tecnologie locali
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                Uso di cookie, localStorage e strumenti tecnici
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 sm:text-base">
                Questa applicazione utilizza solo strumenti tecnici necessari al funzionamento del login, delle sessioni
                e delle preferenze locali dell’interfaccia. Alla data del 12 aprile 2026 non risultano attivi cookie o
                tecnologie di tracciamento per finalita di marketing, profilazione o analytics di terze parti.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <p className="font-semibold text-slate-900">Base operativa</p>
              <p className="mt-1">Informativa tecnica destinata agli utenti dell’applicazione Holo-Assistant.</p>
            </div>
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 text-slate-900">
              <LockKeyhole className="h-5 w-5 text-sky-600" />
              <h2 className="text-xl font-semibold">Cosa viene usato</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              I dati vengono salvati solo per garantire autenticazione, continuita della sessione e preferenze tecniche
              dell’interfaccia.
            </p>

            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">Cookie tecnici</p>
                <div className="mt-3 space-y-3">
                  {cookieRows.map((row) => (
                    <div key={row.name} className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-medium text-slate-900">{row.name}</p>
                        <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-700">
                          {row.type}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{row.purpose}</p>
                      <p className="mt-2 text-xs text-slate-500">Durata: {row.duration}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">Storage locale del browser</p>
                <div className="mt-3 space-y-3">
                  {localStorageRows.map((row) => (
                    <div key={row.name} className="rounded-xl border border-slate-200 bg-white p-4">
                      <p className="font-medium text-slate-900">{row.name}</p>
                      <p className="mt-2 text-xs break-all text-slate-500">{row.keys}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{row.purpose}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <div className="space-y-4">
            <Card className="border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-slate-900">
                <Database className="h-5 w-5 text-emerald-600" />
                <h2 className="text-xl font-semibold">Cosa non viene usato</h2>
              </div>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                <li>Non risultano attivi cookie di profilazione.</li>
                <li>Non risultano attivi strumenti pubblicitari o remarketing.</li>
                <li>Non risultano attivi analytics di terze parti nel frontend esaminato.</li>
                <li>Non risultano attivi pixel marketing, heatmap o session replay.</li>
              </ul>
            </Card>

            <Card className="border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">Quando servirebbe un banner</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Un banner di consenso diventerebbe normalmente necessario se in futuro venissero introdotti strumenti non
                tecnici, ad esempio analytics non anonimizzati, pixel pubblicitari, profilazione o tecnologie di tracciamento
                analoghe.
              </p>
            </Card>

            <Card className="border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900">Diritti e contatti</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Per informazioni sul trattamento dei dati personali, sui tempi di conservazione e sull’esercizio dei diritti
                previsti dal GDPR, consulta anche l’informativa privacy generale del progetto o il referente privacy del
                titolare del trattamento.
              </p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
