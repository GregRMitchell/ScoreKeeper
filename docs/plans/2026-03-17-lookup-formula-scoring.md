# Lookup & Formula Scoring Types Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Extend the scoresheet JSON schema with two new category types — `"lookup"` (range table → points, e.g. Agricola sheep count) and `"formula"` (multi-input expression, e.g. Orleans citizens × dev level) — including full builder UI support and updated example sheets.

**Architecture:** All new logic is self-contained per category item (no cross-item references). `lookup` stores a scalar count; `formula` stores a `{ key: value }` object. Three shared utility functions (`lookupPoints`, `evalFormula`, `catScore`) centralize calculation, replacing the three duplicated `computeTotal` lambdas. The game builder gains two new editor panels (table-row editor for `lookup`, inputs-list editor for `formula`).

**Tech Stack:** Vanilla JS (ES2020), no build tools, no test framework. Single-file app (`app.js`). All state in `localStorage`.

---

## New Schema Reference

### `"type": "lookup"` — single numeric input mapped to points via a range table

```jsonc
{
  "name": "Sheep",
  "type": "lookup",
  "table": [
    { "max": 0,           "points": -1 },
    { "min": 1, "max": 3, "points": 1  },
    { "min": 4, "max": 5, "points": 2  },
    { "min": 6, "max": 7, "points": 3  },
    { "min": 8,           "points": 4  }
  ]
}
```

- `table` is an array of range rows; `min` and `max` are both optional (open-ended at either end).
- The first matching row wins (rows should be non-overlapping and exhaustive).
- Stored value in `state.scores[playerKey][catName]`: a plain number (the count entered).
- Contributes `lookupPoints(cat.table, count)` to the total.
- UI: one `<input type="number">` (the count) + a computed `= N pts` badge alongside it.

### `"type": "formula"` — multiple named inputs combined by an arithmetic expression

```jsonc
{
  "name": "Citizen VP",
  "type": "formula",
  "inputs": [
    { "label": "Citizens",  "key": "citizens", "min": 0 },
    { "label": "Dev Level", "key": "level",    "min": 0, "max": 5 }
  ],
  "formula": "citizens * level"
}
```

- `inputs`: array of `{ label, key, min?, max? }`. `key` is the variable name used in `formula`.
- `formula`: arithmetic expression string; supports `+`, `-`, `*`, `/`, parentheses, integer literals.
- Stored value in `state.scores[playerKey][catName]`: a plain object `{ citizens: 0, level: 0 }`.
- Contributes `evalFormula(cat.formula, storedObject)` to the total.
- UI: one `<input type="number">` per input (stacked), + a computed `= N pts` badge.

---

## State Storage Conventions

| Type      | Stored as                               | Default          |
|-----------|-----------------------------------------|------------------|
| `number`  | `number`                                | `0`              |
| `boolean` | `boolean`                               | `false`          |
| `lookup`  | `number` (the raw count)                | `0`              |
| `formula` | `object` keyed by `input.key`           | `{ k: 0, … }`   |

---

## Task 1: Core Scoring Utilities

**Files:**
- Modify: `app.js` — add utilities in the UTILITIES section (after `formatDate`, around line 55)

**What to add:**

```js
// Returns the point value for a lookup-type category given a raw count.
function lookupPoints(table, count) {
  const n = Number(count) || 0;
  const row = table.find(r =>
    (r.min == null || n >= r.min) && (r.max == null || n <= r.max)
  );
  return row ? row.points : 0;
}

// Evaluates a simple arithmetic formula string with named variables.
// Supports: + - * / ( ) and integer/decimal literals. Nothing else.
function evalFormula(formula, vars) {
  const expr = formula.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, (name) => {
    if (!(name in vars)) throw new Error(`Unknown variable: ${name}`);
    return String(Number(vars[name]) || 0);
  });
  // Only allow digits, whitespace, and arithmetic operators after substitution.
  if (!/^[\d\s+\-*/().]+$/.test(expr)) throw new Error('Invalid formula');
  // eslint-disable-next-line no-new-func
  return Number(new Function(`return (${expr})`)()) || 0;
}

// Returns the point contribution for one category given its stored value.
// Centralises the scoring logic used by computeTotal in three places.
function catScore(cat, val) {
  switch (cat.type) {
    case 'boolean': return val ? (cat.value || 0) : 0;
    case 'lookup':  return lookupPoints(cat.table || [], val);
    case 'formula': return evalFormula(cat.formula || '0', val || {});
    default:        return Number(val) || 0;
  }
}
```

