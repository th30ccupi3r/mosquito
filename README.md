# TAM YAML → draw.io (Local Web App)

Local two-process web application:

- **Backend (Python/ASGI via Starlette)**
  - Parses YAML
  - Validates TAM DSL
  - Applies a deterministic **template layout matching `tam.png`** (3 bands + right sidebar)
  - Generates **mxGraph XML** (`.drawio`) with **embedded base64 SVG icons** loaded from disk
- **Frontend (React/Vite)**
  - Full **dark mode** single-screen UI
  - Fixed top toolbar
  - Left: YAML editor + validation
  - Right: diagram preview (custom mxGraph renderer)
  - Live render (debounced ~400ms)
  - Save / Export `.drawio`

> Visual match contract: the generated diagrams reuse the exact primitives from the example (`tam.png`): light-gray containers, white inner boxes, pill storages, capsule carts, small junction circles, and orthogonal edges.

---

## Prereqs

- Python 3.10+
- Node.js 18+

---

## Run (Backend)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate

# fish shell users:
#   source .venv/bin/activate.fish

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Backend will listen on `http://localhost:8000`.

---

## Run (Frontend)

```bash
npm install
npm run dev
```

Open the printed URL (default `http://localhost:5173`).

---

## YAML DSL (simple + strict)

Top-level keys:

- `trust_boundaries` *(optional)*
- `human_agents`
- `agents`
- `components`
- `storages`
- `areas`
- `external_providers`
- `channels`
- `accesses`

### Minimal example

```yaml
human_agents:
  - Customer

agents:
  - name: API
  - name: Auth

storages:
  - Orders DB

external_providers:
  - Payment Processor

channels:
  - from: Customer
    to: API
    direction: "reqres"   # ->, <-, <->, reqres
    protocol: HTTPS
    label: "browse / checkout"

accesses:
  - from: API
    to: Orders DB
    access: read_write_modify_both
```

### Trust boundaries

```yaml
trust_boundaries:
  - name: Cloud
  - name: On-Premise
```

Rendering rules:

- Drawn as **vertical dashed lines** that divide the whole canvas into columns.
- Each boundary has a **label at the top**.
- Nodes can optionally declare `boundary: <name>` if you provide them as objects:

```yaml
agents:
  - name: API
    boundary: Cloud
```

If boundaries are present, the backend keeps the same 3-band + sidebar template, but all coordinates are constrained to the boundary columns.

---

## TAM semantics implemented (Block Diagram)

- Human agents are active parts (top band). No nesting.
- Agents/components are active parts (middle band). Containers supported via `areas`/`children` in YAML (validated for circular nesting).
- Storages are bottom band in pill shapes.
- Channels support `->`, `<-`, `<->`, `reqres` (request/response places an **R marker**).
- Access links support:
  - `read_write_modify_both`
  - `read_write_modify_single_left`
  - `read_write_modify_single_right`

---

## Icons (mandatory, loaded from disk)

Backend **must** find these files (already included in `backend/tam_diagram/`):

- `human.svg`
- `storage.svg`
- `common_feature_areas.svg`
- `read_write_modify_both.svg`
- `read_write_modify_single_right.svg`
- `read_write_modify_single_left.svg`

At startup the backend reads them from disk, base64-encodes them, and embeds them into mxGraph styles as `data:image/svg+xml;base64,...` URIs.

---

## Layout strategy (deterministic template)

The backend always renders the **same structural template** as the example:

1. **Customers** band (top)
2. **Online Shop Server** band (middle)
   - 3 equal component boxes
   - Shopping carts capsule area
3. **ERP data** band (bottom)
   - 4 pill storages
4. **service provider** sidebar (right)

Even if YAML is “small”, the template remains and unused slots remain visually empty.

Stable IDs are derived from element names using a deterministic hash.

---

## Keyboard restrictions

The preview uses a **custom mxGraph renderer** (not the full diagrams.net editor), and:

- Allows **arrow-key panning** only
- Prevents all other diagram shortcuts (delete/copy/paste/zoom/undo/redo/etc.)

---

## Export

- **Save Diagram** / **Export .drawio** downloads the current mxGraph XML.
- Open the file in diagrams.net and export PNG/SVG if desired.

---

## Notes

- This implementation is intentionally conservative: it reproduces the reference layout style rather than inventing new aesthetics.

---

## Manual tests (TAM edge semantics)

Use the toolbar "Add connection" and verify in the preview:

1. **Subcomponent → Storage (readAccess)** renders a single line with an arrow in the chosen direction.
2. **Subcomponent → Storage (modifyAccess)** renders the TAM **double-arc / two-way curly** modify marker and keeps it centered when rerouting.
3. **Component ↔ Subcomponent (bidirectional)** shows arrows at both ends.
4. **Component → Component (requestResponse)** shows an **R** marker with a small arrow indicating request direction.
5. **Reverse requestResponse** (swap endpoints + direction) flips both arrowheads and the R marker arrow.
6. **Storage ↔ Storage** is rejected with: "Storage-to-storage is not a TAM access/communication link. Connect storages via an active element instead."

## Run both backend + frontend

From the repo root:

- `./start_all.sh`

This will start the backend on port 8000 and the Vite frontend on its dev port.
