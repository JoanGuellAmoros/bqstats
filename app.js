let currentPlayerTab = null;
let activeGame = null;
let activePlayerStats = {};
let actionLog = [];
let isEditing = false;
let logVisible = false;
let editingPlayerId = null;
let statsMode = 'totals';
let detailQuarterFilter = null;

const STAT_LABELS = {
  twoMade: '2PM', twoMissed: '2PI', threeMade: '3PM', threeMissed: '3PI',
  ftMade: 'TLM', ftMissed: 'TLI', oReb: 'RO', dReb: 'RD',
  assists: 'AST', turnovers: 'PERD', steals: 'REC', blocks: 'TAP',
  pFouls: 'FALT', foulsReceived: 'FALTR', blocksAgainst: 'TAPR'
};

const STAT_NAMES = {
  twoMade: '2P Fet', twoMissed: '2P Fallat', threeMade: '3P Fet', threeMissed: '3P Fallat',
  ftMade: 'TL Fet', ftMissed: 'TL Fallat', oReb: 'Rebot Ofensiu', dReb: 'Rebot Defensiu',
  assists: 'Assistència', turnovers: 'Pèrdua', steals: 'Recuperació', blocks: 'Tap',
  pFouls: 'Falta Personal', foulsReceived: 'Falta Rebuda', blocksAgainst: 'Tap Rebut'
};

const FIELDS = ['twoMade','twoMissed','threeMade','threeMissed','ftMade','ftMissed','oReb','dReb','assists','turnovers','steals','blocks','pFouls','foulsReceived','blocksAgainst'];

const MADE_AUTO = { twoMade: 'twoMissed', threeMade: 'threeMissed', ftMade: 'ftMissed' };

function emptyStats() {
  return { twoMade:0, twoMissed:0, threeMade:0, threeMissed:0, ftMade:0, ftMissed:0, oReb:0, dReb:0, assists:0, turnovers:0, steals:0, blocks:0, pFouls:0, foulsReceived:0, blocksAgainst:0 };
}

function toggleGameSide() {
  const isHome = document.querySelector('input[name="gameSide"]:checked').value === 'local';
  document.getElementById('gameTeam').placeholder = isHome ? 'Balaguer (Local)' : 'Balaguer (Visitant)';
  document.getElementById('gameOpponent').placeholder = isHome ? 'Nom del rival' : 'Nom del rival (Local)';
}

function calcScore(s) {
  return s.twoMade * 2 + s.threeMade * 3 + s.ftMade;
}

function calcVal(s) {
  const pts = calcScore(s);
  const reb = s.oReb + s.dReb;
  return pts + reb + s.assists + s.blocks + s.steals + s.foulsReceived
    + s.ftMade + s.twoMade + s.threeMade
    - s.ftMissed - s.twoMissed - s.threeMissed
    - s.turnovers - s.blocksAgainst - s.pFouls;
}

function totalStats() {
  const total = emptyStats();
  Object.values(activePlayerStats).forEach(s => {
    Object.keys(total).forEach(k => total[k] += s[k]);
  });
  return total;
}

function calcRivalScore() {
  if (!activeGame) return 0;
  return activeGame.rival1pt + activeGame.rival2pt * 2 + activeGame.rival3pt * 3;
}

function updateLiveScore() {
  const ts = totalStats();
  const sc = calcScore(ts);
  const rs = calcRivalScore();
  const home = activeGame && activeGame.isHome !== false;
  const team = activeGame ? esc(activeGame.team) : '';
  const opp = activeGame ? esc(activeGame.opponent) : '';
  document.getElementById('liveScore').innerHTML =
    `<span style="color:${home ? 'var(--primary)' : '#888'}">${team}</span> ${sc} - ${rs} <span style="color:${!home ? 'var(--primary)' : '#888'}">${opp}</span>`;
}

// NAVIGATION
function navigateTo(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
  document.getElementById('btnBack').style.display = viewId === 'viewHome' ? 'none' : 'block';

  const titles = {
    viewHome: 'Bàsquet Stats',
    viewPlayers: 'Jugadors',
    viewNewGame: 'Nou Partit',
    viewLiveGame: activeGame && isEditing ? 'Editar Partit' : 'Partit en Viu',
    viewHistory: 'Historial',
    viewGameDetail: 'Detall del Partit',
    viewStats: 'Estadístiques Globals'
  };
  document.getElementById('appTitle').textContent = titles[viewId] || 'Bàsquet Stats';

  updateBottomNav();
  switch (viewId) {
    case 'viewHome': renderHome(); break;
    case 'viewPlayers': renderPlayers(); break;
    case 'viewNewGame': renderNewGame(); break;
    case 'viewHistory': renderHistory(); break;
    case 'viewStats': renderGlobalStats(); break;
  }
}

function navigateBack() {
  const active = document.querySelector('.view.active');
  if (!active) return;
  switch (active.id) {
    case 'viewGameDetail': navigateTo('viewHistory'); break;
    case 'viewLiveGame': navigateTo('viewHome'); break;
    default: navigateTo('viewHome');
  }
}

function updateBottomNav() {
  const nav = document.querySelector('footer nav');
  if (!nav) return;
  const hasActive = activeGame && activeGame.isActive;
  const btns = nav.querySelectorAll('.btn');
  if (btns[2]) {
    btns[2].innerHTML = hasActive ? '&#127936;' : '&#127936;';
    btns[2].title = hasActive ? 'Partit Actiu' : 'Nou Partit';
  }
}