**Step 1:** Add the three functions to `app.js` in the UTILITIES section (after line 50 or so, before `formatDate`).

**Step 2:** Open the app in a browser, open the console, and manually verify:
```js
lookupPoints([{max:0,points:-1},{min:1,max:3,points:1},{min:4,max:5,points:2},{min:6,max:7,points:3},{min:8,points:4}], 5)
// → 2
evalFormula('citizens * level', { citizens: 3, level: 4 })
// → 12
catScore({ type: 'lookup', table: [{max:0,points:-1},{min:8,points:4}] }, 10)
// → 4
```

**Step 3:** Commit
```
git add app.js
git commit -m "feat: add lookupPoints, evalFormula, catScore utilities

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 2: Replace Duplicated `computeTotal` Logic

There are **three** identical `computeTotal` lambdas in `app.js`. All three need to use `catScore` instead of the inline boolean/number ternary.

**Files:**
- Modify: `app.js` — lines 159, 764, 1015 (three `return sum + (cat.type === 'boolean' ? ...)` expressions)

**Current pattern (all three occurrences):**
```js
return sum + (cat.type === 'boolean' ? (val ? (cat.value || 0) : 0) : (Number(val) || 0));
```

**New pattern (replace all three):**
```js
return sum + catScore(cat, val);
```

**Step 1:** Find all three occurrences (lines ~159, ~764, ~1015) and apply the replacement.

**Step 2:** Reload the app. Open an existing game with `number` and `boolean` categories (e.g. Catan or Yahtzee). Verify totals still compute correctly before proceeding.

**Step 3:** Commit
```
git add app.js
git commit -m "refactor: use catScore helper in all three computeTotal lambdas

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: Game State Initialisation for New Types

The setup code that sets default values for `state.scores[p.key][cat.name]` is at **line 735**:

```js
state.scores[p.key][cat.name] = cat.type === 'boolean' ? false : 0;
```

**Files:**
- Modify: `app.js` — line 735

**New code:**
```js
if (cat.type === 'boolean') {
  state.scores[p.key][cat.name] = false;
} else if (cat.type === 'formula') {
  const defaults = {};
  (cat.inputs || []).forEach(inp => { defaults[inp.key] = 0; });
  state.scores[p.key][cat.name] = defaults;
} else {
  // 'number' and 'lookup' both store a scalar
  state.scores[p.key][cat.name] = 0;
}
```

**Step 1:** Replace line 735 with the block above.

**Step 2:** Verify existing games still initialise correctly by starting a new game with a `number`/`boolean` sheet (e.g. Catan). The default values should still be 0 and false.

