'use strict';

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Score sheet schema reference:
 *
 * Categories style (e.g. Catan):
 * {
 *   "id": "catan", "name": "Catan",
 *   "minPlayers": 2, "maxPlayers": 6,
 *   "style": "categories", "scoring": "highest",
 *   "categories": [
 *     { "name": "Settlements", "type": "number", "min": 0, "max": 5 },
 *     { "name": "Longest Road", "type": "boolean", "value": 2 }
 *   ]
 * }
 *
 * Rounds style (e.g. Scrabble):
 * {
 *   "id": "scrabble", "name": "Scrabble",
 *   "minPlayers": 2, "maxPlayers": 4,
 *   "style": "rounds", "scoring": "highest",
 *   "rounds": { "label": "Turn", "maxRounds": null }
 * }
 *
 * All sheet definitions live in the ./sheets/ folder:
 *   sheets/index.json  — array of { id, name, style }
 *   sheets/<id>.json   — full score sheet definition
 */

const SK = {
  PLAYERS:       'sk_players',
  GAME_STATE:    'sk_game_state',
  HISTORY:       'sk_history',
  CUSTOM_SHEETS: 'sk_custom_sheets',
};

// ============================================================
// UTILITIES
// ============================================================

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Create a DOM element with attributes and children. */
function el(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class')   { element.className = v; }
    else if (k === 'html')    { element.innerHTML = v; }
    else if (k.startsWith('on') && typeof v === 'function') {
      element.addEventListener(k.slice(2).toLowerCase(), v);
    } else {
      element.setAttribute(k, v);
    }
  }
  for (const child of children) {
    if (child == null) continue;
    element.appendChild(typeof child === 'string'
      ? document.createTextNode(child)
      : child);
  }
  return element;
}

// ============================================================
// DATA LAYER
// ============================================================

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// --- Players ---

function getPlayers() {
  return load(SK.PLAYERS, []);
}

function savePlayers(players) {
  save(SK.PLAYERS, players);
}

function addSavedPlayer(name) {
  const players = getPlayers();
  const existing = players.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const player = { id: uid(), name: name.trim(), plays: 0 };
  players.push(player);
  savePlayers(players);
  return player;
}

function updateSavedPlayer(id, updates) {
  savePlayers(getPlayers().map(p => p.id === id ? { ...p, ...updates } : p));
}

function deleteSavedPlayer(id) {
  savePlayers(getPlayers().filter(p => p.id !== id));
}

function incrementPlayCounts(playerIds) {
  const idSet = new Set(playerIds);
  const players = getPlayers();
  players.forEach(p => { if (idSet.has(p.id)) p.plays++; });
  savePlayers(players);
}

function sortedPlayers() {
  return [...getPlayers()].sort((a, b) => b.plays - a.plays);
}

// --- Game State ---

function getGameState() {
  return load(SK.GAME_STATE, null);
}

function saveGameState(state) {
  save(SK.GAME_STATE, state);
}

function clearGameState() {
  localStorage.removeItem(SK.GAME_STATE);
}

// --- History ---

function getHistory() {
  return load(SK.HISTORY, []);
}

function saveHistory(history) {
  save(SK.HISTORY, history);
}

function addToHistory(state) {
  const sheet = state.sheet;

  const computeTotal = (key) => {
    if (sheet.style === 'categories') {
      return (sheet.categories || []).reduce((sum, cat) => {
        const val = (state.scores[key] || {})[cat.name];
        return sum + (cat.type === 'boolean' ? (val ? (cat.value || 0) : 0) : (Number(val) || 0));
      }, 0);
    }
    return (state.rounds || []).reduce((sum, round) => sum + (Number(round[key]) || 0), 0);
  };

  const totals = state.players
    .map(p => ({ name: p.name, key: p.key, total: computeTotal(p.key) }))
    .sort((a, b) => sheet.scoring === 'lowest' ? a.total - b.total : b.total - a.total);

  const topScore = totals[0]?.total;
  const winners  = totals.filter(t => t.total === topScore).map(t => t.name);

  const record = {
    id:         uid(),
    sheetId:    sheet.id,
    sheetName:  sheet.name,
    sheetStyle: sheet.style,
    scoring:    sheet.scoring,
    players:    state.players,
    scores:     state.scores  || {},
    rounds:     state.rounds  || [],
    categories: sheet.categories || [],
    roundLabel: sheet.rounds?.label || 'Round',
    totals,
    winners,
    startedAt:  state.startedAt,
    finishedAt: Date.now(),
  };

  const history = getHistory();
  history.unshift(record);
  saveHistory(history);
  return record;
}

function deleteHistoryEntry(id) {
  saveHistory(getHistory().filter(r => r.id !== id));
}

function getSheetPlayCounts() {
  const counts = {};
  getHistory().forEach(r => {
    counts[r.sheetId] = (counts[r.sheetId] || 0) + 1;
  });
  return counts;
}

// --- Custom Sheets ---

function getCustomSheets() {
  return load(SK.CUSTOM_SHEETS, []);
}

function saveCustomSheet(sheet) {
  const sheets = getCustomSheets();
  const idx = sheets.findIndex(s => s.id === sheet.id);
  if (idx >= 0) sheets[idx] = sheet;
  else sheets.push(sheet);
  save(SK.CUSTOM_SHEETS, sheets);
}

function deleteCustomSheet(id) {
  save(SK.CUSTOM_SHEETS, getCustomSheets().filter(s => s.id !== id));
}

// ============================================================
// SHEETS SERVICE
// Fetches sheet definitions from the ./sheets/ folder.
// On first load the service worker caches all JSON files,
// making the app fully offline-capable after that.
// To add a game: drop a new <id>.json in sheets/ and add an
// entry to sheets/index.json.
// ============================================================

async function fetchSheetsIndex() {
  const res = await fetch('./sheets/index.json');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const builtIn = await res.json();
  const custom = getCustomSheets().map(s => ({ id: s.id, name: s.name, style: s.style, custom: true }));
  const counts  = getSheetPlayCounts();
  return [...builtIn, ...custom]
    .map(s => ({ ...s, plays: counts[s.id] || 0 }))
    .sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name));
}

async function fetchSheet(id) {
  const custom = getCustomSheets().find(s => s.id === id);
  if (custom) return custom;
  const res = await fetch(`./sheets/${id}.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ============================================================
// VIEW ENGINE
// ============================================================

const _views = {};

function registerView(name, renderFn) {
  _views[name] = renderFn;
}

function showView(name, params = {}, pushState = true) {
  const fn = _views[name];
  if (!fn) { console.error('Unknown view:', name); return; }
  if (pushState) {
    history.pushState({ view: name, params }, '', `#${name}`);
  }
  const app = document.getElementById('app');
  app.innerHTML = '';
  const result = fn(params);
  if (result) app.appendChild(result);
}

function navigate(name, params = {}) {
  showView(name, params, true);
}

