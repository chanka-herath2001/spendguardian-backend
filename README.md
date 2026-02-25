# SpendGuardian — Backend

> REST API powering SpendGuardian — a personal finance dashboard that parses Excel/CSV files into interactive charts.

Built with Node.js, Express, and Firebase. Handles file parsing, cloud storage, Firestore data management, and JWT-authenticated API endpoints.

**Frontend repo:** *(link here)*

---

## What It Does

1. Accepts `.xlsx`, `.xls`, and `.csv` file uploads
2. Parses them server-side — detects column types (Date, Currency, Number, Category, etc.), skips title rows, evaluates Excel formula results
3. Stores raw files and parsed JSON in **Firebase Storage**
4. Saves sheet metadata and user/project structure in **Firestore**
5. Suggests appropriate chart types based on column analysis
6. Exposes a secure REST API — every endpoint requires a valid Firebase Auth JWT

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+ |
| Framework | Express.js |
| Database | Firebase Firestore |
| File Storage | Firebase Storage |
| Auth | Firebase Admin SDK (JWT verification) |
| File Parsing | SheetJS (xlsx) |
| File Uploads | Multer (memory storage) |

---

## API Overview

### Auth
All endpoints require `Authorization: Bearer <Firebase ID Token>`.

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/users/me` | Register user profile (idempotent — safe on every login) |
| `GET` | `/api/users/me` | Get current user profile |
| `PATCH` | `/api/users/me` | Update preferences (currency, display name, etc.) |
| `DELETE` | `/api/users/me` | Delete account + all data (cascade) |

### Projects
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/projects` | Create a project |
| `GET` | `/api/projects` | List user's projects |
| `DELETE` | `/api/projects/:id` | Delete project + all sheets |

### Sheets
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/parse` | Parse file preview (no DB write) |
| `POST` | `/api/ingest` | Full parse → Storage → Firestore |
| `GET` | `/api/projects/:id/sheets` | List sheets for a project |
| `GET` | `/api/sheet/:id/data` | Get full row data for a sheet |
| `PUT` | `/api/sheet/:id/data` | Save edited row/column data |
| `DELETE` | `/api/sheet/:id` | Delete sheet + storage files |

### Charts
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/suggest-charts` | Suggest chart types from column metadata |

---

## Getting Started

### Prerequisites
- Node.js 18+
- A Firebase project with Firestore and Storage enabled
- Firebase service account key (JSON)

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```

Fill in your `.env`:
```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
PORT=5000
```

Download your service account key from **Firebase Console → Project Settings → Service accounts → Generate new private key** and save it as `serviceAccountKey.json` in the project root.

> ⚠️ Never commit `serviceAccountKey.json` or `.env` — both are in `.gitignore`.

### 3. Run in development
```bash
npm run dev
# → SpendGuardian API running on http://localhost:5000
```

---

## Key Implementation Details

**Formula evaluation** — Excel files often use formulas like `=C5-B5`. SheetJS reads cached formula results rather than formula strings, so users see real values.

**Smart header detection** — The parser scans the first 10 rows and selects the row with the most filled cells as the header row. This correctly handles files with title rows, subtitle rows, or blank rows above the real column names.

**Section row filtering** — Decorative rows like `▸ INCOME` or `TOTAL` (where only the first cell is filled with non-numeric text) are automatically excluded from data rows.

**Ownership chain** — Every endpoint validates both that the user doc exists and that the requested resource belongs to them. No resource can be accessed or modified by a different user.

**No composite Firestore indexes required** — Queries use a single `where` clause and sort results in JavaScript, avoiding the need to configure Firestore indexes manually.

---

## Data Model

```
users/{uid}
  - uid, email, displayName, currency, dateFormat
  - lastActiveProject

  └── (separate collection) projects/{projectId}
        - id, ownerId, name, currency, sheetCount

        └── sheets/{sheetId}
              - id, projectId, ownerId, fileName
              - columns[], rowCount
              - storageUrl, parsedDataUrl
```

---

## Author

**Chanka Herath**  
[GitHub](https://github.com/chanka-herath2001) · [LinkedIn](https://www.linkedin.com/in/chanka-herath/)