**Step 3:** Commit
```
git add app.js
git commit -m "feat: initialise lookup and formula score defaults in game setup

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 4: Render `lookup` and `formula` Inputs in the Game View

The category row renderer is in `renderCategoriesGame`, starting at line 795. The current branching is:

```js
if (cat.type === 'boolean') {
  // checkbox
} else {
  // <input type="number">
}
```

**Files:**
- Modify: `app.js` — lines 803–826 (the if/else inside the per-player cell loop)

**New branching structure:**

```js
if (cat.type === 'boolean') {
  // --- existing checkbox code, unchanged ---
  const cb = el('input', { type: 'checkbox', class: 'score-checkbox', 'aria-label': `${p.name} — ${cat.name}` });
  cb.checked = val;
  cb.addEventListener('change', () => {
    state.scores[p.key][cat.name] = cb.checked;
    saveGameState(state);
    render();
  });
  cell.appendChild(cb);
  if (cat.value) cell.appendChild(el('span', { class: 'bool-value' }, `(${cat.value})`));

} else if (cat.type === 'lookup') {
  const input = el('input', {
    type: 'number', class: 'score-input', value: String(val),
    min: '0', 'aria-label': `${p.name} — ${cat.name}`,
  });
  const badge = el('span', { class: 'computed-pts' }, `= ${lookupPoints(cat.table || [], val)} pts`);
  input.addEventListener('change', () => {
    const count = Number(input.value) || 0;
    state.scores[p.key][cat.name] = count;
    badge.textContent = `= ${lookupPoints(cat.table || [], count)} pts`;
    saveGameState(state);
    render();
  });
  cell.appendChild(input);
  cell.appendChild(badge);

} else if (cat.type === 'formula') {
  const storedObj = val || {};
  (cat.inputs || []).forEach(inp => {
    const wrapper = el('div', { class: 'formula-input-row' });
    wrapper.appendChild(el('span', { class: 'formula-input-label' }, inp.label));
    const input = el('input', {
      type: 'number', class: 'score-input formula-input',
      value: String(storedObj[inp.key] ?? 0),
      min: inp.min != null ? String(inp.min) : '',
      max: inp.max != null ? String(inp.max) : '',
      'aria-label': `${p.name} — ${cat.name} — ${inp.label}`,
    });
    input.addEventListener('change', () => {
      storedObj[inp.key] = Number(input.value) || 0;
      state.scores[p.key][cat.name] = { ...storedObj };
      badge.textContent = `= ${evalFormula(cat.formula || '0', state.scores[p.key][cat.name])} pts`;
      saveGameState(state);
      render();
    });
    wrapper.appendChild(input);
    cell.appendChild(wrapper);
  });
  const badge = el('span', { class: 'computed-pts' }, `= ${evalFormula(cat.formula || '0', storedObj)} pts`);
  cell.appendChild(badge);

} else {
  // --- existing number input code, unchanged ---
  const input = el('input', {
    type: 'number', class: 'score-input', value: String(val),
    min: cat.min != null ? String(cat.min) : '',
    max: cat.max != null ? String(cat.max) : '',
    'aria-label': `${p.name} — ${cat.name}`,
  });
  input.addEventListener('change', () => {
    state.scores[p.key][cat.name] = Number(input.value) || 0;
    saveGameState(state);
    render();
  });
  cell.appendChild(input);
}
```

**Step 1:** Replace the if/else block at lines 803–826 with the four-branch version above.

**Step 2:** Add CSS for the new elements to `style.css`. Find the `.bool-value` style and add alongside it:

```css
.computed-pts {
  font-size: 0.75rem;
  color: var(--color-text-muted, #888);
  display: block;
  text-align: center;
  margin-top: 2px;
}

.formula-input-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
}

