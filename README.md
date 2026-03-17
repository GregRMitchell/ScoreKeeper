# 🎲 ScoreKeeper

A lightweight, offline-capable Progressive Web App (PWA) for tracking board game scores. Install it on your phone or use it in any browser — no account, no server, no internet required after the first visit.

---

## Features

- **60+ built-in game sheets** — Catan, Wingspan, Ticket to Ride, 7 Wonders, Agricola, and many more
- **Two scoring styles** — *Categories* (fixed rows per player) and *Rounds* (add a row per turn)
- **Four category types** — Number, Checkbox, Lookup table, and Formula
- **Custom games** — build your own scoresheet in-app or author JSON by hand and import it
- **Game history** — finished games are saved locally and viewable at any time
- **Backup / restore** — export and import all data as a single JSON file
- **Offline-first** — a service worker caches everything after the first load
- **Installable** — add to home screen on iOS/Android/desktop via the browser's install prompt

---

## Usage

Open `index.html` in a browser (or serve the directory with any static file server).

```sh
# Quick local server with Python
python -m http.server 8080

# Or with Node
npx serve .
```

> The service worker requires the app to be served over HTTP/HTTPS, not opened as a `file://` URL.

### Starting a game

1. Tap **+ New Game** on the home screen.
2. Choose a game from the list (or create a custom one — see below).
3. Select players from your saved list or type ad-hoc names.
4. Tap **Start Game** and fill in scores.
5. Tap **🏁 Finish Game** to record the result.

---

## Adding a new built-in game

Drop a JSON file in `sheets/` and register it in `sheets/index.json`:

```json
// sheets/index.json — add one entry:
{ "id": "my-game", "name": "My Game", "style": "categories" }
```

The full sheet definition lives in `sheets/my-game.json`. See the schema reference below.

---

## Scoresheet JSON schema

Every scoresheet file must include these top-level fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Unique identifier, used as the filename (`<id>.json`) |
| `name` | string | yes | Display name shown in the game list |
| `style` | `"categories"` \| `"rounds"` | yes | Scoring layout style |
| `scoring` | `"highest"` \| `"lowest"` | yes | How the winner is determined |
| `minPlayers` | number | no | Minimum players (default: 1) |
| `maxPlayers` | number | no | Maximum players (default: 99) |
| `categories` | array | if `style` is `"categories"` | List of scoring category objects |
| `rounds` | object | if `style` is `"rounds"` | Rounds configuration object |
| `tiebreaker` | string | no | Human-readable note describing how ties are broken (display only, not enforced by the app) |

---

## Style: `categories`

Players score across a fixed list of categories. All categories are visible at once in a grid.

```json
{
  "id": "my-game",
  "name": "My Game",
  "minPlayers": 2,
  "maxPlayers": 4,
  "style": "categories",
  "scoring": "highest",
  "categories": [
    { "name": "Roads", "type": "number", "min": 0, "max": 15 },
    { "name": "Longest Road", "type": "boolean", "value": 2 }
  ]
}
```

### Category objects

Each entry in `categories` must have a `name` and `type`. The remaining fields depend on the type.

---

### Category type: `number`

A plain integer input field.

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Label shown in the row header |
| `type` | `"number"` | yes | |
| `min` | number | no | Minimum allowed value (HTML input constraint) |
| `max` | number | no | Maximum allowed value (HTML input constraint) |

**Example — negative values allowed:**
```json
{ "name": "Curses", "type": "number", "min": -30, "max": 0 }
```

**Example — no upper bound:**
```json
{ "name": "Bonus Points", "type": "number", "min": 0 }
```

---

### Category type: `boolean`

A checkbox worth a fixed number of points when checked. Useful for one-off bonuses (Longest Road, Largest Army, etc.).

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Label shown in the row header |
| `type` | `"boolean"` | yes | |
| `value` | number | yes | Points awarded when the box is checked |

**Example:**
```json
{ "name": "Longest Road", "type": "boolean", "value": 2 }
```

The point value is shown next to the checkbox as a reminder.

---

### Category type: `lookup`

