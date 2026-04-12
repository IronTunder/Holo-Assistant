# Security Policy

## Supported Versions

Questo repository non mantiene piu linee di rilascio parallele come `5.1.x` o `4.0.x`.
Al momento il supporto di sicurezza e limitato alla versione corrente del branch `main`.

| Versione | Supporto sicurezza |
| ------- | ------------------ |
| `main` | Sì |
| release, tag o fork precedenti | No |
| copie modificate distribuite fuori dal repository ufficiale | No |

In pratica:

- le correzioni di sicurezza vengono preparate partendo dallo stato corrente del repository ufficiale;
- non garantiamo backport verso revisioni vecchie, snapshot consegnate per esami o copie locali;
- se stai usando una versione non aggiornata, il primo passo consigliato e riallinearti al `main` corrente.

## Scope

Questa policy copre vulnerabilita che impattano il progetto Holo-Assistant / Progetto-Ditto, in particolare:

- backend FastAPI e autenticazione;
- frontend React/Vite;
- configurazione PostgreSQL e script di bootstrap;
- script di setup e start per Windows e Unix;
- esposizione accidentale di credenziali, token, chiavi o dati sensibili;
- configurazioni insicure che rendono il sistema esposto oltre l'ambiente locale previsto.

Il progetto e pensato principalmente per esecuzione locale o in LAN controllata. Una configurazione usata in produzione, pubblicata su Internet o modificata pesantemente puo introdurre rischi aggiuntivi non coperti automaticamente da questa policy.

## Reporting a Vulnerability

Se trovi una vulnerabilita, non aprire subito una issue pubblica con i dettagli tecnici.

Canale preferito:

1. Apri una segnalazione privata tramite **GitHub Security Advisories** del repository:
   `https://github.com/IronTunder/Progetto-Ditto/security/advisories/new`

Se il form privato non e disponibile:

1. apri una normale issue su GitHub senza pubblicare exploit, credenziali, token, `.env`, dump del database o passaggi riproducibili completi;
2. descrivi solo l'impatto ad alto livello e indica che vuoi condividere i dettagli in modo riservato;
3. attendi un contatto del maintainer prima di pubblicare altre informazioni.

## What To Include

Per aiutarci a verificare il problema, includi se possibile:

- area coinvolta, ad esempio `backend auth`, `frontend admin`, `docker`, `scripts/windows`;
- versione o commit usato;
- sistema operativo;
- prerequisiti necessari per riprodurre il problema;
- impatto atteso, ad esempio accesso non autorizzato, escalation privilegi, leak di dati, bypass autenticazione;
- eventuali log o screenshot, ma solo dopo avere rimosso dati sensibili.

## Response Expectations

Il progetto non offre un SLA formale, ma l'obiettivo e:

- conferma di ricezione entro 7 giorni;
- prima valutazione entro 14 giorni, quando la segnalazione e riproducibile;
- coordinamento della correzione prima della divulgazione pubblica.

I tempi reali possono variare in base alla complessita del problema e alla disponibilita dei manutentori.

## Disclosure Guidelines

Per proteggere chi usa il progetto:

- evita di pubblicare proof of concept dettagliate prima che la correzione sia disponibile o che il maintainer confermi la divulgazione;
- non pubblicare segreti reali, file `.env`, chiavi private, certificati o dataset interni;
- se la vulnerabilita coinvolge dipendenze terze, segnala anche il problema al progetto originale quando appropriato.

## Out of Scope

In generale non trattiamo come vulnerabilita di sicurezza:

- errori dovuti a installazioni incomplete o ambienti locali non configurati;
- porte esposte volontariamente solo in LAN di laboratorio;
- uso di password deboli in demo locali se impostate manualmente dall'utente;
- problemi presenti solo in fork o modifiche non contenute nel repository ufficiale;
- report privi di impatto di sicurezza concreto.

## Hardening Notes

Per ridurre il rischio nelle installazioni locali:

- usa password lunghe e uniche in `backend/.env`, soprattutto per `DATABASE_PASSWORD`, `ADMIN_PASSWORD` e `SECRET_KEY`;
- non committare file `.env`, certificati o chiavi generate localmente;
- esponi frontend, backend, Adminer e PostgreSQL solo agli host che ne hanno realmente bisogno;
- se il sistema viene usato oltre una LAN fidata, aggiungi reverse proxy, gestione segreti e monitoraggio dedicati.