// HOME
async function renderHome() {
  const grid = document.getElementById('homeGrid');
  const players = await DB.getAll('players');
  const hasPlayers = players.length > 0;
  const allGames = await DB.getAll('games');
  const activeGames = allGames.filter(g => g.isActive);

  let activeHtml = '';
  if (activeGames.length > 0) {
    const allStats = await DB.getAll('stats');
    const gameScores = {};
    allStats.forEach(s => {
      if (!gameScores[s.gameId]) gameScores[s.gameId] = emptyStats();
      Object.keys(gameScores[s.gameId]).forEach(k => gameScores[s.gameId][k] += s[k]);
    });
    activeGames.forEach(g => {
      const t = gameScores[g.id];
      const pts = t ? calcScore(t) : 0;
      const rPts = (g.rival1pt || 0) + (g.rival2pt || 0) * 2 + (g.rival3pt || 0) * 3;
      const isCurrent = activeGame && activeGame.id === g.id;
      activeHtml += `<button class="btn ${isCurrent ? 'btn-success' : 'btn-outline-success'} w-100 mb-1 py-2 text-start" onclick="resumeGame(${g.id})">
        &#127936; ${esc(g.team)} ${pts} - ${rPts} ${esc(g.opponent)}<br><small>Q${g.currentPeriod}/${g.periods} ${isCurrent ? '(actual)' : ''}</small>
      </button>`;
    });
  }

  if (!hasPlayers) {
    grid.innerHTML = `
      <div class="col-12"><button class="btn btn-outline-warning w-100 py-3" onclick="navigateTo('viewPlayers')">&#128101; Afegeix jugadors per començar</button></div>
    `;
    return;
  }

  grid.innerHTML = `
    ${activeHtml ? '<div class="col-12"><div class="small text-secondary mb-1">Partits en curs:</div>' + activeHtml + '</div>' : ''}
    <div class="col-6"><button class="btn btn-outline-light w-100 py-4 fs-5" onclick="navigateTo('viewNewGame')">&#127936;<br><small>Nou Partit</small></button></div>
    <div class="col-6"><button class="btn btn-outline-light w-100 py-4 fs-5" onclick="navigateTo('viewPlayers')">&#128101;<br><small>Jugadors</small></button></div>
    <div class="col-6"><button class="btn btn-outline-light w-100 py-4 fs-5" onclick="navigateTo('viewHistory')">&#128214;<br><small>Historial</small></button></div>
    <div class="col-6"><button class="btn btn-outline-light w-100 py-4 fs-5" onclick="navigateTo('viewStats')">&#128200;<br><small>Estadístiques</small></button></div>
  `;
}

// PLAYERS
async function renderPlayers() {
  const list = document.getElementById('playerList');
  const players = await DB.getAll('players');
  if (players.length === 0) {
    list.innerHTML = '<div class="text-center text-secondary py-4">&#127936;<br>Afegeix jugadors per començar</div>';
    return;
  }
  list.innerHTML = players.map(p => `
    <li class="list-group-item list-group-item-action d-flex align-items-center justify-content-between px-2 py-2 player-item ${editingPlayerId === p.id ? 'editing' : ''}">
      <span>${p.number ? '<span class="text-primary fw-bold">#' + p.number + '</span> ' : ''}${esc(p.name)}</span>
      <div class="btn-group btn-group-sm">
        <button class="btn btn-outline-primary" onclick="editPlayer(${p.id})">&#9998;</button>
        <button class="btn btn-outline-danger" onclick="deletePlayer(${p.id})">&#128465;</button>
      </div>
    </li>
  `).join('');
}

async function addPlayer() {
  const name = document.getElementById('playerName').value.trim();
  const number = document.getElementById('playerNumber').value.trim();
  if (!name) return alert('Introdueix un nom');

  if (editingPlayerId) {
    await DB.put('players', { id: editingPlayerId, name, number: number || '' });
    editingPlayerId = null;
    document.getElementById('btnPlayerSave').textContent = 'Afegir';
    document.getElementById('btnPlayerCancel').style.display = 'none';
  } else {
    await DB.add('players', { name, number: number || '' });
  }

  document.getElementById('playerName').value = '';
  document.getElementById('playerNumber').value = '';
  renderPlayers();
}

function editPlayer(id) {
  editingPlayerId = id;
  const playersList = document.querySelectorAll('#playerList li');
  DB.get('players', id).then(p => {
    if (p) {
      document.getElementById('playerName').value = p.name;
      document.getElementById('playerNumber').value = p.number || '';
      document.getElementById('btnPlayerSave').textContent = 'Actualitzar';
      document.getElementById('btnPlayerCancel').style.display = '';
    }
  });
}

function cancelEditPlayer() {
  editingPlayerId = null;
  document.getElementById('playerName').value = '';
  document.getElementById('playerNumber').value = '';
  document.getElementById('btnPlayerSave').textContent = 'Afegir';
  document.getElementById('btnPlayerCancel').style.display = 'none';
}

async function deletePlayer(id) {
  if (!confirm('Eliminar jugador?')) return;
  if (editingPlayerId === id) cancelEditPlayer();
  await DB.delete('players', id);
  renderPlayers();
}

// NEW GAME
async function renderNewGame() {
  const players = await DB.getAll('players');
  const container = document.getElementById('playerSelectList');
  if (players.length === 0) {
    container.innerHTML = '<div class="text-center text-secondary py-4">&#128101;<br>Primer afegeix jugadors</div>';
    return;
  }
  container.innerHTML = players.map(p => `
    <div class="form-check">
      <input class="form-check-input" type="checkbox" value="${p.id}" id="psel${p.id}" checked>
      <label class="form-check-label" for="psel${p.id}">${p.number ? '#' + p.number + ' ' : ''}${esc(p.name)}</label>
    </div>
  `).join('');
}

