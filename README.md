# 🤖 Progetto Ditto - Sistema di Gestione Macchinari

**Progetto Ditto** è un sistema completo di **gestione macchinari industriali** con interfaccia operatore e dashboard amministrativa.

## 🎯 Caratteristiche Principali

### 👷 Operatore
- ✅ Login tramite **badge RFID** o credenziali
- ✅ Interfaccia intuitiva per macchinari assegnati
- ✅ Gestione stato macchinari (in uso, libero, manutenzione)
- ✅ Registro interazioni e utilizzo

### 👨‍💼 Amministratore
- ✅ Dashboard amministrativa **protetta da credenziali separate**
- ✅ Gestione utenti (CRUD completo)
- ✅ Gestione macchinari e postazioni
- ✅ Visualizzazione log audit
- ✅ Gestione ruoli e permessi
- ✅ Reset password utenti

## 🏗️ Architettura

```
┌─────────────────────────────────────────────┐
│          Frontend (React + TypeScript)      │
│   Vite Dev Server - localhost:5173         │
└────────┬──────────────────────────┬─────────┘
         │                          │
    [Operator UI]            [Admin Dashboard]
         │                          │
         └────────────┬─────────────┘
                      │
              FastAPI Backend
         {serverip}:8000
         └─────┬──────────┘
               │
        ┌──────┴──────────┐
        │   PostgreSQL    │
        │   Database      │
        └─────────────────┘
```

## 🚀 Quick Start

### 1️⃣ **Primo Avvio - Setup Completo**
```bash
setup.bat
```
Questo crea venv, installa dipendenze, inizializza il database.

### 2️⃣ **Avvio Servizi (Development)**
```bash
start.bat
```
Avvia Backend + Frontend con hot reload.

- 🎨 Frontend: http://localhost:5173
- 🔌 Backend API: http://{serverip}:8000
- 📊 Health Check: http://{serverip}:8000/health

### 3️⃣ **Test Admin Dashboard**
```
http://localhost:5173/admin-login
Username: admin (da .env)
Password: tuapasswordsicura (da .env)
```

### 4️⃣ **Arresto Servizi**
```bash
stop.bat
```

## 📖 Documentazione Completa

👉 **[Guida di Avvio Dettagliata](./STARTUP_GUIDE.md)** - Tutto su setup, configurazione, troubleshooting

## 📋 Prerequisiti