.formula-input-label {
  font-size: 0.7rem;
  color: var(--color-text-muted, #888);
  white-space: nowrap;
  min-width: 3rem;
}

.formula-input {
  width: 100%;
}
```

**Step 3:** Test manually by updating `agricola.json` temporarily with a single `lookup` category and `orleans.json` with a `formula` category (even by editing in browser devtools `localStorage`) to verify the UI renders and updates correctly.

**Step 4:** Commit
```
git add app.js style.css
git commit -m "feat: render lookup and formula category inputs in game view

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 5: History Results Display for New Types

The results/history view displays each category's value at **lines 1151–1163**. The current display logic:

```js
const display = cat.type === 'boolean'
  ? (val ? `✓ (${cat.value || 0})` : '—')
  : (val != null ? String(val) : '0');
```

**Files:**
- Modify: `app.js` — line 1157–1159

**New display logic:**
```js
let display;
if (cat.type === 'boolean') {
  display = val ? `✓ (${cat.value || 0})` : '—';
} else if (cat.type === 'lookup') {
  const pts = lookupPoints(cat.table || [], val);
  display = val != null ? `${val} → ${pts}pts` : '0';
} else if (cat.type === 'formula') {
  const pts = evalFormula(cat.formula || '0', val || {});
  const parts = (cat.inputs || []).map(inp => `${inp.label}: ${(val || {})[inp.key] ?? 0}`);
  display = parts.length ? `${parts.join(', ')} = ${pts}pts` : String(pts);
} else {
  display = val != null ? String(val) : '0';
}
```

**Step 1:** Replace lines 1157–1159 with the block above.

**Step 2:** Play and finish a game that uses `lookup` or `formula` categories, then check the history view to confirm values display sensibly.

**Step 3:** Commit
```
git add app.js
git commit -m "feat: display lookup and formula values in history results view

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 6: Update agricola.json with Lookup Tables

The current Agricola sheet has `Fields`, `Pastures`, `Grain`, `Vegetables`, `Sheep`, `Wild Boar`, and `Cattle` as plain `number` types where players manually enter the already-computed point value. Replace them with `lookup` types so players enter the actual count.

**Agricola scoring tables:**

| Resource | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8+ |
|----------|---|---|---|---|---|---|---|---|----|
| Fields   | −1 | 1 | 2 | 3 | 4 | 4 | 4 | 4 | 4  |
| Pastures | −1 | 1 | 2 | 3 | 4 | 4 | 4 | 4 | 4  |
| Grain    | −1 | 1 | 2 | 3 | 4 | 4 | 4 | 4 | 4  |
| Vegetables | −1 | 1 | 2 | 3 | 4 | 4 | 4 | 4 | 4 |
| Sheep    | −1 | 1 | 1 | 1 | 2 | 2 | 3 | 3 | 4  |
| Wild Boar | −1 | 1 | 1 | 2 | 2 | 3 | 3 | 4 | 4 |
| Cattle   | −1 | 1 | 2 | 2 | 3 | 3 | 4 | 4 | 4  |

Note: Fields/Pastures/Grain/Vegetables all follow the same simple 1-per pattern capped at 4.

**Files:**
- Modify: `sheets/agricola.json`

**New categories array (replacing the first 7 entries):**
```json
[
  { "name": "Fields",    "type": "lookup", "table": [{"max":0,"points":-1},{"min":1,"max":1,"points":1},{"min":2,"max":2,"points":2},{"min":3,"max":3,"points":3},{"min":4,"points":4}] },
  { "name": "Pastures",  "type": "lookup", "table": [{"max":0,"points":-1},{"min":1,"max":1,"points":1},{"min":2,"max":2,"points":2},{"min":3,"max":3,"points":3},{"min":4,"points":4}] },
  { "name": "Grain",     "type": "lookup", "table": [{"max":0,"points":-1},{"min":1,"max":1,"points":1},{"min":2,"max":2,"points":2},{"min":3,"max":3,"points":3},{"min":4,"points":4}] },
  { "name": "Vegetables","type": "lookup", "table": [{"max":0,"points":-1},{"min":1,"max":1,"points":1},{"min":2,"max":2,"points":2},{"min":3,"max":3,"points":3},{"min":4,"points":4}] },
  { "name": "Sheep",     "type": "lookup", "table": [{"max":0,"points":-1},{"min":1,"max":3,"points":1},{"min":4,"max":5,"points":2},{"min":6,"max":7,"points":3},{"min":8,"points":4}] },
  { "name": "Wild Boar", "type": "lookup", "table": [{"max":0,"points":-1},{"min":1,"max":2,"points":1},{"min":3,"max":4,"points":2},{"min":5,"max":6,"points":3},{"min":7,"points":4}] },
  { "name": "Cattle",    "type": "lookup", "table": [{"max":0,"points":-1},{"min":1,"max":1,"points":1},{"min":2,"max":3,"points":2},{"min":4,"max":5,"points":3},{"min":6,"points":4}] }
]
```

Keep the remaining categories unchanged:
- `Unused Farmyard Spaces` (number, min: -13, max: 0)
- `Fenced Stables` (number, min: 0, max: 4)
- `House Rooms` (number, min: 0, max: 10)
- `Family Members` (number, min: 6, max: 15)
- `Improvements` (number, min: 0, max: 30)
- `Bonus Points` (number, min: 0, max: 30)
- `Begging Cards` (number, min: -30, max: 0)

**Step 1:** Update `sheets/agricola.json`.

**Step 2:** Start a new Agricola game in the app. Enter sheep counts and verify the `= N pts` badge updates correctly. Try: 0 sheep → −1, 1 sheep → 1, 5 sheep → 2, 8 sheep → 4.

**Step 3:** Commit
```
git add sheets/agricola.json
git commit -m "feat: update Agricola sheet with lookup tables for animal/crop scoring

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 7: Update orleans.json with Formula Category

The current Orléans sheet has `Citizen Tiles` and `Development Track` as separate `number` entries. In the game, citizen bonus VP = citizens × development track level. Replace these two entries with a single `formula` category that takes both as inputs.

**Files:**
- Modify: `sheets/orleans.json`

**Remove** these two entries:
```json
{ "name": "Citizen Tiles",    "type": "number", "min": 0, "max": 10 },
{ "name": "Development Track","type": "number", "min": 0, "max": 20 }
```

**Add** this one entry in their place:
```json
{
  "name": "Citizen Bonus",
  "type": "formula",
  "inputs": [
    { "label": "Citizens",   "key": "citizens", "min": 0, "max": 10 },
    { "label": "Dev Level",  "key": "level",    "min": 0, "max": 20 }
  ],
  "formula": "citizens * level"
}
```

**Step 1:** Update `sheets/orleans.json`.

**Step 2:** Start a new Orléans game. Enter `citizens: 3, level: 4` and verify badge shows `= 12 pts`. Verify total changes accordingly.

**Step 3:** Commit
```
git add sheets/orleans.json
git commit -m "feat: update Orléans sheet with formula category for citizen bonus VP

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 8: Builder UI — Add `lookup` and `formula` Type Options

The game builder type `<select>` currently has only `Number` and `Checkbox` options (lines 1400–1401). Add `Lookup Table` and `Formula`.

**Files:**
- Modify: `app.js` — lines 1399–1441 (the `renderCatRows` type selector + per-type fields)

### Step 1: Add options to the type `<select>` (lines 1400–1401)

```js
typeSelect.appendChild(el('option', { value: 'number' },  'Number'));
typeSelect.appendChild(el('option', { value: 'boolean' }, 'Checkbox'));
typeSelect.appendChild(el('option', { value: 'lookup' },  'Lookup Table'));
typeSelect.appendChild(el('option', { value: 'formula' }, 'Formula'));
```

### Step 2: Update the type-change handler (line 1403–1407)

```js
typeSelect.addEventListener('change', () => {
  cat.type = typeSelect.value;
  if (cat.type === 'boolean') {
    delete cat.min; delete cat.max; delete cat.table; delete cat.inputs; delete cat.formula;
    if (cat.value == null) cat.value = 1;
  } else if (cat.type === 'number') {
    delete cat.value; delete cat.table; delete cat.inputs; delete cat.formula;
  } else if (cat.type === 'lookup') {
    delete cat.value; delete cat.min; delete cat.max; delete cat.inputs; delete cat.formula;
    if (!cat.table) cat.table = [{ points: 0 }];
  } else if (cat.type === 'formula') {
    delete cat.value; delete cat.min; delete cat.max; delete cat.table;
    if (!cat.inputs) cat.inputs = [{ label: '', key: 'a' }, { label: '', key: 'b' }];
    if (!cat.formula) cat.formula = 'a * b';
  }
  renderCatRows();
});
```

### Step 3: Add lookup table editor panel (in the if/else block after line 1411)

After the existing `boolean` and `else` (number) branches, add:

```js
} else if (cat.type === 'lookup') {
  const tableWrap = el('div', { class: 'lookup-table-editor' });

  function renderTableRows() {
    tableWrap.innerHTML = '';
    (cat.table || []).forEach((row, ri) => {
      const tr = el('div', { class: 'lookup-row' });

      tr.appendChild(el('span', { class: 'cat-opt-label' }, 'Min'));
      const minIn = el('input', {
        type: 'number', class: 'cat-opt-input', placeholder: '—',
        value: row.min != null ? String(row.min) : '', 'aria-label': 'Range min',
      });
      minIn.addEventListener('input', () => {
        const v = minIn.value.trim();
        if (v === '') delete row.min; else row.min = Number(v);
      });
      tr.appendChild(minIn);

      tr.appendChild(el('span', { class: 'cat-opt-label' }, 'Max'));
      const maxIn = el('input', {
        type: 'number', class: 'cat-opt-input', placeholder: '—',
        value: row.max != null ? String(row.max) : '', 'aria-label': 'Range max',
      });
      maxIn.addEventListener('input', () => {
        const v = maxIn.value.trim();
        if (v === '') delete row.max; else row.max = Number(v);
      });
      tr.appendChild(maxIn);

      tr.appendChild(el('span', { class: 'cat-opt-label' }, 'Pts'));
      const ptsIn = el('input', {
        type: 'number', class: 'cat-opt-input', placeholder: '0',
        value: row.points != null ? String(row.points) : '0', 'aria-label': 'Points',
      });
      ptsIn.addEventListener('input', () => { row.points = Number(ptsIn.value) || 0; });
      tr.appendChild(ptsIn);

      tr.appendChild(el('button', {
        type: 'button', class: 'btn-icon-sm', 'aria-label': 'Remove row',
        onclick: () => { cat.table.splice(ri, 1); renderTableRows(); },
      }, '✕'));

      tableWrap.appendChild(tr);
    });

    tableWrap.appendChild(el('button', {
      type: 'button', class: 'btn btn-ghost btn-sm',
      onclick: () => { cat.table.push({ points: 0 }); renderTableRows(); },
    }, '+ Add Range'));
  }

  renderTableRows();
  row.appendChild(tableWrap);

} else if (cat.type === 'formula') {
  const formulaWrap = el('div', { class: 'formula-editor' });

  // Formula string input
  const fLabel = el('span', { class: 'cat-opt-label' }, 'Formula');
  const fInput = el('input', {
    type: 'text', class: 'cat-name-input formula-expr-input', placeholder: 'e.g. a * b',
    value: cat.formula || '', 'aria-label': 'Formula expression',
  });
  fInput.addEventListener('input', () => { cat.formula = fInput.value; });
  formulaWrap.appendChild(fLabel);
  formulaWrap.appendChild(fInput);

  // Inputs list
  const inputsWrap = el('div', { class: 'formula-inputs-editor' });

  function renderFormulaInputs() {
    inputsWrap.innerHTML = '';
    (cat.inputs || []).forEach((inp, ii) => {
      const iRow = el('div', { class: 'formula-inp-row' });

      const labelIn = el('input', {
        type: 'text', class: 'cat-name-input', placeholder: 'Label…',
        value: inp.label || '', 'aria-label': 'Input label',
      });
      labelIn.addEventListener('input', () => { inp.label = labelIn.value; });
      iRow.appendChild(labelIn);

      iRow.appendChild(el('span', { class: 'cat-opt-label' }, 'Key'));
      const keyIn = el('input', {
        type: 'text', class: 'cat-opt-input', placeholder: 'a',
        value: inp.key || '', 'aria-label': 'Variable key',
      });
      keyIn.addEventListener('input', () => { inp.key = keyIn.value.replace(/\W/g, ''); });
      iRow.appendChild(keyIn);

      iRow.appendChild(el('span', { class: 'cat-opt-label' }, 'Min'));
      const minIn = el('input', {
        type: 'number', class: 'cat-opt-input', placeholder: '—',
        value: inp.min != null ? String(inp.min) : '', 'aria-label': 'Min',
      });
      minIn.addEventListener('input', () => {
        const v = minIn.value.trim();
        if (v === '') delete inp.min; else inp.min = Number(v);
      });
      iRow.appendChild(minIn);

      iRow.appendChild(el('button', {
        type: 'button', class: 'btn-icon-sm', 'aria-label': 'Remove input',
        onclick: () => { cat.inputs.splice(ii, 1); renderFormulaInputs(); },
      }, '✕'));

      inputsWrap.appendChild(iRow);
    });

    inputsWrap.appendChild(el('button', {
      type: 'button', class: 'btn btn-ghost btn-sm',
      onclick: () => { cat.inputs.push({ label: '', key: `x${cat.inputs.length}` }); renderFormulaInputs(); },
    }, '+ Add Input'));
  }

  renderFormulaInputs();
  formulaWrap.appendChild(inputsWrap);
  row.appendChild(formulaWrap);
```

### Step 4: Add builder-specific CSS to `style.css`

```css
.lookup-table-editor,
.formula-editor {
  width: 100%;
  margin-top: 6px;
}

.lookup-row,
.formula-inp-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}