The player enters a raw count; the app looks it up in a table and awards the corresponding points. Useful when the scoring curve is non-linear (e.g. Agricola's farm scoring).

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Label shown in the row header |
| `type` | `"lookup"` | yes | |
| `table` | array of range objects | yes | See below |

**Range object fields:**

| Field | Type | Description |
|---|---|---|
| `min` | number | Lower bound (inclusive). Omit for "any value up to max". |
| `max` | number | Upper bound (inclusive). Omit for "any value from min upwards". |
| `points` | number | Points awarded when the count falls in this range. |

Ranges are evaluated top-to-bottom; the first matching range wins. A range with neither `min` nor `max` acts as a catch-all.

**Example — Agricola sheep scoring:**
```json
{
  "name": "Sheep",
  "type": "lookup",
  "table": [
    { "max": 0,              "points": -1 },
    { "min": 1, "max": 3,   "points": 1  },
    { "min": 4, "max": 5,   "points": 2  },
    { "min": 6, "max": 7,   "points": 3  },
    { "min": 8,              "points": 4  }
  ]
}
```

The app shows the raw count input alongside a live `= N pts` badge.

---

### Category type: `formula`

The player enters one or more numeric inputs; the app evaluates an arithmetic expression and displays the result as the score. Useful for multiplicative scoring (e.g. Stone Age's Farmers × Farm Track).

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Label shown in the row header |
| `type` | `"formula"` | yes | |
| `inputs` | array of input objects | yes | The variables available to the formula |
| `formula` | string | yes | Arithmetic expression (see below) |

**Input object fields:**

| Field | Type | Description |
|---|---|---|
| `label` | string | Display label for the input field |
| `key` | string | Variable name used in the formula expression (letters/digits/underscore only) |
| `min` | number | Optional minimum value for the input |
| `max` | number | Optional maximum value for the input |

**Formula expression syntax:**

The expression is evaluated as plain JavaScript arithmetic. Supported operators and functions:

- `+` `-` `*` `/`
- Parentheses `(` `)`
- Integer and decimal literals
- `min(a, b)` — minimum of two values
- `max(a, b)` — maximum of two values
- Any key names defined in `inputs`

**Example — 7 Wonders science scoring:**
```json
{
  "name": "Science",
  "type": "formula",
  "inputs": [
    { "label": "Compasses", "key": "c", "min": 0 },
    { "label": "Tablets",   "key": "t", "min": 0 },
    { "label": "Gears",     "key": "g", "min": 0 }
  ],
  "formula": "c*c + t*t + g*g + 7*min(c,t,g)"
}
```

**Example — Stone Age multiplier:**
```json
{
  "name": "Farmers × Farm Track",
  "type": "formula",
  "inputs": [
    { "label": "Farmer Cards", "key": "farmers", "min": 0 },
    { "label": "Farm Track",   "key": "track",   "min": 0, "max": 8 }
  ],
  "formula": "farmers * track"
}
```

The app renders each input on its own line and shows a live `= N pts` badge at the bottom of the cell.

---

## Style: `rounds`

Players enter a single score per round. New rounds are added on demand during play.

```json
{
  "id": "wizard",
  "name": "Wizard",
  "minPlayers": 3,
  "maxPlayers": 6,
  "style": "rounds",
  "scoring": "highest",
  "rounds": { "label": "Round", "maxRounds": null }
}
```

### `rounds` object fields

| Field | Type | Required | Description |
|---|---|---|---|
| `label` | string | yes | Column header and button label (e.g. `"Round"`, `"Hand"`, `"Level"`, `"Turn"`) |
| `maxRounds` | number \| `null` | yes | Cap on the number of rounds. Use `null` for unlimited. |

**Example — fixed 3-round game (Galaxy Trucker):**
```json
{ "label": "Round", "maxRounds": 3 }
```

**Example — 9-level game (Loony Quest):**
```json
{ "label": "Level", "maxRounds": 9 }
```

**Example — unlimited hands (Hearts, Scrabble, Uno):**
```json
{ "label": "Hand", "maxRounds": null }
```

---

## Full examples

### Catan — `categories` with numbers and booleans

```json
{
  "id": "catan",
  "name": "Catan",
  "minPlayers": 2,
  "maxPlayers": 6,
  "style": "categories",
  "scoring": "highest",
  "categories": [
    { "name": "Settlements",  "type": "number",  "min": 0, "max": 5 },
    { "name": "Cities",       "type": "number",  "min": 0, "max": 4 },
    { "name": "VP Dev Cards", "type": "number",  "min": 0, "max": 5 },
    { "name": "Longest Road", "type": "boolean", "value": 2 },
    { "name": "Largest Army", "type": "boolean", "value": 2 },
    { "name": "Other VP",     "type": "number",  "min": 0 }
  ]
}
```

### Hearts — `rounds`, lowest score wins

```json
{
  "id": "hearts",
  "name": "Hearts",
  "minPlayers": 4,
  "maxPlayers": 4,
  "style": "rounds",
  "scoring": "lowest",
  "rounds": { "label": "Hand", "maxRounds": null }
}
```

### Agricola — `lookup` scoring

```json
{
  "id": "agricola",
  "name": "Agricola",
  "minPlayers": 1,
  "maxPlayers": 5,
  "style": "categories",
  "scoring": "highest",
  "categories": [
    {
      "name": "Fields",
      "type": "lookup",
      "table": [
        { "max": 0,            "points": -1 },
        { "min": 1, "max": 1,  "points": 1  },
        { "min": 2, "max": 2,  "points": 2  },
        { "min": 3, "max": 3,  "points": 3  },
        { "min": 4,            "points": 4  }
      ]
    },
    { "name": "Unused Farmyard Spaces", "type": "number", "min": -13, "max": 0 },
    { "name": "Begging Cards",          "type": "number", "min": -30, "max": 0 }
  ]
}
```

---

## Custom games in-app

You can build a scoresheet without editing any JSON:

1. Go to **Browse → ＋ Create Custom Game**.
2. Fill in game name, player limits, and winner rule.
3. Choose *Categories* or *Rounds*.
4. Add categories / configure rounds.
5. Tap **✅ Save Game** to store it locally, or **⬇ Export Config** to save a `.json` file you can share or commit to the `sheets/` folder.

Custom games can also be imported from a JSON file via the **⬆** button in the Browse header.

---

## Backup and restore

All data (players, history, custom sheets) can be exported from the home screen via **⬇ Export Backup**. The resulting file can be re-imported on any device with **⬆ Import Backup**. Duplicate game records and players are skipped automatically during import.

---

## Project structure

```
ScoreKeeper/
├── index.html          # App shell
├── app.js              # All application logic (single file, no build step)
├── style.css           # Styles
├── manifest.json       # PWA manifest
├── sw.js               # Service worker (offline caching)
├── icons/              # App icons (192 × 192 and 512 × 512)
└── sheets/
    ├── index.json      # Game list (id, name, style)
    └── <id>.json       # One file per game
```

There is no build step. The app is plain HTML + CSS + JavaScript.