async function startGame() {
  const team = document.getElementById('gameTeam').value.trim();
  const opponent = document.getElementById('gameOpponent').value.trim();
  const periods = parseInt(document.getElementById('gamePeriods').value);
  if (!opponent) return alert('Introdueix el nom del rival');

  const checkboxes = document.querySelectorAll('#playerSelectList input:checked');
  const playerIds = Array.from(checkboxes).map(cb => parseInt(cb.value));
  if (playerIds.length === 0) return alert('Selecciona almenys un jugador');

  const isHome = document.querySelector('input[name="gameSide"]:checked').value === 'local';
  const game = {
    date: new Date().toISOString(),
    team, opponent, periods,
    currentPeriod: 1, playerIds, isActive: true,
    isHome,
    rival1pt: 0, rival2pt: 0, rival3pt: 0
  };
  const gameId = await DB.add('games', game);
  game.id = gameId;

  await saveCurrentSession();

  activeGame = game;
  isEditing = false;
  activePlayerStats = {};
  actionLog = [];
  for (const pid of playerIds) {
    activePlayerStats[pid] = { gameId, playerId: pid, ...emptyStats() };
  }

  navigateTo('viewLiveGame');
  renderLiveGame();
}

// LIVE GAME
async function renderLiveGame() {
  if (!activeGame) return;

  const players = await DB.getAll('players');
  const playerMap = {};
  players.forEach(p => playerMap[p.id] = p);

  updateLiveScore();

  if (!isEditing) {
    document.getElementById('livePeriod').textContent = `Quart ${activeGame.currentPeriod}/${activeGame.periods}`;
  } else {
    document.getElementById('livePeriod').textContent = 'Mode Edició';
  }

  const tabs = document.getElementById('liveTabs');
  tabs.innerHTML = activeGame.playerIds.map(pid => {
    const p = playerMap[pid];
    const name = p ? esc(p.name) : '?';
    const label = p ? (p.number ? '#' + p.number + ' ' : '') + p.name : '?';
    return `<button class="btn btn-outline-secondary player-tab" onclick="selectPlayerTab(${pid})">${esc(label)}</button>`;
  }).join('');

  if (currentPlayerTab === null || !activeGame.playerIds.includes(currentPlayerTab)) {
    currentPlayerTab = activeGame.playerIds[0];
  }
  const tabIdx = activeGame.playerIds.indexOf(currentPlayerTab);
  const allTabs = tabs.querySelectorAll('.player-tab');
  if (allTabs[tabIdx]) allTabs[tabIdx].classList.add('active');

  renderLiveStats(playerMap);
  renderActionLog().catch(() => {});

  document.getElementById('btnUndo').disabled = actionLog.length === 0;

  const actions = document.getElementById('liveActions');
  if (isEditing) {
    actions.innerHTML = `
      <button class="btn btn-primary" onclick="saveEditGame()">&#10003; Guardar Canvis</button>
      <button class="btn btn-outline-danger" onclick="cancelEditGame()">&#10005; Cancel·lar</button>
    `;
  } else {
    actions.innerHTML = `
      <button class="btn btn-primary" onclick="saveAndLeave()">Guardar i Sortir</button>
      <button class="btn btn-danger" onclick="endGame()">Finalitzar Partit</button>
    `;
  }
}

function selectPlayerTab(pid) {
  currentPlayerTab = pid;
  document.querySelectorAll('.player-tab').forEach(t => t.classList.remove('active'));
  const tabs = document.querySelectorAll('.player-tab');
  const idx = activeGame.playerIds.indexOf(pid);
  if (tabs[idx]) tabs[idx].classList.add('active');
}

async function renderLiveStats(playerMap) {
  if (!playerMap) {
    const players = await DB.getAll('players');
    playerMap = {};
    players.forEach(p => playerMap[p.id] = p);
  }

  const container = document.getElementById('liveStats');

  let html = '<table class="table table-dark table-striped table-sm stats-table"><thead><tr><th>Jug</th>';
  html += '<th>2PM</th><th>2PI</th><th>2P%</th>';
  html += '<th>3PM</th><th>3PI</th><th>3P%</th>';
  html += '<th>TLM</th><th>TLI</th><th>TL%</th>';
  FIELDS.slice(6).forEach(f => html += `<th>${STAT_LABELS[f]}</th>`);
  html += '<th>PTS</th><th>VAL</th></tr></thead><tbody>';

  const totalRow = emptyStats();
  const sorted = activeGame.playerIds.map(pid => activePlayerStats[pid]).filter(Boolean);
  sorted.forEach(s => {
    const p = playerMap[s.playerId];
    const name = p ? abbrevName(p) : '?';
    const pts = calcScore(s);
    const val = calcVal(s);
    html += `<tr><td class="player-name">${esc(name)}</td>`;
    html += `<td>${s.twoMade}</td><td>${s.twoMissed}</td><td>${pct(s.twoMade, s.twoMissed)}</td>`;
    html += `<td>${s.threeMade}</td><td>${s.threeMissed}</td><td>${pct(s.threeMade, s.threeMissed)}</td>`;
    html += `<td>${s.ftMade}</td><td>${s.ftMissed}</td><td>${pct(s.ftMade, s.ftMissed)}</td>`;
    FIELDS.slice(6).forEach(f => html += `<td>${s[f]}</td>`);
    html += `<td>${pts}</td><td class="${val >= 0 ? 'val-pos' : 'val-neg'}">${val}</td></tr>`;
    FIELDS.slice(6).forEach(f => totalRow[f] += s[f]);
    totalRow.twoMade += s.twoMade; totalRow.twoMissed += s.twoMissed;
    totalRow.threeMade += s.threeMade; totalRow.threeMissed += s.threeMissed;
    totalRow.ftMade += s.ftMade; totalRow.ftMissed += s.ftMissed;
  });

  const totalPts = calcScore(totalRow);
  const totalVal = calcVal(totalRow);
  html += `<tr class="total-row"><td class="player-name">TOTAL</td>`;
  html += `<td>${totalRow.twoMade}</td><td>${totalRow.twoMissed}</td><td>${pct(totalRow.twoMade, totalRow.twoMissed)}</td>`;
  html += `<td>${totalRow.threeMade}</td><td>${totalRow.threeMissed}</td><td>${pct(totalRow.threeMade, totalRow.threeMissed)}</td>`;
  html += `<td>${totalRow.ftMade}</td><td>${totalRow.ftMissed}</td><td>${pct(totalRow.ftMade, totalRow.ftMissed)}</td>`;
  FIELDS.slice(6).forEach(f => html += `<td>${totalRow[f]}</td>`);
  html += `<td>${totalPts}</td><td class="${totalVal >= 0 ? 'val-pos' : 'val-neg'}">${totalVal}</td></tr>`;

  html += '</tbody></table>';
  container.innerHTML = html;
}

