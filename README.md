# SpendGuardian — Backend API

Node.js + Express backend for SpendGuardian. Handles file parsing, chart suggestion, and Firebase integration.

---

## 📁 Project Structure

```
spendguardian-backend/
├── src/
│   ├── index.js                  # Express app entry point
│   ├── firebase.js               # Firebase Admin SDK init
│   ├── middleware/
│   │   ├── auth.js               # Firebase token verification
│   │   └── upload.js             # Multer file upload config
│   ├── routes/
│   │   └── api.js                # All API endpoints
│   └── services/
│       ├── sheetParser.js        # SheetJS parsing + type inference
│       └── chartSuggester.js     # Chart recommendation engine
├── .env.example
├── .gitignore
└── package.json
```

---

## ⚙️ Setup Instructions

### 1. Clone / enter the folder

```bash
cd spendguardian-backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up Firebase

1. Go to [Firebase Console](https://console.firebase.google.com) → Create a project called **spendguardian**
2. Enable **Firestore Database** (start in test mode)
3. Enable **Firebase Storage** (start in test mode)
4. Go to **Project Settings → Service Accounts → Generate new private key**
5. This downloads a JSON file. You'll use values from it in your `.env`

### 4. Create your `.env` file

```bash
cp .env.example .env
```

Open `.env` and fill in your values from the downloaded service account JSON:

```env
PORT=5000
FIREBASE_PROJECT_ID=spendguardian-xxxxx
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@spendguardian-xxxxx.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_ACTUAL_KEY\n-----END PRIVATE KEY-----\n"
FIREBASE_STORAGE_BUCKET=spendguardian-xxxxx.appspot.com
```

> ⚠️ The private key must be wrapped in double quotes and keep the literal `\n` characters exactly as they appear in the JSON file.

### 5. Start the server

```bash
# Development (auto-restarts on save)
npm run dev

