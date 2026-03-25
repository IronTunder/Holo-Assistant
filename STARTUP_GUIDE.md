# 🚀 Progetto Ditto - Script di Avvio

Questo progetto include script batch automatici per avviare i servizi in modo semplice e veloce.

## 📋 Script Disponibili

### 1. **setup.bat** - Configurazione Iniziale ⚙️
Esegui questo script **una sola volta** al primo avvio per:
- Creare l'environment virtuale Python
- Installare le dipendenze backend
- Installare le dipendenze frontend
- Inizializzare il database
- Creare il primo utente admin

```bash
setup.bat
```

**Quando usarlo:** Solo al primo avvio del progetto

---

### 2. **start.bat** - Avvio Servizi (Development) 🔧
Avvia backend e frontend in modalità **development** con hot reload.

```bash
start.bat
```

**Cosa fa:**
- ✅ Avvia **Docker (PostgreSQL)** automaticamente via `docker-compose up -d`
- ✅ Avvia FastAPI Backend su `http://localhost:8000` (con reload automatico)
- ✅ Avvia Vite Dev Server Frontend su `http://localhost:5173` (con hot reload)
- ✅ Apre tre finestre separate (Docker, backend e frontend)
- ✅ Installa automaticamente le dipendenze se mancanti
- ⚠️ Se Docker non è disponibile, continua senza (assicurati che PostgreSQL sia comunque in esecuzione)

**Quando usarlo:** Durante sviluppo, quando stai modificando il codice

**Porte:**
- Backend: `http://serverip:8000` (o `http://localhost:8000`)
- Frontend: `http://localhost:5173`
- Health Check: `http://serverip:8000/health`

---

### 3. **start_production.bat** - Avvio Servizi (Production) 🏭
Avvia backend e frontend in modalità **production** senza hot reload.

```bash
start_production.bat
```

**Cosa fa:**
- ✅ Avvia **Docker (PostgreSQL)** automaticamente via `docker-compose up -d`
- ✅ Avvia FastAPI Backend senza `--reload` (più performante)
- ✅ Avvia Vite Preview Server (build ottimizzato)
- ✅ Disabilita il debug logging
- ⚠️ Se Docker non è disponibile, continua senza (assicurati che PostgreSQL sia comunque in esecuzione)

**Quando usarlo:** Test finali, demo, o quando serve stabilità

---

## 🔧 Prerequisiti

Prima di avviare gli script, assicurati di avere:

### Backend
- ✅ Python 3.8+ installato
- ✅ File `.env` configurato nella cartella `backend/`
- ✅ Ollama installato e accessibile (Docker o nativo)

### Frontend
- ✅ Node.js 16+ installato
- ✅ npm installato (di default con Node.js)
- ✅ File `.env` configurato nella cartella `frontend/my-app/`

### Database & AI
- ✅ PostgreSQL in esecuzione (Docker o nativo)
- ✅ Database inizializzato (tramite `setup.bat`)
- ✅ Ollama in esecuzione con modello `mistral` caricato

---

## 📝 File .env Richiesti

### `backend/.env`
```ini
# Database Configuration
DATABASE_HOST={server's-ip-address}      # Indirizzo server del database
DATABASE_PORT=5432               # Porta PostgreSQL
DATABASE_USER=postgres            # Utente DB
DATABASE_PASSWORD=postgres        # Password DB
DATABASE_NAME=ditto_db            # Nome database

# JWT & Security
SECRET_KEY=your-super-secret-key-change-this-in-production
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
ADMIN_TOKEN_EXPIRE_MINUTES=120

# Admin Credentials (per login admin dashboard)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=tuapasswordsicura

# CORS (Allowed Frontend Origins)
ALLOWED_ORIGINS=http://localhost:5173,http://{server's-ip-address}:5173

# Ollama AI Service
OLLAMA_BASE_URL=http://{server's-ip-address}:11434   # URL del servizio Ollama
```

### `frontend/my-app/.env`
```ini
# Backend API Endpoint
VITE_API_URL=http://{server's-ip-address}:8000

# Ollama AI Service (usato dal frontend per debug/testing)
VITE_AI_API_URL=http://{server's-ip-address}:11434
```

---

## 🚀 Flusso di Avvio Tipico

### **Prima volta (Configurazione iniziale)**
```bash
setup.bat          # Crea venv, installa dipendenze, inizializza DB
```

### **Avvio successivo (Sviluppo)**
```bash
start.bat          # Avvia Docker, backend e frontend con hot reload
# (Docker avviato automaticamente se disponibile)
```