function abbrevName(p) {
  if (!p) return '?';
  const prefix = p.number ? '#' + p.number + ' ' : '';
  const name = p.name.length > 12 ? p.name.substring(0, 10) + '..' : p.name;
  return prefix + name;
}

async function addStat(field) {
  if (!currentPlayerTab || !activePlayerStats[currentPlayerTab]) return;

  const fields = [field];
  activePlayerStats[currentPlayerTab][field]++;

  if (MADE_AUTO[field]) {
    fields.push(MADE_AUTO[field]);
    activePlayerStats[currentPlayerTab][MADE_AUTO[field]]++;
  }

  const logScore = calcScore(totalStats());
  actionLog.push({
    playerId: currentPlayerTab,
    fields,
    text: STAT_NAMES[field] || field,
    period: activeGame.currentPeriod,
    teamScore: logScore,
    rivalScore: calcRivalScore()
  });

  if (!isEditing) {
    const existing = await DB.getByIndex('stats', 'gameId', activeGame.id);
    const found = existing.find(s => s.playerId === currentPlayerTab);
    if (found) {
      fields.forEach(f => found[f]++);
      await DB.put('stats', found);
    } else {
      const copy = { ...activePlayerStats[currentPlayerTab] };
      const newId = await DB.add('stats', copy);
      activePlayerStats[currentPlayerTab].id = newId;
    }
  }

  renderLiveStats();
  renderActionLog();
  document.getElementById('btnUndo').disabled = false;
  updateLiveScore();

  const btn = document.querySelector(`button[onclick="addStat('${field}')"]`);
  if (btn) flashButton(btn);
}

async function undoLastAction() {
  if (actionLog.length === 0) return;

  const last = actionLog.pop();

  if (last.playerId === -1) {
    const pts = parseInt(last.fields[0]);
    if (pts === 1) activeGame.rival1pt--;
    else if (pts === 2) activeGame.rival2pt--;
    else if (pts === 3) activeGame.rival3pt--;
    if (!isEditing) await DB.put('games', activeGame);
  } else {
    const stats = activePlayerStats[last.playerId];
    if (stats) {
      last.fields.forEach(f => {
        if (stats[f] > 0) stats[f]--;
      });

      if (!isEditing) {
        const existing = await DB.getByIndex('stats', 'gameId', activeGame.id);
        const found = existing.find(s => s.playerId === last.playerId);
        if (found) {
          last.fields.forEach(f => {
            if (found[f] > 0) found[f]--;
          });
          await DB.put('stats', found);
        }
      }
    }
  }

  renderLiveStats();
  renderActionLog();
  document.getElementById('btnUndo').disabled = actionLog.length === 0;
  updateLiveScore();
}

function toggleActionLog() {
  logVisible = !logVisible;
  const el = document.getElementById('liveActionLog');
  el.style.display = logVisible ? 'block' : 'none';
  document.getElementById('btnToggleLog').innerHTML = logVisible ? '&#128172; Amagar' : '&#128172; Jugada';
}

async function renderActionLog() {
  const container = document.getElementById('liveActionLog');
  const players = await DB.getAll('players');
  const pMap = {};
  players.forEach(p => pMap[p.id] = p);

  const max = Math.min(actionLog.length, 50);
  const start = actionLog.length - max;
  let html = '';
  for (let i = start; i < actionLog.length; i++) {
    const entry = actionLog[i];
    const p = pMap[entry.playerId];
    const label = p ? abbrevName(p) : '#' + entry.playerId;
    const actionText = entry.text || entry.fields.map(f => STAT_NAMES[f] || f).join(' + ');
    const qStr = entry.period ? `Q${entry.period}` : '';
    const scoreStr = (entry.teamScore !== undefined && entry.rivalScore !== undefined) ? `${entry.teamScore}-${entry.rivalScore}` : '';
    html += `<div class="log-entry">${qStr ? `<span class="log-q">${qStr}</span>` : ''}<span class="log-player">${esc(label)}</span> <span class="log-action">${esc(actionText)}</span>${scoreStr ? ` <span class="log-score">${scoreStr}</span>` : ''}</div>`;
  }
  container.innerHTML = html || '<div class="log-entry text-secondary">Cap acció encara</div>';
  container.scrollTop = container.scrollHeight;
}

async function addRivalStat(points) {
  if (!activeGame) return;
  const field = points === 1 ? 'rival1pt' : points === 2 ? 'rival2pt' : 'rival3pt';
  activeGame[field] = (activeGame[field] || 0) + 1;
  if (!isEditing) await DB.put('games', activeGame);
  const ts = totalStats();
  const sc = calcScore(ts);
  const rs = calcRivalScore();
  updateLiveScore();
  actionLog.push({ playerId: -1, fields: [`+${points} rival`], text: `+${points}`, period: activeGame.currentPeriod, teamScore: sc, rivalScore: rs });
  renderActionLog();
  const btn = document.querySelector(`button[onclick="addRivalStat(${points})"]`);
  if (btn) flashButton(btn);
}