# Production
npm start
```

You should see:
```
✅ SpendGuardian API running on http://localhost:5000
```

---

## 🧪 Testing with Postman

### Step 0 — Get a Firebase ID Token (for auth)

Since all endpoints (except `/health`) require a valid Firebase ID token, you need one for testing.

**Easiest way — use Firebase REST API:**

```
POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=YOUR_WEB_API_KEY
```

Body (raw JSON):
```json
{
  "email": "test@example.com",
  "password": "testpassword123",
  "returnSecureToken": true
}
```

> Get your **Web API Key** from Firebase Console → Project Settings → General.
> First create the user in Firebase Console → Authentication → Add user.

Copy the `idToken` from the response. Use it as:
```
Authorization: Bearer <idToken>
```

---

### Endpoint 1 — Health Check

```
GET http://localhost:5000/api/health
```

No auth required.

**Expected response:**
```json
{
  "status": "ok",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

---

### Endpoint 2 — Parse a File

```
POST http://localhost:5000/api/parse
```

**Headers:**
```
Authorization: Bearer <your_id_token>
```

**Body:** `form-data`
| Key | Type | Value |
|-----|------|-------|
| file | File | Select your .xlsx or .csv file |
| selectedSheet | Text | (optional) Sheet tab name |

**Expected response:**
```json
{
  "success": true,
  "fileName": "budget.xlsx",
  "fileSize": 12345,
  "sheetNames": ["Sheet1", "Sheet2"],
  "selectedSheet": "Sheet1",
  "rowCount": 24,
  "columns": [
    { "name": "Date", "type": "Date", "sample": ["Jan 2024", "Feb 2024"] },
    { "name": "Amount", "type": "Currency", "sample": ["$1,200", "$980"] },
    { "name": "Category", "type": "Category", "sample": ["Food", "Rent"] }
  ],
  "preview": [
    { "Date": "Jan 2024", "Amount": "$1,200", "Category": "Food" },
    ...
  ]
}
```

---

### Endpoint 3 — Suggest Charts

```
POST http://localhost:5000/api/suggest-charts
```

**Headers:**
```
Authorization: Bearer <your_id_token>
Content-Type: application/json
```

**Body:** raw JSON
```json
{
  "columns": [
    { "name": "Date", "type": "Date" },
    { "name": "Amount", "type": "Currency" },
    { "name": "Category", "type": "Category" }
  ]
}
```

**Expected response:**
```json
{
  "success": true,
  "charts": [
    {
      "id": "line_Date_Amount",
      "chartType": "line",
      "title": "Amount Over Time",
      "xColumn": "Date",
      "yColumn": "Amount",
      "description": "Trend of Amount by Date"
    },
    {
      "id": "bar_Category_Amount",
      "chartType": "bar",
      "title": "Amount by Category",
      ...
    }
  ],
  "statCards": [
    {
      "id": "stats_Amount",
      "chartType": "stats",
      "title": "Amount Summary",
      "yColumn": "Amount"
    }
  ]
}
```

---

### Endpoint 4 — Ingest a File (saves to Firebase)

```
POST http://localhost:5000/api/ingest
```

**Headers:**
```
Authorization: Bearer <your_id_token>
```

**Body:** `form-data`
| Key | Type | Value |
|-----|------|-------|
| file | File | Your .xlsx / .csv |
| projectId | Text | A valid Firestore project doc ID |
| selectedSheet | Text | (optional) |
| columnOverrides | Text | (optional) JSON string e.g. `{"MyCol":"Category"}` |

> ⚠️ You need an existing project document in Firestore first. Create one manually in the Firebase Console under the `projects` collection with any ID.

**Expected response:**
```json
{
  "success": true,
  "sheetId": "uuid-here",
  "rowCount": 24,
  "columns": [...],
  "preview": [...]
}
```

---

### Endpoint 5 — Get Sheet Data

```
GET http://localhost:5000/api/sheet/<sheetId>/data?projectId=<projectId>
```

**Headers:**
```
Authorization: Bearer <your_id_token>
```

**Expected response:**
```json
{
  "success": true,
  "sheetId": "...",
  "rowCount": 24,
  "columns": [...],
  "rows": [
    { "Date": "Jan 2024", "Amount": "$1,200", "Category": "Food" },
    ...
  ]
}
```

---

### Endpoint 6 — Delete a Sheet

```
DELETE http://localhost:5000/api/sheet/<sheetId>
```

**Headers:**
```
Authorization: Bearer <your_id_token>
Content-Type: application/json
```

**Body:** raw JSON
```json
{
  "projectId": "your-project-id"
}
```

**Expected response:**
```json
{
  "success": true,
  "message": "Sheet deleted successfully"
}
```

---

## 📋 Sample Spreadsheet for Testing

Create a simple CSV file called `test_budget.csv`:

```
Date,Category,Amount,Notes
Jan 2024,Food,$450,Groceries
Jan 2024,Rent,$1200,Monthly rent
Jan 2024,Transport,$80,Bus pass
Feb 2024,Food,$390,Groceries
Feb 2024,Rent,$1200,Monthly rent
Feb 2024,Transport,$95,Uber
Mar 2024,Food,$510,Groceries and dining
Mar 2024,Rent,$1200,Monthly rent
Mar 2024,Transport,$60,Bus pass
```

This will trigger:
- A **Line chart** (Date + Amount)
- A **Bar chart** (Category + Amount)  
- A **Pie chart** (Category + Amount, 3 unique categories ≤ 10)
- A **Stat card** for Amount

---

## 🚀 Deployment (Railway)

1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add all environment variables from your `.env` in Railway's Variables tab
4. Railway auto-detects Node.js and runs `npm start`
5. Note the generated URL — you'll use it as `VITE_API_URL` in the frontend

---

## ✅ Recommended Postman Testing Order

1. `GET /api/health` — confirm server is up
2. Get a Firebase ID token (see Step 0)
3. `POST /api/parse` — upload test CSV, check column detection
4. `POST /api/suggest-charts` — pass columns from parse response
5. Create a project in Firestore manually
6. `POST /api/ingest` — full ingest, note the returned sheetId
7. `GET /api/sheet/:id/data` — retrieve the ingested data
8. `DELETE /api/sheet/:id` — clean up