.formula-expr-input {
  flex: 1;
  min-width: 8rem;
}

.formula-inputs-editor {
  margin-top: 6px;
}

.btn-sm {
  font-size: 0.75rem;
  padding: 2px 8px;
}
```

### Step 5: Update `buildSheet()` to serialise the new types (lines 1528–1534)

```js
sheet.categories = state.categories.map(c => {
  const cat = { name: c.name.trim(), type: c.type };
  if (c.type === 'boolean') {
    cat.value = c.value != null ? c.value : 1;
  } else if (c.type === 'number') {
    if (c.min !== undefined) cat.min = c.min;
    if (c.max !== undefined) cat.max = c.max;
  } else if (c.type === 'lookup') {
    cat.table = (c.table || []).map(r => {
      const row = { points: r.points || 0 };
      if (r.min != null) row.min = r.min;
      if (r.max != null) row.max = r.max;
      return row;
    });
  } else if (c.type === 'formula') {
    cat.inputs  = (c.inputs || []).map(inp => {
      const i = { label: inp.label || '', key: inp.key || 'x' };
      if (inp.min != null) i.min = inp.min;
      if (inp.max != null) i.max = inp.max;
      return i;
    });
    cat.formula = c.formula || '0';
  }
  return cat;
});
```

### Step 6: Update `validate()` to check new types (around line 1549)

Add after the unnamed-category check:
```js
const badLookup = state.categories.findIndex(
  c => c.type === 'lookup' && (!Array.isArray(c.table) || c.table.length === 0)
);
if (badLookup >= 0) {
  alert(`Category "${state.categories[badLookup].name}" needs at least one range row.`);
  return false;
}
const badFormula = state.categories.findIndex(
  c => c.type === 'formula' && (!c.formula || !c.inputs?.length)
);
if (badFormula >= 0) {
  alert(`Category "${state.categories[badFormula].name}" needs a formula and at least one input.`);
  return false;
}
```

### Step 7: Test the builder

1. Create a new custom game with a `Lookup Table` category. Add 3 range rows. Save, start a game, verify it works.
2. Create a new custom game with a `Formula` category. Enter 2 inputs and a formula like `a * b`. Save, start, verify.
3. Edit an existing custom game — verify existing type data is preserved on load.

### Step 8: Commit
```
git add app.js style.css
git commit -m "feat: add lookup and formula type editors to the game builder UI

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 9: Update Schema Documentation in app.js