- **Python 3.8+** - [Download](https://python.org)
- **Node.js 16+** - [Download](https://nodejs.org)
- **PostgreSQL 12+** - [Download](https://postgresql.org) oppure Docker
- **Git** (opzionale)

## 🗂️ Struttura Progetto

```
Progetto-Ditto/
├── backend/                  # FastAPI Server (Python)
│   ├── app/
│   │   ├── main.py          # App principale
│   │   ├── database.py      # Connessione DB
│   │   ├── models/          # SQLAlchemy models
│   │   ├── schemas/         # Pydantic schemas
│   │   └── api/
│   │       ├── auth/        # Endpoint autenticazione
│   │       ├── machines.py  # API macchinari (operatore)
│   │       └── admin.py     # API admin (CRUD)
│   ├── init_db.py           # Inizializzazione DB
│   ├── populate.py          # Dati di test
│   └── requirements.txt      # Dipendenze Python
│
├── frontend/my-app/          # React + TypeScript (Vite)
│   ├── src/
│   │   ├── main.tsx
│   │   ├── app/
│   │   │   ├── App.tsx
│   │   │   ├── AuthContext.tsx
│   │   │   ├── routes.tsx
│   │   │   └── components/
│   │   │       ├── admin/   # Admin dashboard components
│   │   │       ├── operator/ # Operatore interface
│   │   │       └── ui/      # shadcn/ui components
│   │   └── api/
│   │       └── config.ts    # Endpoint configuration
│   └── package.json
│
├── docker/
│   └── docker-compose.yml    # PostgreSQL (opzionale)
│
└── start.bat / stop.bat / setup.bat
```

## 🔐 Autenticazione e Autorizzazione

### Login Operatore
```
POST /auth/login
{
  "badge_id": "ABC123"  // o username + password
}
→ JWT Token (8 ore)
```

### Login Admin
```
POST /auth/admin-login
{
  "username": "admin",
  "password": "password"
}
→ JWT Token Admin (2 ore, più restrittivo)
```

### Controlli Accesso
- **GET /machines** - Pubblico
- **POST/PUT/DELETE /machines** - Solo ADMIN
- **GET/POST/PUT/DELETE /admin/** - Solo ADMIN

## 🗄️ Database Schema

### User
- `id`, `badge_id`, `nome`, `email`, `password_hash`
- `ruolo`: OPERAIO | ADMIN
- `livello_esperienza`, `reparto`, `turno`
- `creato_il`, `aggiornato_il`

### Machine
- `id`, `nome`, `descrizione`, `reparto`
- `in_uso`: bool, `id_operatore`: nullable
- `stato`, `id_postazione`
- `creato_il`, `aggiornato_il`

### InteractionLog
- `id`, `user_id`, `machine_id`
- `domanda`, `risposta`, `timestamp`

### RefreshToken
- Token refresh JWT per estendere sessioni

## ⚙️ Variabili Ambiente

### backend/.env
```ini
# Database
DATABASE_URL=postgresql://user:password@localhost/ditto

# JWT
SECRET_KEY=your-secret-key
ADMIN_TOKEN_EXPIRE_MINUTES=120
ACCESS_TOKEN_EXPIRE_MINUTES=480

# Admin
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

### frontend/my-app/.env
```ini
VITE_API_URL=http://{serverip}:8000
```

## 🛠️ Sviluppo

### Backend
```bash
cd backend
python -m venv venv
venv\Scripts\activate      # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend
```bash
cd frontend/my-app
npm install
npm run dev
```

## 📊 API Endpoints

### Auth
- `POST /auth/login` - Login operatore (badge)
- `POST /auth/admin-login` - Login admin
- `POST /auth/refresh` - Refresh token
- `POST /auth/logout` - Logout

### Machines
- `GET /machines` - Lista macchinari
- `POST /machines` - Crea (admin)
- `PUT /machines/{id}` - Modifica (admin)
- `DELETE /machines/{id}` - Elimina (admin)

### Admin Only
- `GET /admin/users` - Lista utenti
- `POST /admin/users` - Crea utente
- `PUT /admin/users/{id}` - Modifica utente
- `DELETE /admin/users/{id}` - Elimina utente
- `POST /admin/users/{id}/reset-password` - Reset password
- `GET /admin/logs` - Log audit
- `GET /admin/machines` - Gestione macchinari

Vedi `/docs` per OpenAPI completo.

## 🔄 Flussi Principali

### 1. Login Operatore
```
Browser → http://localhost:5173
  ↓
Inserisci Badge ID (RFID) o username
  ↓
POST /auth/login
  ↓
JWT Token salvato in localStorage
  ↓
Accesso OperatorInterface
```

### 2. Accesso Admin Dashboard
```
Browser → http://localhost:5173/admin-login
  ↓
Inserisci Username + Password Admin
  ↓
POST /auth/admin-login
  ↓
Admin JWT salvato (token diverso)
  ↓
ProtectedRoute: verifica isAdmin
  ↓
Accesso AdminDashboard
```

### 3. Creazione Nuovo Utente (Admin)
```
AdminDashboard → Tab "Users"
  ↓
Clicca "Aggiungi Utente"
  ↓
Compila form (nome, badge_id, role, etc)
  ↓
POST /admin/users
  ↓
Nuovo utente nel database
  ↓
Refresh lista utenti
```

## 🧪 Testing

### Test Backend
```bash
cd backend
pytest              # Se pytest installato
# Oppure test manuale via /docs
```

### Test Frontend
```bash
cd frontend/my-app
npm run build       # Build ottimizzato
npm run preview     # Preview build
```

### Health Check
```bash
curl http://{serverip}:8000/health
# {"status": "ok"}
```

## 🐛 Troubleshooting

| Problema | Soluzione |
|----------|-----------|
| **404 on /auth/admin-login** | Controlla config.ts: URL deve essere senza `/api/` prefix |
| **Accesso negato admin dashboard** | Verifica ADMIN_USERNAME/PASSWORD in .env |
| **Database connection error** | Assicurati PostgreSQL è in esecuzione; controlla DATABASE_URL |
| **Cannot find module (frontend)** | `cd frontend/my-app && npm install` |
| **Port already in use** | Esegui `stop.bat` o cambia porta in start.bat |
| **401 Unauthorized** | Token scaduto o mancante; login di nuovo |

👉 **Vedi [STARTUP_GUIDE.md](./STARTUP_GUIDE.md) per troubleshooting dettagliato**

## 🚀 Deployment

### Development
```bash
start.bat          # Hot reload abilitato
```

### Production
```bash
start_production.bat    # Build ottimizzato, no reload
```

Opzioni per deploy:
- Docker (vedi `docker-compose.yml`)
- Ubuntu/Linux con systemd
- Cloud (AWS, Azure, Heroku)

## 📝 Password Admin Predefinita

⚠️ **IMPORTANTE**: Cambia la password admin SUBITO in produzione!

Default (in .env):
```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

Modifica in `backend/.env` prima di qualsiasi deployment.

## 📞 Support & Docs

- **API Docs**: http://{serverip}:8000/docs (Swagger)
- **Setup Guide**: [STARTUP_GUIDE.md](./STARTUP_GUIDE.md)
- **GitHub Issues**: Segnala problemi
- **Email**: support@example.com

## 📄 Licenza

Proprietary - Uso interno solo

## 👥 Contributors

- Team Progetto Ditto

---

**Ultima Modifica**: Marzo 2024  
**Versione**: 1.0.0