### **Test o Demo (Produzione)**
```bash
start_production.bat  # Avvia Docker, backend e frontend (no hot reload)
# (Docker avviato automaticamente se disponibile)
```

### **Avvio senza Docker** (se Docker non è installato)
Assicurati che PostgreSQL sia già in esecuzione:
```bash
# Opzione 1: PostgreSQL locale installato
start.bat          # Continua senza Docker

# Opzione 2: Docker disponibile solo via CLI
# Avvia manualmente: docker-compose -f docker/docker-compose.yml up -d
# Poi esegui: start.bat
```

### **Arresto servizi**
```bash
stop.bat           # Ferma tutti i servizi
# Nota: stop.bat NON ferma Docker (lasciarlo in esecuzione per riavvii rapidi)
```

---

## 🐳 Docker & PostgreSQL

Gli script automaticamente:
1. Controllano se Docker è installato
2. Se sì: Avviano PostgreSQL via `docker-compose up -d`
3. Se no: Continuano assumendo PostgreSQL locale

Per **fermare solo PostgreSQL**:
```bash
docker-compose -f docker/docker-compose.yml down
```

Per **fermare e pulire volume database**:
```bash
docker-compose -f docker/docker-compose.yml down -v
```

---

## 🔍 Health Check

Verifica che i servizi siano in esecuzione:

```bash
# Backend
curl http://{server's-ip-address}:8000/health

# Frontend (visita nel browser)
http://localhost:5173
```

---

## 🆘 Troubleshooting

### Backend non si avvia
- Verifica che PostgreSQL sia in esecuzione
- Verifica che Ollama sia in esecuzione: `http://{server's-ip-address}:11434/api/tags`
- Controlla file `.env` in `backend/` con `OLLAMA_BASE_URL` corretto
- Assicurati che Python sia installato: `python --version`
- Ricreamo venv: `rmdir backend\venv` e riesegui `start.bat`

### Ollama non disponibile (503 Service Unavailable)
- Verifica che il container Ollama sia in esecuzione: `docker ps | findstr ollama`
- Verifica che il modello mistral sia caricato: `docker exec ditto_ollama ollama list`
- Se manca, carica il modello: `docker exec ditto_ollama ollama pull mistral`
- Controlla che `OLLAMA_BASE_URL` in `backend/.env` sia corretto

### Frontend non si avvia
- Controlla che Node.js sia installato: `node --version`
- Elimina `node_modules`: `rmdir frontend\my-app\node_modules /s`
- Riesegui `start.bat` per reinstallare

### Porte occupate
Se le porte 8000 o 5173 sono già in uso:
- Cambia porta nel `start.bat` (es. `--port 8001`)
- O ferma i servizi che le occupano: `stop.bat`

### Admin login non funziona
- Assicurati che il database sia stato inizializzato: `setup.bat`
- Verifica le credenziali in `backend/.env`: `ADMIN_USERNAME` e `ADMIN_PASSWORD`
- Verifica nel frontend che gli URL in `frontend/my-app/.env` siano corretti
- Controlla se l'endpoint è corretto: `http://localhost:5173/admin-login`
- Controlla nei browser console (F12) se ci sono errori CORS

### AI classification non funziona (Error classifying question with Ollama)
- Verifica che Ollama sia raggiungibile dall'IP configurato
- Controlla i log del backend per l'IP effettivo di connessione
- Carica il modello mistral se manca: `docker exec ditto_ollama ollama pull mistral`

---

## 📊 Architettura

```
┌─────────────────────────────────────────┐
│         Browser (localhost:5173)        │
└────────────────┬────────────────────────┘
                 │
                 ├─→ Vite Dev Server (Frontend)
                 │
                 └─→ FastAPI Backend (localhost:8000)
                     ├─→ PostgreSQL Database
                     └─→ Admin Endpoints
```

---

## 📚 Documentazione

- **Backend API**: [app/main.py](./backend/app/main.py)
- **Auth System**: [app/api/auth/auth.py](./backend/app/api/auth/auth.py)
- **Admin Dashboard**: [src/app/components/admin/](./frontend/my-app/src/app/components/admin/)
- **Models**: [app/models/](./backend/app/models/)

---

## 🎯 Prossimi Passi

Dopo aver avviato i servizi:
1. Apri il browser: `http://localhost:5173`
2. Login come operatore (badge o credenziali)
3. Accedi admin panel: `http://localhost:5173/admin-login`
4. Gestisci utenti e macchinari

---

**Creato:** 2026-03-24  
**Ultima modifica:** 2026-03-24