async function nextPeriod() {
  if (activeGame.currentPeriod < activeGame.periods) {
    activeGame.currentPeriod++;
    if (!isEditing) await DB.put('games', activeGame);
    document.getElementById('livePeriod').textContent = `Quart ${activeGame.currentPeriod}/${activeGame.periods}`;
  }
}

async function prevPeriod() {
  if (activeGame.currentPeriod <= 1) return;
  if (!confirm(`Vols tornar al quart ${activeGame.currentPeriod - 1}?`)) return;
  activeGame.currentPeriod--;
  if (!isEditing) await DB.put('games', activeGame);
  document.getElementById('livePeriod').textContent = `Quart ${activeGame.currentPeriod}/${activeGame.periods}`;
}

async function resumeGame(gameId) {
  await saveCurrentSession();
  const game = await DB.get('games', gameId);
  if (!game) return;
  const stats = await DB.getByIndex('stats', 'gameId', gameId);
  activeGame = game;
  isEditing = false;
  activePlayerStats = {};
  actionLog = game.actions || [];
  for (const pid of game.playerIds) {
    const existing = stats.find(s => s.playerId === pid);
    activePlayerStats[pid] = existing ? { ...existing } : { gameId, playerId: pid, ...emptyStats() };
  }
  currentPlayerTab = game.playerIds[0] || null;
  navigateTo('viewLiveGame');
  renderLiveGame();
}

async function saveAndLeave() {
  await saveCurrentSession();
  activeGame = null;
  activePlayerStats = {};
  actionLog = [];
  isEditing = false;
  currentPlayerTab = null;
  navigateTo('viewHome');
  renderHome();
}

async function saveCurrentSession() {
  if (!activeGame) return;
  await syncStatsToDB();
  activeGame.actions = actionLog.slice(-300);
  await DB.put('games', activeGame);
}

async function endGame() {
  if (!confirm('Finalitzar el partit?')) return;
  await saveCurrentSession();
  if (activeGame) {
    activeGame.isActive = false;
    await DB.put('games', activeGame);
  }
  activeGame = null;
  activePlayerStats = {};
  actionLog = [];
  isEditing = false;
  currentPlayerTab = null;
  navigateTo('viewHistory');
  renderHistory();
}

async function syncStatsToDB() {
  if (!activeGame) return;
  const existing = await DB.getByIndex('stats', 'gameId', activeGame.id);
  for (const pid of activeGame.playerIds) {
    const stats = activePlayerStats[pid];
    if (!stats) continue;
    const found = existing.find(s => s.playerId === pid);
    if (found) {
      Object.assign(found, stats);
      await DB.put('stats', found);
    } else {
      await DB.add('stats', { ...stats });
    }
  }
}