The schema reference comment at the top of `app.js` (lines 7–32) only documents `number` and `boolean`. Update it to include the new types.

**Files:**
- Modify: `app.js` — lines 7–32 (the `/** Score sheet schema reference: */` comment block)

Add after the existing `boolean` example in the categories section:

```js
 *     { "name": "Sheep", "type": "lookup",
 *       "table": [
 *         { "max": 0, "points": -1 },
 *         { "min": 1, "max": 3, "points": 1 },
 *         { "min": 8, "points": 4 }
 *       ] },
 *     { "name": "Citizen VP", "type": "formula",
 *       "inputs": [
 *         { "label": "Citizens", "key": "citizens", "min": 0 },
 *         { "label": "Dev Level", "key": "level", "min": 0, "max": 5 }
 *       ],
 *       "formula": "citizens * level" }
```

**Step 1:** Update the comment block.

**Step 2:** Commit
```
git add app.js
git commit -m "docs: update schema reference comment with lookup and formula types

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Summary of All Changed Files

| File | Change |
|------|--------|
| `app.js` | +utilities, +init logic, +render branches, +history display, +builder UI, +buildSheet, +validate, +docs |
| `style.css` | +`.computed-pts`, `.formula-input-row`, `.formula-input-label`, `.lookup-table-editor`, `.formula-editor`, etc. |
| `sheets/agricola.json` | Fields/Pastures/Grain/Vegetables/Sheep/Wild Boar/Cattle → `lookup` type |
| `sheets/orleans.json` | Citizen Tiles + Development Track → single `formula` category |

## Key Gotchas

- **evalFormula uses `new Function()`** — this is safe here because the substituted expression contains only digits and operators (guarded by the regex check). No user-provided text reaches `new Function` after substitution.
- **formula `val` may be `null`** in history records from before this feature — `val || {}` handles this everywhere.
- **lookup `val` is a plain number** (like `type: "number"`) — no object destructuring needed. The score displayed in results is `count → Npts`.
- **Builder loads existing custom sheet data** — the `game-builder` view already loads `cat` objects from the saved sheet; the new `lookup`/`formula` fields will be present on the object automatically if the sheet was created with these types.
- **Service worker cache** — after changes to `sheets/agricola.json` and `sheets/orleans.json`, increment the cache version in `sw.js` to bust cached JSON responses.
