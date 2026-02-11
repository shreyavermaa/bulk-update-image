# NEXUS GEN — System Context

**Automated Multi-Vector AI Image Generation Platform**  
Generates AI image variants from product images using n8n + Supabase.

---

## Architecture

```
Frontend (React) → Backend (Express) → Supabase DB
                ↓
              n8n Webhook → AI Image Gen → Supabase Storage
```

- **Frontend:** React 18 + Vite (browser orchestrator)
- **Backend:** Express.js API (deployed to Render)
- **Database:** Supabase `product_generations` table
- **Storage:** Supabase Storage bucket `ai-image`
- **AI Pipeline:** n8n webhook

---

## Key Files

### Backend
- `backend/index.js` — Express API with all routes
- `backend/supabaseClient.js` — Supabase client init

### Frontend  
- `frontend/src/App.jsx` — Root component with navigation
- `frontend/src/components/UploadSection.jsx` — **Main orchestrator** (CSV parsing, n8n calls, DB updates)
- `frontend/src/components/StatusDashboard.jsx` — Live status polling (auto-stops when batch done)
- `frontend/src/components/BatchHistory.jsx` — Batch history & downloads

---

## Processing Flow

1. User uploads CSV (`Product_ID`, `Image_Link`) + up to 3 prompts
2. Frontend parses CSV → **sanitizes data** (trims whitespace) → gets batch ID
3. For each CSV row × each prompt:
   - `POST /api/db/start-item` → UPSERT row, status = `PROCESSING`
   - `POST n8n webhook` → AI generates image
   - `POST /api/db/complete-item` with **3 retry attempts** → status = `COMPLETED`
   - If complete-item fails 3x → `POST /api/db/fail-item` → status = `FAILED`
   - Wait 60s cooldown
4. If entire item fails 3x → mark as FAILED, skip to next item
5. Dashboard polls `/api/batch-status/:id` every 3s, **auto-stops when all done**

---

## Critical: Robustness

> [!IMPORTANT]
> **CSV Sanitization**: Trims `Product_ID` and `Image_Link` whitespace at parse time.

> [!IMPORTANT]
> **Retry with Limit**: `complete-item` retries 3x with backoff. Entire item retries 3x max, then marked FAILED and skipped.

> [!IMPORTANT]
> **Backend UPSERT**: Single atomic operation instead of SELECT-INSERT-UPDATE (3x faster).

> [!IMPORTANT]
> **Auto-stop Polling**: Dashboard stops polling when all items reach terminal state.

---

## Constants (Frontend)

```javascript
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
const N8N_URL = 'https://n8n.srv1163673.hstgr.cloud/webhook/image-variant';
const MAX_RETRIES_PER_ITEM = 3;
```

---

## Database Schema: `product_generations`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `batch_id` | text | e.g. `Batch_024` |
| `product_id` | text | Must be trimmed |
| `image_link` | text | Source image URL |
| `prompt1/2/3` | text | AI prompts |
| `image1/2/3_path` | text | Supabase storage path |
| `status1/2/3` | text | `PENDING` → `PROCESSING` → `COMPLETED`/`FAILED`/`SKIPPED` |
| `error1/2/3` | text | Error messages |

**Unique constraint:** `(batch_id, product_id)` — used by UPSERT

---

## API Routes

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/new-batch-id` | Get next sequential batch ID |
| `POST` | `/api/db/start-item` | UPSERT row, set status PROCESSING |
| `POST` | `/api/db/complete-item` | Set status COMPLETED |
| `POST` | `/api/db/fail-item` | Set status FAILED + error message |
| `GET` | `/api/batch-status/:batchId` | Get all items in batch |
| `GET` | `/api/batches` | List batches (limit 200) |
| `GET` | `/api/download-batch/:batchId` | Download CSV |
| `GET` | `/api/download-images/:batchId` | Download ZIP of images |

---

## Config

| Variable | Value |
|---|---|
| Backend URL (prod) | `https://bulk-update-image.onrender.com` |
| n8n Webhook | `https://n8n.srv1163673.hstgr.cloud/webhook/image-variant` |
| Supabase Project | `rlptkbneebkgfiutcbmt` |
| Storage Bucket | `ai-image` |
| Cooldown | 60s between variants |
| Max Retries | 3 per item |
| Poll Interval | 3s (auto-stops) |

---

## Known Limitations

- Browser tab must stay open during processing (frontend-driven orchestration)
- For 500+ item batches, should migrate processing to backend
- No authentication (all endpoints are public)