// HISTORY
async function renderHistory() {
  const list = document.getElementById('gameList');
  const games = await DB.getAll('games');
  const allStats = await DB.getAll('stats');
  const finished = games.filter(g => g.isActive === false || g.isActive === undefined);
  const sorted = finished.sort((a, b) => new Date(b.date) - new Date(a.date));

  const gameScores = {};
  allStats.forEach(s => {
    if (!gameScores[s.gameId]) gameScores[s.gameId] = emptyStats();
    Object.keys(gameScores[s.gameId]).forEach(k => gameScores[s.gameId][k] += s[k]);
  });

  if (sorted.length === 0) {
    list.innerHTML = '<div class="text-center text-secondary py-4">&#128214;<br>No hi ha partits</div>';
    return;
  }

  list.innerHTML = sorted.map(g => {
    const d = new Date(g.date);
    const dateStr = d.toLocaleDateString('ca-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    const status = g.isActive ? '<span class="text-success">&#9679; En curs</span>' : '';
    const tStats = gameScores[g.id];
    const pts = tStats ? calcScore(tStats) : 0;
    const rPts = (g.rival1pt || 0) + (g.rival2pt || 0) * 2 + (g.rival3pt || 0) * 3;
    return `
      <li class="list-group-item list-group-item-action d-flex align-items-center justify-content-between px-2 py-2 game-item" data-game-id="${g.id}">
        <div>
          <div class="fw-semibold">${esc(g.team)} <span class="game-score">${pts}</span> - ${rPts} ${esc(g.opponent)} ${status}</div>
          <div class="small text-secondary">${dateStr} &middot; ${g.periods} quarts</div>
        </div>
        <button class="btn btn-sm btn-outline-danger delete-game-btn" data-game-id="${g.id}">&#128465;</button>
      </li>
    `;
  }).join('');
}

async function deleteGame(id) {
  if (!confirm('Eliminar partit i totes les seves estadístiques?')) return;
  const stats = await DB.getByIndex('stats', 'gameId', id);
  for (const s of stats) await DB.delete('stats', s.id);
  await DB.delete('games', id);
  if (activeGame && activeGame.id === id) {
    activeGame = null;
    activePlayerStats = {};
    actionLog = [];
    isEditing = false;
  }
  renderHistory();
}

let cachedDetailGame = null;
let cachedDetailPlayerMap = {};

// GAME DETAIL
async function viewGameDetail(gameId) {
  detailQuarterFilter = null;
  const game = await DB.get('games', gameId);
  if (!game) return;
  const stats = await DB.getByIndex('stats', 'gameId', gameId);
  const players = await DB.getAll('players');
  const playerMap = {};
  players.forEach(p => playerMap[p.id] = p);
  cachedDetailGame = game;
  cachedDetailPlayerMap = playerMap;

  const d = new Date(game.date);
  const dateStr = d.toLocaleDateString('ca-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const statsByPlayer = {};
  stats.forEach(s => { statsByPlayer[s.playerId] = s; });

  const totalRowH = emptyStats();
  stats.forEach(s => Object.keys(totalRowH).forEach(k => totalRowH[k] += s[k]));
  const gPts = calcScore(totalRowH);
  const gRival = (game.rival1pt || 0) + (game.rival2pt || 0) * 2 + (game.rival3pt || 0) * 3;
  const homeSide = game.isHome !== false;
  document.getElementById('detailHeader').innerHTML = `
    <div class="fs-5 fw-bold mb-1">
      <span style="color:${homeSide ? 'var(--primary)' : '#888'}">${esc(game.team)}</span>
      vs
      <span style="color:${!homeSide ? 'var(--primary)' : '#888'}">${esc(game.opponent)}</span>
    </div>
    <div class="fs-3 fw-bold" style="color:var(--primary)">${gPts} - ${gRival}</div>
    <div class="small text-secondary mb-2">${dateStr} &middot; ${game.periods} quarts</div>
  `;

  // Stats table
  let html = '<table class="table table-dark table-striped table-sm stats-table"><thead><tr><th>Jug</th>';
  html += '<th>2PM</th><th>2PI</th><th>2P%</th>';
  html += '<th>3PM</th><th>3PI</th><th>3P%</th>';
  html += '<th>TLM</th><th>TLI</th><th>TL%</th>';
  FIELDS.slice(6).forEach(f => html += `<th>${STAT_LABELS[f]}</th>`);
  html += '<th>PTS</th><th>VAL</th></tr></thead><tbody>';

  const totalRow = emptyStats();
  const sorted = game.playerIds.map(pid => statsByPlayer[pid]).filter(Boolean);
  sorted.forEach(s => {
    const p = playerMap[s.playerId];
    const name = p ? abbrevName(p) : '?';
    const pts = calcScore(s);
    const val = calcVal(s);
    html += `<tr><td class="player-name">${esc(name)}</td>`;
    html += `<td>${s.twoMade}</td><td>${s.twoMissed}</td><td>${pct(s.twoMade, s.twoMissed)}</td>`;
    html += `<td>${s.threeMade}</td><td>${s.threeMissed}</td><td>${pct(s.threeMade, s.threeMissed)}</td>`;
    html += `<td>${s.ftMade}</td><td>${s.ftMissed}</td><td>${pct(s.ftMade, s.ftMissed)}</td>`;
    FIELDS.slice(6).forEach(f => html += `<td>${s[f]}</td>`);
    html += `<td>${pts}</td><td>${val}</td></tr>`;
    FIELDS.slice(6).forEach(f => totalRow[f] += s[f]);
    totalRow.twoMade += s.twoMade; totalRow.twoMissed += s.twoMissed;
    totalRow.threeMade += s.threeMade; totalRow.threeMissed += s.threeMissed;
    totalRow.ftMade += s.ftMade; totalRow.ftMissed += s.ftMissed;
  });

  const totalPts = calcScore(totalRow);
  const totalVal = calcVal(totalRow);
  html += `<tr style="font-weight:700;border-top:2px solid var(--primary)"><td>TOTAL</td>`;
  html += `<td>${totalRow.twoMade}</td><td>${totalRow.twoMissed}</td><td>${pct(totalRow.twoMade, totalRow.twoMissed)}</td>`;
  html += `<td>${totalRow.threeMade}</td><td>${totalRow.threeMissed}</td><td>${pct(totalRow.threeMade, totalRow.threeMissed)}</td>`;
  html += `<td>${totalRow.ftMade}</td><td>${totalRow.ftMissed}</td><td>${pct(totalRow.ftMade, totalRow.ftMissed)}</td>`;
  FIELDS.slice(6).forEach(f => html += `<td>${totalRow[f]}</td>`);
  html += `<td>${totalPts}</td><td>${totalVal}</td></tr>`;

  html += '</tbody></table>';
  document.getElementById('detailStats').innerHTML = html;

  document.getElementById('detailActions').innerHTML = `
    <button class="btn btn-primary" onclick="editGame(${game.id})">&#9998; Editar Estadístiques</button>
  `;

  renderDetailPlays(game, playerMap, homeSide);
  navigateTo('viewGameDetail');
  switchDetailTab('stats');
}

function switchDetailTab(tab) {
  document.getElementById('dtabStats').classList.toggle('active', tab === 'stats');
  document.getElementById('dtabPlays').classList.toggle('active', tab === 'plays');
  document.getElementById('detailStats').style.display = tab === 'stats' ? '' : 'none';
  document.getElementById('detailPlays').style.display = tab === 'plays' ? '' : 'none';
}

function renderDetailPlays(game, playerMap, homeSide) {
  const container = document.getElementById('detailPlays');
  if (!game.actions || game.actions.length === 0) {
    container.innerHTML = '<div class="text-secondary text-center py-4">No hi ha jugades registrades</div>';
    return;
  }

  const periods = game.periods || 4;

  let html = '<div class="btn-group btn-group-sm mb-2 flex-wrap">';
  html += `<button class="btn btn-outline-secondary ${detailQuarterFilter === null ? 'active' : ''}" onclick="setDetailQuarter(null,${game.id})">Tots</button>`;
  for (let q = 1; q <= periods; q++) {
    html += `<button class="btn btn-outline-secondary ${detailQuarterFilter === q ? 'active' : ''}" onclick="setDetailQuarter(${q},${game.id})">Q${q}</button>`;
  }
  html += '</div>';

  html += '<div class="chat-log">';

  const filtered = detailQuarterFilter === null ? game.actions : game.actions.filter(a => a.period === detailQuarterFilter);
  filtered.forEach(a => {
    const qStr = a.period ? `Q${a.period}` : '?';
    const scoreStr = (a.teamScore !== undefined && a.rivalScore !== undefined) ? `${a.teamScore} - ${a.rivalScore}` : '';

    if (a.playerId === -1) {
      // Visitor action
      const pts = a.fields[0];
      html += `<div class="chat-row visitor">
        <div class="chat-left"></div>
        <div class="chat-center"><span class="chat-q">${qStr}</span> <span class="chat-score">${scoreStr}</span></div>
        <div class="chat-right"><span class="chat-action">+${pts}</span></div>
      </div>`;
    } else {
      // Local action
      const p = playerMap[a.playerId];
      const label = p ? abbrevName(p) : '#' + a.playerId;
      const texts = a.text || a.fields.map(f => STAT_NAMES[f] || f).join(' + ');
      html += `<div class="chat-row local">
        <div class="chat-left"><span class="chat-player">${esc(label)}</span> <span class="chat-action">${esc(texts)}</span></div>
        <div class="chat-center"><span class="chat-q">${qStr}</span> <span class="chat-score">${scoreStr}</span></div>
        <div class="chat-right"></div>
      </div>`;
    }
  });

  html += '</div>';
  container.innerHTML = html;
}

function setDetailQuarter(q, gameId) {
  detailQuarterFilter = q;
  if (cachedDetailGame && cachedDetailGame.id === gameId) {
    renderDetailPlays(cachedDetailGame, cachedDetailPlayerMap, cachedDetailGame.isHome !== false);
    switchDetailTab('plays');
  } else {
    viewGameDetail(gameId);
  }
}

// EDIT GAME
async function editGame(gameId) {
  await saveCurrentSession();

  const game = await DB.get('games', gameId);
  if (!game) return;

  activeGame = { ...game };
  isEditing = true;
  actionLog = [];

  const stats = await DB.getByIndex('stats', 'gameId', gameId);
  activePlayerStats = {};
  for (const pid of game.playerIds) {
    const existing = stats.find(s => s.playerId === pid);
    activePlayerStats[pid] = existing ? { ...existing } : { gameId, playerId: pid, ...emptyStats() };
  }

  currentPlayerTab = game.playerIds[0] || null;
  navigateTo('viewLiveGame');
  renderLiveGame();
}

async function saveEditGame() {
  await DB.put('games', activeGame);
  await syncStatsToDB();
  const game = await DB.get('games', activeGame.id);
  if (game && actionLog.length > 0) {
    game.actions = (game.actions || []).concat(actionLog).slice(-500);
    await DB.put('games', game);
  }
  const gameId = activeGame.id;
  activeGame = null;
  activePlayerStats = {};
  actionLog = [];
  isEditing = false;
  currentPlayerTab = null;
  navigateTo('viewGameDetail');
  viewGameDetail(gameId);
}

async function cancelEditGame() {
  if (actionLog.length > 0 && !confirm('Perdràs els canvis no guardats. Continuar?')) return;
  const gameId = activeGame.id;
  activeGame = null;
  activePlayerStats = {};
  actionLog = [];
  isEditing = false;
  currentPlayerTab = null;
  navigateTo('viewGameDetail');
  viewGameDetail(gameId);
}

function pct(a, b) {
  if (b === 0) return '-';
  return (a / b * 100).toFixed(1) + '%';
}

function switchStatsTab(mode) {
  statsMode = mode;
  document.getElementById('tabTotals').classList.toggle('active', mode === 'totals');
  document.getElementById('tabAverages').classList.toggle('active', mode === 'averages');
  renderGlobalStats();
}

// GLOBAL STATS
async function renderGlobalStats() {
  const container = document.getElementById('globalStats');
  const allStats = await DB.getAll('stats');
  const allGames = await DB.getAll('games');
  const finishedIds = new Set(allGames.filter(g => !g.isActive).map(g => g.id));
  const players = await DB.getAll('players');
  const playerMap = {};
  players.forEach(p => playerMap[p.id] = p);

  const stats = allStats.filter(s => finishedIds.has(s.gameId));
  if (stats.length === 0) {
    container.innerHTML = '<div class="text-center text-secondary py-4">&#128200;<br>No hi ha dades encara</div>';
    return;
  }

  const totals = {};
  const gamesCount = {};
  stats.forEach(s => {
    if (!totals[s.playerId]) {
      totals[s.playerId] = emptyStats();
      gamesCount[s.playerId] = 0;
    }
    Object.keys(totals[s.playerId]).forEach(k => totals[s.playerId][k] += s[k]);
    gamesCount[s.playerId]++;
  });

  if (statsMode === 'totals') {
    let html = '<table class="table table-dark table-striped table-sm stats-table"><thead><tr><th>Jug</th><th>PJ</th>';
    html += '<th>2PM</th><th>2PI</th><th>2P%</th>';
    html += '<th>3PM</th><th>3PI</th><th>3P%</th>';
    html += '<th>TLM</th><th>TLI</th><th>TL%</th>';
    FIELDS.slice(6).forEach(f => html += `<th>${STAT_LABELS[f]}</th>`);
    html += '<th>PTS</th><th>VAL</th></tr></thead><tbody>';

    Object.keys(totals).forEach(pid => {
      const t = totals[pid];
      const p = playerMap[parseInt(pid)];
      const name = p ? abbrevName(p) : '?';
      const pts = calcScore(t);
      const val = calcVal(t);
      html += `<tr><td class="player-name">${esc(name)}</td><td>${gamesCount[pid]}</td>`;
      html += `<td>${t.twoMade}</td><td>${t.twoMissed}</td><td>${pct(t.twoMade, t.twoMissed)}</td>`;
      html += `<td>${t.threeMade}</td><td>${t.threeMissed}</td><td>${pct(t.threeMade, t.threeMissed)}</td>`;
      html += `<td>${t.ftMade}</td><td>${t.ftMissed}</td><td>${pct(t.ftMade, t.ftMissed)}</td>`;
      FIELDS.slice(6).forEach(f => html += `<td>${t[f]}</td>`);
      html += `<td>${pts}</td><td>${val}</td></tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  } else {
    let html = '<table class="table table-dark table-striped table-sm stats-table"><thead><tr><th>Jug</th><th>PJ</th>';
    html += '<th>2PM</th><th>2PI</th><th>2P%</th>';
    html += '<th>3PM</th><th>3PI</th><th>3P%</th>';
    html += '<th>TLM</th><th>TLI</th><th>TL%</th>';
    FIELDS.slice(6).forEach(f => html += `<th>${STAT_LABELS[f]}</th>`);
    html += '<th>PPT</th><th>VPP</th></tr></thead><tbody>';

    Object.keys(totals).forEach(pid => {
      const t = totals[pid];
      const p = playerMap[parseInt(pid)];
      const name = p ? abbrevName(p) : '?';
      const n = gamesCount[pid];
      const pts = calcScore(t);
      const val = calcVal(t);
      html += `<tr><td>${esc(name)}</td><td>${n}</td>`;
      html += `<td>${(t.twoMade / n).toFixed(1)}</td><td>${(t.twoMissed / n).toFixed(1)}</td><td>${pct(t.twoMade, t.twoMissed)}</td>`;
      html += `<td>${(t.threeMade / n).toFixed(1)}</td><td>${(t.threeMissed / n).toFixed(1)}</td><td>${pct(t.threeMade, t.threeMissed)}</td>`;
      html += `<td>${(t.ftMade / n).toFixed(1)}</td><td>${(t.ftMissed / n).toFixed(1)}</td><td>${pct(t.ftMade, t.ftMissed)}</td>`;
      FIELDS.slice(6).forEach(f => html += `<td>${(t[f] / n).toFixed(1)}</td>`);
      html += `<td>${(pts / n).toFixed(1)}</td>`;
      html += `<td>${(val / n).toFixed(1)}</td></tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }
}

// EXPORT / IMPORT
async function exportData() {
  const players = await DB.getAll('players');
  const games = await DB.getAll('games');
  const stats = await DB.getAll('stats');
  const data = { players, games, stats, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `basquet-stats-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData() {
  document.getElementById('importFile').click();
}

async function handleImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.players || !data.games || !data.stats) throw new Error('Format invàlid');

    if (!confirm(`Importar ${data.players.length} jugadors, ${data.games.length} partits i ${data.stats.length} registres?`)) return;

    for (const p of data.players) {
      const { id, ...rest } = p;
      await DB.add('players', rest);
    }
    for (const g of data.games) {
      const { id, ...rest } = g;
      await DB.add('games', rest);
    }
    for (const s of data.stats) {
      const { id, ...rest } = s;
      await DB.add('stats', rest);
    }
    alert('Dades importades correctament!');
    renderGlobalStats();
  } catch (e) {
    alert('Error: ' + e.message);
  }
  event.target.value = '';
}

// UTILITY
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// #7 - Flash feedback on stat buttons
const FLASH_MAP = { 'btn-outline-success': 'btn-flash-green', 'btn-outline-danger': 'btn-flash-red', 'btn-outline-warning': 'btn-flash-orange', 'btn-outline-info': 'btn-flash-info' };
function flashButton(el) {
  const flashClass = FLASH_MAP[Object.keys(FLASH_MAP).find(c => el.classList.contains(c))];
  if (!flashClass) return;
  el.classList.remove(flashClass);
  void el.offsetWidth;
  el.classList.add(flashClass);
  el.addEventListener('animationend', () => el.classList.remove(flashClass), { once: true });
}

// INIT - don't auto-load any game; show all active on home
(async function init() {
  renderHome();
})();

document.addEventListener('visibilitychange', () => {
  if (document.hidden && activeGame) renderLiveGame();
});

document.addEventListener('click', e => {
  const item = e.target.closest('.game-item');
  if (!item) return;
  const id = parseInt(item.dataset.gameId);
  if (!id) return;
  if (e.target.closest('.delete-game-btn')) { deleteGame(id); return; }
  viewGameDetail(id).catch(err => console.error('viewGameDetail:', err));
});

// #9 - Swipe left/right on live tabs to change player
(function initSwipeGesture() {
  let touchStartX = 0;
  let touchStartY = 0;
  const threshold = 50;

  document.addEventListener('touchstart', e => {
    const tabs = document.getElementById('liveTabs');
    if (!tabs || !tabs.contains(e.target)) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (touchStartX === 0) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    touchStartX = 0;
    if (Math.abs(dx) < threshold || Math.abs(dy) > Math.abs(dx)) return;
    if (!activeGame || activeGame.playerIds.length < 2) return;
    const idx = activeGame.playerIds.indexOf(currentPlayerTab);
    if (dx < 0 && idx < activeGame.playerIds.length - 1) {
      selectPlayerTab(activeGame.playerIds[idx + 1]);
      renderLiveStats();
    } else if (dx > 0 && idx > 0) {
      selectPlayerTab(activeGame.playerIds[idx - 1]);
      renderLiveStats();
    }
  }, { passive: true });
})();

// #10 - Long-press on undo button = undo last 5 actions
(function initUndoLongPress() {
  let timer = null;
  const btn = () => document.getElementById('btnUndo');
  document.addEventListener('mousedown', e => {
    if (e.target.id !== 'btnUndo') return;
    timer = setTimeout(() => {
      for (let i = 0; i < 5 && actionLog.length > 0; i++) undoLastAction();
    }, 600);
  });
  document.addEventListener('mouseup', () => { clearTimeout(timer); timer = null; });
  document.addEventListener('touchstart', e => {
    if (e.target.id !== 'btnUndo') return;
    timer = setTimeout(() => {
      for (let i = 0; i < 5 && actionLog.length > 0; i++) undoLastAction();
    }, 600);
  }, { passive: true });
  document.addEventListener('touchend', () => { clearTimeout(timer); timer = null; });
})();