function back() {
  history.back();
}

// ============================================================
// EXPORT / IMPORT  (full backup — players + history)
// ============================================================

function exportAll() {
  const data = {
    version:      2,
    exportedAt:   new Date().toISOString(),
    players:      getPlayers(),
    history:      getHistory(),
    customSheets: getCustomSheets(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = el('a', { href: url, download: `scorekeeper-backup-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  URL.revokeObjectURL(url);
}

function importAll(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if ((data.version === 1 || data.version === 2) && Array.isArray(data.history)) {
          const existingIds = new Set(getHistory().map(r => r.id));
          const newEntries  = data.history.filter(r => !existingIds.has(r.id));
          const merged      = [...newEntries, ...getHistory()]
            .sort((a, b) => b.finishedAt - a.finishedAt);
          saveHistory(merged);
          if (Array.isArray(data.players)) {
            const existing      = getPlayers();
            const existingNames = new Set(existing.map(p => p.name.toLowerCase()));
            const newPlayers    = data.players.filter(p => !existingNames.has(p.name.toLowerCase()));
            savePlayers([...existing, ...newPlayers]);
          }
          if (Array.isArray(data.customSheets)) {
            const existing   = getCustomSheets();
            const existingIds = new Set(existing.map(s => s.id));
            const newSheets  = data.customSheets.filter(s => !existingIds.has(s.id));
            save(SK.CUSTOM_SHEETS, [...existing, ...newSheets]);
          }
          resolve(newEntries.length);
        } else {
          throw new Error('Unrecognized file. Please import a ScoreKeeper backup.');
        }
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}

// ============================================================
// SHARED COMPONENTS
// ============================================================

function renderHeader(title, { showBack = false, showHome = false, rightEl = null } = {}) {
  const header = el('header', { class: 'app-header' });

  if (showBack) {
    header.appendChild(el('button', {
      class: 'btn-icon', onclick: back, 'aria-label': 'Back',
    }, '←'));
  } else {
    header.appendChild(el('span', { class: 'header-spacer' }));
  }

  header.appendChild(el('h1', { class: 'header-title' }, title));

  if (rightEl) {
    header.appendChild(rightEl);
  } else if (showHome) {
    header.appendChild(el('button', {
      class: 'btn-icon', onclick: () => navigate('home'), 'aria-label': 'Home',
    }, '🏠'));
  } else {
    header.appendChild(el('span', { class: 'header-spacer' }));
  }

  return header;
}

// ============================================================
// HOME VIEW
// ============================================================

registerView('home', () => {
  const state  = getGameState();
  const frag   = document.createDocumentFragment();
  const header = el('header', { class: 'app-header' });
  header.appendChild(el('button', {
    class: 'btn-icon', onclick: () => navigate('history'), 'aria-label': 'History',
  }, '🕓'));
  header.appendChild(el('h1',  { class: 'header-title' }, '🎲 ScoreKeeper'));
  header.appendChild(el('button', {
    class: 'btn-icon', onclick: () => navigate('players'), 'aria-label': 'Manage Players',
  }, '👥'));
  frag.appendChild(header);

  const main = el('main', { class: 'view-home' });

  if (state) {
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card-label' }, 'Game in progress'));
    card.appendChild(el('div', { class: 'card-title' }, state.sheet.name));
    card.appendChild(el('div', { class: 'card-subtitle' }, state.players.map(p => p.name).join(', ')));
    card.appendChild(el('button', {
      class: 'btn btn-primary btn-full', onclick: () => navigate('game'),
    }, 'Resume Game'));
    card.appendChild(el('button', {
      class: 'btn btn-danger btn-full',
      onclick: () => {
        if (confirm('Abandon this game? This cannot be undone.')) {
          clearGameState();
          navigate('home');
        }
      },
    }, 'Abandon Game'));
    main.appendChild(card);
  } else {
    const card = el('div', { class: 'card card-new' });
    card.appendChild(el('div', { class: 'home-logo' }, '🎲'));
    card.appendChild(el('div', { class: 'card-title' }, 'Ready to play?'));
    card.appendChild(el('button', {
      class: 'btn btn-primary btn-full', onclick: () => navigate('browse'),
    }, '+ New Game'));
    main.appendChild(card);
  }

  // Backup / restore row
  const backupRow  = el('div', { class: 'backup-row' });

  backupRow.appendChild(el('button', {
    class: 'btn btn-ghost backup-btn',
    onclick: exportAll,
  }, '⬇ Export Backup'));

  const importLabel = el('label', { class: 'btn btn-ghost backup-btn' }, '⬆ Import Backup');
  const importInput = el('input', { type: 'file', accept: '.json' });
  importInput.style.display = 'none';
  importInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const count = await importAll(file);
      alert(`Import complete — ${count} new game${count !== 1 ? 's' : ''} added.`);
      navigate('home');
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
  });
  importLabel.appendChild(importInput);
  backupRow.appendChild(importLabel);

  main.appendChild(backupRow);
  frag.appendChild(main);
  return frag;
});

// ============================================================
// BROWSE VIEW
// ============================================================

registerView('browse', () => {
  const frag = document.createDocumentFragment();

  // Header: Import Game button on the right
  const importLabel = el('label', {
    class: 'btn-icon', title: 'Import game config', 'aria-label': 'Import game config',
  }, '⬆');
  const importInput = el('input', { type: 'file', accept: '.json' });
  importInput.style.display = 'none';
  importInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const sheet = JSON.parse(ev.target.result);
        if (sheet.version === 1 || sheet.version === 2) {
          throw new Error('This looks like a full backup. Use "Import Backup" on the Home screen instead.');
        }
        if (!sheet.name || !sheet.style || !sheet.scoring) {
          throw new Error('Not a valid ScoreKeeper game config file.');
        }
        if (sheet.style === 'categories' && !Array.isArray(sheet.categories)) {
          throw new Error('Categories config must include a "categories" array.');
        }
        if (sheet.style === 'rounds' && !sheet.rounds) {
          throw new Error('Rounds config must include a "rounds" object.');
        }
        const customs = getCustomSheets();
        const existingIdx = customs.findIndex(s => s.id === sheet.id);
        if (existingIdx >= 0) {
          if (!confirm(`"${sheet.name}" already exists in your custom games. Replace it?`)) {
            importInput.value = '';
            return;
          }
        } else {
          sheet.id = 'custom_' + uid();
        }
        saveCustomSheet(sheet);
        importInput.value = '';
        navigate('browse');
      } catch (err) {
        alert(`Import failed: ${err.message}`);
        importInput.value = '';
      }
    };
    reader.readAsText(file);
  });
  importLabel.appendChild(importInput);

  frag.appendChild(renderHeader('Choose a Game', { showBack: true, rightEl: importLabel }));

  const main = el('main', { class: 'view-browse' });
  frag.appendChild(main);

  function buildCard(entry, container) {
    const card = el('div', { class: 'sheet-card', role: 'button', tabindex: '0' });

    const cardMain = el('div', { class: 'sheet-card-main' });
    cardMain.appendChild(el('span', { class: 'sheet-name' }, entry.name));
    if (entry.plays > 0) {
      cardMain.appendChild(el('span', { class: 'sheet-plays' },
        `${entry.plays} play${entry.plays !== 1 ? 's' : ''}`));
    }
    card.appendChild(cardMain);

    const cardRight = el('div', { class: 'sheet-card-right' });
    cardRight.appendChild(el('span', {
      class: `sheet-badge badge-${entry.custom ? 'custom' : entry.style}`,
    }, entry.custom ? 'custom' : entry.style));

    if (entry.custom) {
      cardRight.appendChild(el('button', {
        type: 'button', class: 'btn-icon-sm', title: 'Edit', 'aria-label': `Edit ${entry.name}`,
        onclick: (e) => { e.stopPropagation(); navigate('game-builder', { sheetId: entry.id }); },
      }, '✏'));
    }
    card.appendChild(cardRight);

    const pick = async () => {
      card.classList.add('loading');
      try {
        const sheet = await fetchSheet(entry.id);
        navigate('setup', { sheet });
      } catch (err) {
        alert(`Could not load "${entry.name}": ${err.message}`);
        card.classList.remove('loading');
      }
    };
    card.addEventListener('click', pick);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
    });
    container.appendChild(card);
  }

  const section   = el('section', { class: 'browse-section' });
  const status    = el('div', { class: 'status-bar' });
  const createBtn = el('button', {
    type: 'button', class: 'btn btn-secondary',
    onclick: () => navigate('game-builder'),
  }, '＋ Create Custom Game');
  const sheetList = el('div', { class: 'sheet-list' });

  section.appendChild(status);
  section.appendChild(createBtn);
  section.appendChild(sheetList);
  main.appendChild(section);

  fetchSheetsIndex()
    .then(index => index.forEach(entry => buildCard(entry, sheetList)))
    .catch(err => {
      status.appendChild(el('div', { class: 'error-msg' },
        el('strong', {}, '⚠ Could not load sheets.'),
        el('br'),
        el('small', {}, err.message)));
    });

  return frag;
});

// ============================================================
// SETUP VIEW
// ============================================================

registerView('setup', ({ sheet }) => {
  const frag = document.createDocumentFragment();
  frag.appendChild(renderHeader(`Setup: ${sheet.name}`, { showBack: true }));

  const main = el('main', { class: 'view-setup' });

  /** @type {Array<{name: string, savedId: string|null}>} */
  let selected = [];

  // ---- Saved player chips ----
  const pickerSection = el('section', { class: 'setup-section' });
  pickerSection.appendChild(el('h2', {}, 'Saved Players'));
  const chipsContainer = el('div', { class: 'player-chips' });
  pickerSection.appendChild(chipsContainer);

  const renderChips = () => {
    chipsContainer.innerHTML = '';
    const players = sortedPlayers();
    if (players.length === 0) {
      chipsContainer.appendChild(el('span', { class: 'hint' }, 'No saved players yet — add one below.'));
      return;
    }
    players.forEach(p => {
      const isAdded = selected.some(s => s.savedId === p.id);
      const chip = el('button', {
        class: `chip ${isAdded ? 'chip-selected' : ''}`,
        'aria-pressed': String(isAdded),
        onclick: () => {
          if (isAdded) {
            selected = selected.filter(s => s.savedId !== p.id);
          } else {
            selected.push({ name: p.name, savedId: p.id });
          }
          renderChips();
          renderSelected();
        },
      },
      p.name,
      el('span', { class: 'chip-count' }, String(p.plays)));
      chipsContainer.appendChild(chip);
    });
  };
  main.appendChild(pickerSection);

  // ---- Ad-hoc player input ----
  const adHocSection = el('section', { class: 'setup-section' });
  adHocSection.appendChild(el('h2', {}, 'Add Player'));
  const adHocRow    = el('div', { class: 'adhoc-row' });
  const nameInput   = el('input', { type: 'text', class: 'input-text', placeholder: 'Player name…', 'aria-label': 'Player name' });
  const cbId        = 'save-player-cb-' + uid();
  const saveCheckbox = el('input', { type: 'checkbox', id: cbId });
  const saveLabel   = el('label', { for: cbId }, 'Save');
  const addBtn      = el('button', { class: 'btn btn-secondary' }, 'Add');

  addBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) return;
    let savedId = null;
    if (saveCheckbox.checked) {
      savedId = addSavedPlayer(name).id;
    }
    selected.push({ name, savedId });
    nameInput.value = '';
    nameInput.focus();
    renderChips();
    renderSelected();
  });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBtn.click(); });

  adHocRow.appendChild(nameInput);
  adHocRow.appendChild(saveCheckbox);
  adHocRow.appendChild(saveLabel);
  adHocRow.appendChild(addBtn);
  adHocSection.appendChild(adHocRow);
  main.appendChild(adHocSection);

  // ---- Selected players ----
  const selectedSection = el('section', { class: 'setup-section' });
  selectedSection.appendChild(el('h2', {}, 'Players in Game'));
  const selectedList = el('ol', { class: 'selected-players' });
  selectedSection.appendChild(selectedList);
  main.appendChild(selectedSection);

  const renderSelected = () => {
    selectedList.innerHTML = '';
    if (selected.length === 0) {
      selectedList.appendChild(el('li', { class: 'hint' }, 'No players added yet.'));
      return;
    }
    selected.forEach((p, i) => {
      const li      = el('li', { class: 'selected-player-item' });
      const actions = el('span', { class: 'player-actions' });

      if (i > 0) {
        actions.appendChild(el('button', { class: 'btn-icon-sm', 'aria-label': 'Move up', onclick: () => {
          [selected[i - 1], selected[i]] = [selected[i], selected[i - 1]];
          renderSelected(); renderChips();
        }}, '↑'));
      }
      if (i < selected.length - 1) {
        actions.appendChild(el('button', { class: 'btn-icon-sm', 'aria-label': 'Move down', onclick: () => {
          [selected[i], selected[i + 1]] = [selected[i + 1], selected[i]];
          renderSelected(); renderChips();
        }}, '↓'));
      }
      actions.appendChild(el('button', { class: 'btn-icon-sm btn-remove', 'aria-label': `Remove ${p.name}`, onclick: () => {
        selected.splice(i, 1);
        renderSelected(); renderChips();
      }}, '✕'));

      li.appendChild(el('span', { class: 'player-name' }, p.name));
      li.appendChild(actions);
      selectedList.appendChild(li);
    });
  };

  renderChips();
  renderSelected();

  // ---- Start Game ----
  const minP = sheet.minPlayers || 1;
  const maxP = sheet.maxPlayers || 99;
  const startBtn = el('button', { class: 'btn btn-primary btn-full', onclick: () => {
    if (selected.length < minP) { alert(`This game requires at least ${minP} player${minP > 1 ? 's' : ''}.`); return; }
    if (selected.length > maxP) { alert(`This game supports at most ${maxP} player${maxP > 1 ? 's' : ''}.`); return; }

    const savedIds = selected.filter(p => p.savedId).map(p => p.savedId);
    if (savedIds.length) incrementPlayCounts(savedIds);

    // Assign a stable key to each player for use as score map keys
    const players = selected.map(p => ({ ...p, key: p.savedId || uid() }));

    const state = {
      sheet,
      players,
      scores: {},
      rounds: [],
      startedAt: Date.now(),
      finished: false,
    };

    if (sheet.style === 'categories') {
      players.forEach(p => {
        state.scores[p.key] = {};
        sheet.categories.forEach(cat => {
          state.scores[p.key][cat.name] = cat.type === 'boolean' ? false : 0;
        });
      });
    }
    // rounds style starts with an empty rounds array

    saveGameState(state);
    navigate('game');
  }}, 'Start Game');

  main.appendChild(el('div', { class: 'setup-footer' }, startBtn));
  frag.appendChild(main);
  return frag;
});

// ============================================================
// GAME VIEW — CATEGORIES STYLE
// ============================================================

function renderCategoriesGame(state) {
  const frag  = document.createDocumentFragment();
  const sheet = state.sheet;
  frag.appendChild(renderHeader(sheet.name, { showHome: true }));

  const main = el('main', { class: 'view-game' });

  const computeTotal = (key) =>
    sheet.categories.reduce((sum, cat) => {
      const val = state.scores[key][cat.name];
      return sum + (cat.type === 'boolean' ? (val ? (cat.value || 0) : 0) : (Number(val) || 0));
    }, 0);

  const getLeaders = () => {
    const totals = state.players.map(p => ({ key: p.key, total: computeTotal(p.key) }));
    const best   = sheet.scoring === 'lowest'
      ? Math.min(...totals.map(t => t.total))
      : Math.max(...totals.map(t => t.total));
    return new Set(totals.filter(t => t.total === best).map(t => t.key));
  };

  const colTemplate = () =>
    `minmax(6rem, 1.5fr) ${state.players.map(() => '1fr').join(' ')}`;

  const render = () => {
    main.innerHTML = '';
    const leaders = getLeaders();
    const table   = el('div', { class: 'score-table' });

    // Header
    const headerRow = el('div', { class: 'score-row score-header' });
    headerRow.style.gridTemplateColumns = colTemplate();
    headerRow.appendChild(el('div', { class: 'score-cell cell-label' }, 'Category'));
    state.players.forEach(p => {
      headerRow.appendChild(el('div', {
        class: `score-cell cell-player${leaders.has(p.key) ? ' leader' : ''}`,
      }, p.name));
    });
    table.appendChild(headerRow);

    // Category rows
    sheet.categories.forEach(cat => {
      const row = el('div', { class: 'score-row' });
      row.style.gridTemplateColumns = colTemplate();
      row.appendChild(el('div', { class: 'score-cell cell-label' }, cat.name));
      state.players.forEach(p => {
        const cell = el('div', { class: 'score-cell cell-input' });
        const val  = state.scores[p.key][cat.name];

        if (cat.type === 'boolean') {
          const cb = el('input', { type: 'checkbox', class: 'score-checkbox', 'aria-label': `${p.name} — ${cat.name}` });
          cb.checked = val;
          cb.addEventListener('change', () => {
            state.scores[p.key][cat.name] = cb.checked;
            saveGameState(state);
            render();
          });
          cell.appendChild(cb);
          if (cat.value) cell.appendChild(el('span', { class: 'bool-value' }, `(${cat.value})`));
        } else {
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
        row.appendChild(cell);
      });
      table.appendChild(row);
    });

    // Totals row
    const totalsRow = el('div', { class: 'score-row score-totals' });
    totalsRow.style.gridTemplateColumns = colTemplate();
    totalsRow.appendChild(el('div', { class: 'score-cell cell-label' }, 'Total'));
    state.players.forEach(p => {
      totalsRow.appendChild(el('div', {
        class: `score-cell cell-total${leaders.has(p.key) ? ' leader' : ''}`,
      }, String(computeTotal(p.key))));
    });
    table.appendChild(totalsRow);
    main.appendChild(table);

    // Actions
    const actions = el('div', { class: 'game-actions' });
    actions.appendChild(el('button', {
      class: 'btn btn-primary',
      onclick: () => {
        state.finished = true;
        if (!state.historyId) {
          state.historyId = addToHistory(state).id;
        }
        saveGameState(state);
        navigate('results');
      },
    }, '🏁 Finish Game'));
    main.appendChild(actions);
  };

  render();
  frag.appendChild(main);
  return frag;
}

// ============================================================
// GAME VIEW — ROUNDS STYLE
// ============================================================

function renderRoundsGame(state) {
  const frag  = document.createDocumentFragment();
  const sheet = state.sheet;
  frag.appendChild(renderHeader(sheet.name, { showHome: true }));

  const main = el('main', { class: 'view-game' });
  if (!state.rounds) state.rounds = [];

  const computeTotal = (key) =>
    state.rounds.reduce((sum, round) => sum + (Number(round[key]) || 0), 0);

  const getLeaders = () => {
    const totals = state.players.map(p => ({ key: p.key, total: computeTotal(p.key) }));
    const best   = sheet.scoring === 'lowest'
      ? Math.min(...totals.map(t => t.total))
      : Math.max(...totals.map(t => t.total));
    return new Set(totals.filter(t => t.total === best).map(t => t.key));
  };

  const roundLabel  = sheet.rounds?.label || 'Round';
  const colTemplate = () =>
    `minmax(4rem, auto) ${state.players.map(() => '1fr').join(' ')} 2rem`;

  const render = () => {
    main.innerHTML = '';
    const leaders = getLeaders();
    const table   = el('div', { class: 'score-table' });

    // Header
    const headerRow = el('div', { class: 'score-row score-header' });
    headerRow.style.gridTemplateColumns = colTemplate();
    headerRow.appendChild(el('div', { class: 'score-cell cell-label' }, roundLabel));
    state.players.forEach(p => {
      headerRow.appendChild(el('div', {
        class: `score-cell cell-player${leaders.has(p.key) ? ' leader' : ''}`,
      }, p.name));
    });
    headerRow.appendChild(el('div', { class: 'score-cell' })); // spacer for delete col
    table.appendChild(headerRow);

    // Round rows
    state.rounds.forEach((round, i) => {
      const row = el('div', { class: 'score-row' });
      row.style.gridTemplateColumns = colTemplate();
      row.appendChild(el('div', { class: 'score-cell cell-label' }, String(i + 1)));
      state.players.forEach(p => {
        const input = el('input', {
          type: 'number', class: 'score-input',
          value: round[p.key] != null ? String(round[p.key]) : '',
          'aria-label': `${p.name} ${roundLabel} ${i + 1}`,
        });
        input.addEventListener('change', () => {
          round[p.key] = Number(input.value) || 0;
          saveGameState(state);
          render();
        });
        const cell = el('div', { class: 'score-cell cell-input' });
        cell.appendChild(input);
        row.appendChild(cell);
      });
      const delCell = el('div', { class: 'score-cell cell-action' });
      delCell.appendChild(el('button', {
        class: 'btn-icon-sm btn-remove', 'aria-label': `Delete ${roundLabel} ${i + 1}`,
        onclick: () => { state.rounds.splice(i, 1); saveGameState(state); render(); },
      }, '✕'));
      row.appendChild(delCell);
      table.appendChild(row);
    });

    // Totals row
    const totalsRow = el('div', { class: 'score-row score-totals' });
    totalsRow.style.gridTemplateColumns = colTemplate();
    totalsRow.appendChild(el('div', { class: 'score-cell cell-label' }, 'Total'));
    state.players.forEach(p => {
      totalsRow.appendChild(el('div', {
        class: `score-cell cell-total${leaders.has(p.key) ? ' leader' : ''}`,
      }, String(computeTotal(p.key))));
    });
    totalsRow.appendChild(el('div', { class: 'score-cell' })); // spacer
    table.appendChild(totalsRow);
    main.appendChild(table);

    // Actions
    const actions  = el('div', { class: 'game-actions' });
    const maxRounds = sheet.rounds?.maxRounds;
    if (!maxRounds || state.rounds.length < maxRounds) {
      actions.appendChild(el('button', {
        class: 'btn btn-secondary',
        onclick: () => {
          const newRound = {};
          state.players.forEach(p => { newRound[p.key] = 0; });
          state.rounds.push(newRound);
          saveGameState(state);
          render();
        },
      }, `+ Add ${roundLabel}`));
    }
    actions.appendChild(el('button', {
      class: 'btn btn-primary',
      onclick: () => {
        state.finished = true;
        if (!state.historyId) {
          state.historyId = addToHistory(state).id;
        }
        saveGameState(state);
        navigate('results');
      },
    }, '🏁 Finish Game'));
    main.appendChild(actions);
  };

  render();
  frag.appendChild(main);
  return frag;
}

// ============================================================
// GAME VIEW (dispatcher)
// ============================================================

registerView('game', () => {
  const state = getGameState();
  if (!state) { navigate('home'); return null; }
  if (state.finished) { navigate('results'); return null; }
  if (state.sheet.style === 'categories') return renderCategoriesGame(state);
  if (state.sheet.style === 'rounds')     return renderRoundsGame(state);
  return el('p', { class: 'error-msg' }, `Unknown sheet style: "${state.sheet.style}"`);
});

// ============================================================
// RESULTS VIEW
// ============================================================

registerView('results', () => {
  const state = getGameState();
  if (!state) { navigate('home'); return null; }

  const frag  = document.createDocumentFragment();
  frag.appendChild(renderHeader('Results', { showHome: true }));
  const main  = el('main', { class: 'view-results' });
  const sheet = state.sheet;

  const computeTotal = (key) => {
    if (sheet.style === 'categories') {
      return sheet.categories.reduce((sum, cat) => {
        const val = state.scores[key][cat.name];
        return sum + (cat.type === 'boolean' ? (val ? (cat.value || 0) : 0) : (Number(val) || 0));
      }, 0);
    }
    return (state.rounds || []).reduce((sum, round) => sum + (Number(round[key]) || 0), 0);
  };

  const totals = state.players
    .map(p => ({ name: p.name, key: p.key, total: computeTotal(p.key) }))
    .sort((a, b) => sheet.scoring === 'lowest' ? a.total - b.total : b.total - a.total);

  const topScore  = totals[0]?.total;
  const winners   = totals.filter(t => t.total === topScore).map(t => t.name);

  // Winner banner
  const banner = el('div', { class: 'winner-banner' });
  banner.appendChild(el('div', { class: 'winner-trophy' }, winners.length > 1 ? '🤝' : '🏆'));
  banner.appendChild(el('div', { class: 'winner-name' }, winners.join(' & ')));
  banner.appendChild(el('div', { class: 'winner-label' }, winners.length > 1 ? "It's a tie!" : 'Winner!'));
  main.appendChild(banner);

  // Scoreboard
  const scoreboard = el('ol', { class: 'scoreboard' });
  totals.forEach((entry, i) => {
    const isWinner = winners.includes(entry.name);
    const li = el('li', { class: `scoreboard-item${isWinner ? ' scoreboard-winner' : ''}` });
    li.appendChild(el('span', { class: 'sb-rank' }, String(i + 1)));
    li.appendChild(el('span', { class: 'sb-name' }, entry.name));
    li.appendChild(el('span', { class: 'sb-score' }, String(entry.total)));
    scoreboard.appendChild(li);
  });
  main.appendChild(scoreboard);

  // Actions
  const actions = el('div', { class: 'results-actions' });
  actions.appendChild(el('button', {
    class: 'btn btn-ghost',
    onclick: () => { clearGameState(); navigate('home'); },
  }, '🏠 Done'));
  actions.appendChild(el('button', {
    class: 'btn btn-primary',
    onclick: () => { clearGameState(); navigate('browse'); },
  }, '+ New Game'));
  main.appendChild(actions);

  frag.appendChild(main);
  return frag;
});

// ============================================================
// HISTORY VIEW
// ============================================================

registerView('history', () => {
  const frag    = document.createDocumentFragment();
  frag.appendChild(renderHeader('History', { showBack: true }));

  const main    = el('main', { class: 'view-history' });
  const history = getHistory();

  if (history.length === 0) {
    main.appendChild(el('p', { class: 'hint' },
      'No games recorded yet. Finish a game to see it here.'));
    frag.appendChild(main);
    return frag;
  }

  history.forEach(record => {
    const card = el('div', { class: 'history-card' });

    const topRow = el('div', { class: 'history-card-top' });
    topRow.appendChild(el('span', { class: 'history-game-name' }, record.sheetName));
    topRow.appendChild(el('span', { class: 'history-date' }, formatDate(record.finishedAt)));
    card.appendChild(topRow);

    const winnerText = record.winners.length > 1
      ? `🤝 ${record.winners.join(' & ')}`
      : `🏆 ${record.winners[0]}`;
    card.appendChild(el('div', { class: 'history-winner' }, winnerText));

    const summary = record.totals.map(t => `${t.name}: ${t.total}`).join(' · ');
    card.appendChild(el('div', { class: 'history-summary' }, summary));

    const actions = el('div', { class: 'history-card-actions' });
    actions.appendChild(el('button', {
      class: 'btn btn-ghost btn-sm',
      onclick: () => navigate('history-detail', { id: record.id }),
    }, 'View'));
    actions.appendChild(el('button', {
      class: 'btn-icon-sm btn-remove', 'aria-label': 'Delete game record',
      onclick: () => {
        if (confirm('Delete this game record? This cannot be undone.')) {
          deleteHistoryEntry(record.id);
          navigate('history');
        }
      },
    }, '✕'));
    card.appendChild(actions);

    main.appendChild(card);
  });

  frag.appendChild(main);
  return frag;
});

// ============================================================
// HISTORY DETAIL VIEW
// ============================================================

registerView('history-detail', ({ id }) => {
  const record = getHistory().find(r => r.id === id);
  if (!record) { navigate('history'); return null; }

  const frag = document.createDocumentFragment();
  frag.appendChild(renderHeader(record.sheetName, { showBack: true }));

  const main = el('main', { class: 'view-game' });

  main.appendChild(el('div', { class: 'history-detail-meta' },
    formatDate(record.finishedAt) + ' · ' + record.players.map(p => p.name).join(', ')));

  const table = el('div', { class: 'score-table' });

  if (record.sheetStyle === 'categories') {
    const colTemplate = `minmax(6rem, 1.5fr) ${record.players.map(() => '1fr').join(' ')}`;

    const headerRow = el('div', { class: 'score-row score-header' });
    headerRow.style.gridTemplateColumns = colTemplate;
    headerRow.appendChild(el('div', { class: 'score-cell cell-label' }, 'Category'));
    record.players.forEach(p => {
      headerRow.appendChild(el('div', {
        class: `score-cell cell-player${record.winners.includes(p.name) ? ' leader' : ''}`,
      }, p.name));
    });
    table.appendChild(headerRow);

    record.categories.forEach(cat => {
      const row = el('div', { class: 'score-row' });
      row.style.gridTemplateColumns = colTemplate;
      row.appendChild(el('div', { class: 'score-cell cell-label' }, cat.name));
      record.players.forEach(p => {
        const val = (record.scores[p.key] || {})[cat.name];
        const display = cat.type === 'boolean'
          ? (val ? `✓ (${cat.value || 0})` : '—')
          : (val != null ? String(val) : '0');
        row.appendChild(el('div', { class: 'score-cell' }, display));
      });
      table.appendChild(row);
    });

    const totalsRow = el('div', { class: 'score-row score-totals' });
    totalsRow.style.gridTemplateColumns = colTemplate;
    totalsRow.appendChild(el('div', { class: 'score-cell cell-label' }, 'Total'));
    record.players.forEach(p => {
      const t = record.totals.find(t => t.key === p.key);
      totalsRow.appendChild(el('div', {
        class: `score-cell cell-total${record.winners.includes(p.name) ? ' leader' : ''}`,
      }, t ? String(t.total) : '0'));
    });
    table.appendChild(totalsRow);

  } else if (record.sheetStyle === 'rounds') {
    const colTemplate = `minmax(4rem, auto) ${record.players.map(() => '1fr').join(' ')}`;

    const headerRow = el('div', { class: 'score-row score-header' });
    headerRow.style.gridTemplateColumns = colTemplate;
    headerRow.appendChild(el('div', { class: 'score-cell cell-label' }, record.roundLabel));
    record.players.forEach(p => {
      headerRow.appendChild(el('div', {
        class: `score-cell cell-player${record.winners.includes(p.name) ? ' leader' : ''}`,
      }, p.name));
    });
    table.appendChild(headerRow);

    record.rounds.forEach((round, i) => {
      const row = el('div', { class: 'score-row' });
      row.style.gridTemplateColumns = colTemplate;
      row.appendChild(el('div', { class: 'score-cell cell-label' }, String(i + 1)));
      record.players.forEach(p => {
        row.appendChild(el('div', { class: 'score-cell' },
          round[p.key] != null ? String(round[p.key]) : '0'));
      });
      table.appendChild(row);
    });

    const totalsRow = el('div', { class: 'score-row score-totals' });
    totalsRow.style.gridTemplateColumns = colTemplate;
    totalsRow.appendChild(el('div', { class: 'score-cell cell-label' }, 'Total'));
    record.players.forEach(p => {
      const t = record.totals.find(t => t.key === p.key);
      totalsRow.appendChild(el('div', {
        class: `score-cell cell-total${record.winners.includes(p.name) ? ' leader' : ''}`,
      }, t ? String(t.total) : '0'));
    });
    table.appendChild(totalsRow);
  }

  main.appendChild(table);
  frag.appendChild(main);
  return frag;
});

// ============================================================
// PLAYERS VIEW
// ============================================================

registerView('players', () => {
  const frag = document.createDocumentFragment();
  frag.appendChild(renderHeader('Players', { showBack: true }));

  const main = el('main', { class: 'view-players' });

  const render = () => {
    main.innerHTML = '';

    // Add player form
    const addRow  = el('div', { class: 'player-add-row' });
    const input   = el('input', { type: 'text', class: 'input-text', placeholder: 'New player name…', 'aria-label': 'New player name' });
    const addBtn  = el('button', { class: 'btn btn-secondary' }, 'Add');
    addBtn.addEventListener('click', () => {
      const name = input.value.trim();
      if (!name) return;
      addSavedPlayer(name);
      render();
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBtn.click(); });
    addRow.appendChild(input);
    addRow.appendChild(addBtn);
    main.appendChild(addRow);

    const players = sortedPlayers();
    if (players.length === 0) {
      main.appendChild(el('p', { class: 'hint' }, 'No saved players yet.'));
      return;
    }

    const list = el('ul', { class: 'players-list' });
    players.forEach(p => {
      const li        = el('li', { class: 'player-item' });
      const nameSpan  = el('span', { class: 'player-item-name', title: 'Click to rename' }, p.name);
      const playsSpan = el('span', { class: 'player-item-plays' }, `${p.plays} play${p.plays !== 1 ? 's' : ''}`);
      const deleteBtn = el('button', {
        class: 'btn-icon-sm btn-remove', 'aria-label': `Delete ${p.name}`,
        onclick: () => {
          if (confirm(`Remove "${p.name}" from saved players?`)) {
            deleteSavedPlayer(p.id);
            render();
          }
        },
      }, '✕');

      nameSpan.addEventListener('click', () => {
        const newName = prompt('Rename player:', p.name);
        if (newName && newName.trim() && newName.trim() !== p.name) {
          updateSavedPlayer(p.id, { name: newName.trim() });
          render();
        }
      });

      li.appendChild(nameSpan);
      li.appendChild(playsSpan);
      li.appendChild(deleteBtn);
      list.appendChild(li);
    });
    main.appendChild(list);
  };

  render();
  frag.appendChild(main);
  return frag;
});

// ============================================================
// GAME BUILDER VIEW
// ============================================================

registerView('game-builder', ({ sheetId } = {}) => {
  const editing = sheetId != null;
  const existing = editing ? getCustomSheets().find(s => s.id === sheetId) : null;

  const frag = document.createDocumentFragment();
  frag.appendChild(renderHeader(editing ? 'Edit Game' : 'New Game', { showBack: true }));

  const main = el('main', { class: 'view-builder' });
  frag.appendChild(main);

  // Mutable builder state — separate from DOM so re-renders don't lose data
  const state = {
    scoring:    existing?.scoring             || 'highest',
    style:      existing?.style               || 'categories',
    categories: existing?.categories ? existing.categories.map(c => ({ ...c })) : [],
    roundLabel: existing?.rounds?.label       || 'Round',
    maxRounds:  existing?.rounds?.maxRounds   ?? '',
  };

  // ---- SECTION: Game Info ----
  const infoSection = el('section', { class: 'builder-section' });
  infoSection.appendChild(el('h2', {}, 'Game Info'));

  const nameField = el('div', { class: 'builder-field' });
  nameField.appendChild(el('label', {}, 'Game Name *'));
  const nameInput = el('input', {
    type: 'text', class: 'input-text', placeholder: 'e.g. My Party Game',
    value: existing?.name || '', 'aria-label': 'Game name',
  });
  nameField.appendChild(nameInput);
  infoSection.appendChild(nameField);

  const playersRow = el('div', { class: 'builder-row' });

  const minField = el('div', { class: 'builder-field' });
  minField.appendChild(el('label', {}, 'Min Players'));
  const minInput = el('input', {
    type: 'number', class: 'input-text', min: '1', max: '20',
    style: 'max-width:6rem',
    value: String(existing?.minPlayers ?? 2), 'aria-label': 'Min players',
  });
  minField.appendChild(minInput);
  playersRow.appendChild(minField);

  const maxField = el('div', { class: 'builder-field' });
  maxField.appendChild(el('label', {}, 'Max Players'));
  const maxInput = el('input', {
    type: 'number', class: 'input-text', min: '1', max: '20',
    style: 'max-width:6rem',
    value: String(existing?.maxPlayers ?? 10), 'aria-label': 'Max players',
  });
  maxField.appendChild(maxInput);
  playersRow.appendChild(maxField);
  infoSection.appendChild(playersRow);

  // Scoring radio
  const scoringField = el('div', { class: 'builder-field' });
  scoringField.appendChild(el('label', {}, 'Winner'));
  const scoringGroup = el('div', { class: 'radio-group' });
  const highBtn = el('button', { type: 'button', class: `radio-btn${state.scoring === 'highest' ? ' selected' : ''}` }, '▲ Highest wins');
  const lowBtn  = el('button', { type: 'button', class: `radio-btn${state.scoring === 'lowest'  ? ' selected' : ''}` }, '▼ Lowest wins');
  highBtn.addEventListener('click', () => { state.scoring = 'highest'; highBtn.classList.add('selected'); lowBtn.classList.remove('selected'); });
  lowBtn.addEventListener('click',  () => { state.scoring = 'lowest';  lowBtn.classList.add('selected');  highBtn.classList.remove('selected'); });
  scoringGroup.appendChild(highBtn);
  scoringGroup.appendChild(lowBtn);
  scoringField.appendChild(scoringGroup);
  infoSection.appendChild(scoringField);

  // Style radio
  const styleField = el('div', { class: 'builder-field' });
  styleField.appendChild(el('label', {}, 'Scoring Style'));
  const styleGroup = el('div', { class: 'radio-group' });
  const catBtn = el('button', { type: 'button', class: `radio-btn${state.style === 'categories' ? ' selected' : ''}` }, '📋 Categories');
  const rndBtn = el('button', { type: 'button', class: `radio-btn${state.style === 'rounds'     ? ' selected' : ''}` }, '🔄 Rounds');
  catBtn.addEventListener('click', () => { state.style = 'categories'; catBtn.classList.add('selected'); rndBtn.classList.remove('selected'); renderStyleSection(); });
  rndBtn.addEventListener('click', () => { state.style = 'rounds';     rndBtn.classList.add('selected'); catBtn.classList.remove('selected'); renderStyleSection(); });
  styleGroup.appendChild(catBtn);
  styleGroup.appendChild(rndBtn);
  styleField.appendChild(styleGroup);
  infoSection.appendChild(styleField);

  main.appendChild(infoSection);

  // ---- Style-specific section (swapped when style radio changes) ----
  const styleContainer = el('div');
  main.appendChild(styleContainer);

  function renderCategoriesSection() {
    const section = el('section', { class: 'builder-section' });
    section.appendChild(el('h2', {}, 'Scoring Categories'));

    const catList = el('div', { class: 'cat-list' });

    function renderCatRows() {
      catList.innerHTML = '';
      if (state.categories.length === 0) {
        catList.appendChild(el('p', { class: 'hint' }, 'No categories yet — add one below.'));
      }
      state.categories.forEach((cat, i) => {
        const row = el('div', { class: 'cat-row' });

        const nameIn = el('input', {
          type: 'text', class: 'cat-name-input', placeholder: 'Category name…',
          value: cat.name || '', 'aria-label': 'Category name',
        });
        nameIn.addEventListener('input', () => { cat.name = nameIn.value; });
        row.appendChild(nameIn);

        const typeSelect = el('select', { class: 'cat-type-select', 'aria-label': 'Score type' });
        typeSelect.appendChild(el('option', { value: 'number' }, 'Number'));
        typeSelect.appendChild(el('option', { value: 'boolean' }, 'Checkbox'));
        typeSelect.value = cat.type || 'number';
        typeSelect.addEventListener('change', () => {
          cat.type = typeSelect.value;
          if (cat.type === 'boolean') { delete cat.min; delete cat.max; if (cat.value == null) cat.value = 1; }
          else { delete cat.value; }
          renderCatRows();
        });
        row.appendChild(typeSelect);

        if (cat.type === 'boolean') {
          row.appendChild(el('span', { class: 'cat-opt-label' }, 'Pts'));
          const valIn = el('input', {
            type: 'number', class: 'cat-opt-input', min: '0', placeholder: '1',
            value: cat.value != null ? String(cat.value) : '1', 'aria-label': 'Point value',
          });
          valIn.addEventListener('input', () => { cat.value = Number(valIn.value) || 0; });
          row.appendChild(valIn);
        } else {
          row.appendChild(el('span', { class: 'cat-opt-label' }, 'Min'));
          const minIn = el('input', {
            type: 'number', class: 'cat-opt-input',
            placeholder: '—', value: cat.min != null ? String(cat.min) : '', 'aria-label': 'Min value',
          });
          minIn.addEventListener('input', () => {
            const v = minIn.value.trim();
            if (v === '') delete cat.min; else cat.min = Number(v);
          });
          row.appendChild(minIn);

          row.appendChild(el('span', { class: 'cat-opt-label' }, 'Max'));
          const maxIn = el('input', {
            type: 'number', class: 'cat-opt-input',
            placeholder: '—', value: cat.max != null ? String(cat.max) : '', 'aria-label': 'Max value',
          });
          maxIn.addEventListener('input', () => {
            const v = maxIn.value.trim();
            if (v === '') delete cat.max; else cat.max = Number(v);
          });
          row.appendChild(maxIn);
        }

        const acts = el('div', { class: 'cat-row-actions' });
        if (i > 0) {
          acts.appendChild(el('button', {
            type: 'button', class: 'btn-icon-sm', 'aria-label': 'Move up',
            onclick: () => { [state.categories[i-1], state.categories[i]] = [state.categories[i], state.categories[i-1]]; renderCatRows(); },
          }, '↑'));
        }
        if (i < state.categories.length - 1) {
          acts.appendChild(el('button', {
            type: 'button', class: 'btn-icon-sm', 'aria-label': 'Move down',
            onclick: () => { [state.categories[i], state.categories[i+1]] = [state.categories[i+1], state.categories[i]]; renderCatRows(); },
          }, '↓'));
        }
        acts.appendChild(el('button', {
          type: 'button', class: 'btn-icon-sm btn-remove', 'aria-label': 'Remove category',
          onclick: () => { state.categories.splice(i, 1); renderCatRows(); },
        }, '✕'));
        row.appendChild(acts);

        catList.appendChild(row);
      });
    }

    renderCatRows();
    section.appendChild(catList);
    section.appendChild(el('button', {
      type: 'button', class: 'btn btn-secondary btn-sm',
      onclick: () => { state.categories.push({ name: '', type: 'number' }); renderCatRows(); },
    }, '+ Add Category'));

    return section;
  }

  function renderRoundsSection() {
    const section = el('section', { class: 'builder-section' });
    section.appendChild(el('h2', {}, 'Rounds Settings'));

    const labelField = el('div', { class: 'builder-field' });
    labelField.appendChild(el('label', {}, 'Round Label'));
    const labelIn = el('input', {
      type: 'text', class: 'input-text', placeholder: 'Round',
      value: state.roundLabel, 'aria-label': 'Round label',
    });
    labelIn.addEventListener('input', () => { state.roundLabel = labelIn.value || 'Round'; });
    labelField.appendChild(labelIn);
    section.appendChild(labelField);

    const maxRoundsField = el('div', { class: 'builder-field' });
    maxRoundsField.appendChild(el('label', {}, 'Max Rounds (blank = unlimited)'));
    const maxRoundsIn = el('input', {
      type: 'number', class: 'input-text', min: '1', placeholder: 'Unlimited',
      value: (state.maxRounds != null && state.maxRounds !== '') ? String(state.maxRounds) : '',
      'aria-label': 'Max rounds',
    });
    maxRoundsIn.addEventListener('input', () => {
      const v = maxRoundsIn.value.trim();
      state.maxRounds = v !== '' ? Number(v) : null;
    });
    maxRoundsField.appendChild(maxRoundsIn);
    section.appendChild(maxRoundsField);

    return section;
  }

  function renderStyleSection() {
    styleContainer.innerHTML = '';
    styleContainer.appendChild(
      state.style === 'categories' ? renderCategoriesSection() : renderRoundsSection()
    );
  }
  renderStyleSection();

  // ---- Build the sheet object from current state (used by save and export) ----
  function buildSheet(id) {
    const sheet = {
      id,
      name:       nameInput.value.trim(),
      minPlayers: Math.max(1, Number(minInput.value) || 1),
      maxPlayers: Math.max(1, Number(maxInput.value) || 10),
      scoring:    state.scoring,
      style:      state.style,
    };
    if (state.style === 'categories') {
      sheet.categories = state.categories.map(c => {
        const cat = { name: c.name.trim(), type: c.type };
        if (c.type === 'number') {
          if (c.min !== undefined) cat.min = c.min;
          if (c.max !== undefined) cat.max = c.max;
        } else {
          cat.value = c.value != null ? c.value : 1;
        }
        return cat;
      });
    } else {
      sheet.rounds = {
        label:     state.roundLabel || 'Round',
        maxRounds: (state.maxRounds != null && state.maxRounds !== '') ? Number(state.maxRounds) : null,
      };
    }
    return sheet;
  }

  function validate() {
    if (!nameInput.value.trim()) { alert('Please enter a game name.'); nameInput.focus(); return false; }
    if (state.style === 'categories') {
      if (state.categories.length === 0) { alert('Add at least one scoring category.'); return false; }
      const unnamedIdx = state.categories.findIndex(c => !c.name.trim());
      if (unnamedIdx >= 0) { alert(`Category ${unnamedIdx + 1} needs a name.`); return false; }
    }
    return true;
  }

  // ---- SECTION: Actions ----
  const actionsSection = el('div', { class: 'builder-actions' });

  actionsSection.appendChild(el('button', {
    type: 'button', class: 'btn btn-primary btn-full',
    onclick: () => {
      if (!validate()) return;
      const id = editing ? sheetId : 'custom_' + uid();
      saveCustomSheet(buildSheet(id));
      navigate('browse');
    },
  }, editing ? '💾 Save Changes' : '✅ Save Game'));

  actionsSection.appendChild(el('button', {
    type: 'button', class: 'btn btn-ghost btn-full',
    onclick: () => {
      if (!nameInput.value.trim()) { alert('Enter a game name before exporting.'); return; }
      const id    = editing ? sheetId : 'custom_' + uid();
      const sheet = buildSheet(id);
      const blob  = new Blob([JSON.stringify(sheet, null, 2)], { type: 'application/json' });
      const url   = URL.createObjectURL(blob);
      const a     = el('a', {
        href: url,
        download: sheet.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '-scoresheet.json',
      });
      a.click();
      URL.revokeObjectURL(url);
    },
  }, '⬇ Export Config'));

  if (editing) {
    actionsSection.appendChild(el('button', {
      type: 'button', class: 'btn btn-danger btn-full',
      onclick: () => {
        if (confirm(`Delete "${existing?.name || 'this game'}"? This cannot be undone.`)) {
          deleteCustomSheet(sheetId);
          navigate('browse');
        }
      },
    }, '🗑 Delete Game'));
  }

  main.appendChild(actionsSection);
  return frag;
});

// ============================================================
// INIT
// ============================================================

function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .catch(err => console.warn('SW registration failed:', err));
  }

  window.addEventListener('popstate', (e) => {
    const { view, params } = e.state || { view: 'home', params: {} };
    showView(view, params || {}, false);
  });

  // Resume from hash if present, otherwise go home
  const viewFromHash = location.hash.slice(1);
  if (viewFromHash && _views[viewFromHash] && history.state?.view) {
    showView(history.state.view, history.state.params || {}, false);
  } else {
    navigate('home');
  }
}

init();
