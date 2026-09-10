let currentPlayerTab = null;
let activeGame = null;
let activePlayerStats = {};
let actionLog = [];
let isEditing = false;
let logVisible = false;
let statsVisible = true;
let editingPlayerId = null;
let statsMode = 'totals';
let statsSortKey = null;
let statsSortAsc = true;
let detailQuarterFilter = null;
let gameSelection = new Set();

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
const REST_FIELDS = ['oReb','dReb','turnovers','steals','blocks','blocksAgainst','pFouls','foulsReceived'];

const MADE_AUTO = { twoMade: 'twoMissed', threeMade: 'threeMissed', ftMade: 'ftMissed' };

const GAME_TYPES = ['NBA', 'Lliga Catalana', 'ACB', 'Eurolliga', 'Supercopa', 'Copa del Rei', 'Amistós'];

// TEAMS
function seasonOf(d) {
  const y = parseInt((d || '').slice(0, 4), 10);
  const m = parseInt((d || '').slice(5, 7), 10);
  if (isNaN(y) || isNaN(m)) return null;
  const start = m >= 8 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

function populateSeason(selectId, games) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const prev = sel.value;
  const seasons = Array.from(new Set(games
    .map(g => seasonOf(g.date))
    .filter(s => s !== null))).sort();
  sel.innerHTML = `<option value="all">Tots</option>` +
    seasons.map(s => `<option value="${s}">${s}</option>`).join('');
  if (prev !== '' && Array.from(sel.options).some(o => o.value === prev)) sel.value = prev;
}

function emptyStats() {
  return { twoMade:0, twoMissed:0, threeMade:0, threeMissed:0, ftMade:0, ftMissed:0, oReb:0, dReb:0, assists:0, turnovers:0, steals:0, blocks:0, pFouls:0, foulsReceived:0, blocksAgainst:0 };
}

function toggleGameSide() {
  const isHome = document.querySelector('input[name="gameSide"]:checked').value === 'local';
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

function calcQuarterScore() {
  const current = activeGame ? activeGame.currentPeriod : 0;
  let team = 0;
  let rival = 0;
  for (const a of actionLog) {
    if (a.period !== current) continue;
    if (a.type === 'sub') continue;
    if (a.playerId === -1) {
      rival += parseInt(a.fields && a.fields[0]) || 0;
    } else {
      (a.fields || []).forEach(f => {
        if (f === 'twoMade') team += 2;
        else if (f === 'threeMade') team += 3;
        else if (f === 'ftMade') team += 1;
      });
    }
  }
  return { team, rival };
}

function periodLabel(period, periods) {
  if (period <= periods) return `Quart ${period}/${periods}`;
  const ot = period - periods;
  return `${ot}.a Pròrroga`;
}

function periodsDesc(game) {
  if (game.currentPeriod > game.periods) {
    return `${game.periods} quarts + ${game.currentPeriod - game.periods}.a pròrroga`;
  }
  return `${game.periods} quarts`;
}

function updateLiveScore() {
  const ts = totalStats();
  const sc = calcScore(ts);
  const rs = calcRivalScore();
  const home = activeGame && activeGame.isHome !== false;
  const team = activeGame ? esc(activeGame.team) : '';
  const opp = activeGame ? esc(activeGame.opponent) : '';
  const q = calcQuarterScore();
  document.getElementById('liveScore').innerHTML =
    `<span style="color:${home ? 'var(--primary)' : '#888'}">${team}</span> ${sc} - ${rs} <span style="color:${!home ? 'var(--primary)' : '#888'}">${opp}</span>` +
    ` <span class="small text-secondary">(${q.team}-${q.rival})</span>`;
}

// POPUP
function openPopup(title, bodyHtml, footerHtml) {
  document.getElementById('popupTitle').textContent = title;
  document.getElementById('popupBody').innerHTML = bodyHtml;
  document.getElementById('popupFooter').innerHTML = footerHtml || '';
  document.getElementById('popupOverlay').style.display = 'flex';
}

function closePopup() {
  document.getElementById('popupOverlay').style.display = 'none';
}

function playerLabel(p) {
  return p ? (p.number && p.number !== '' ? '#' + p.number + ' ' : '') + p.name : '?';
}

// LINEUP (5 inicial)
let lineupResolve = null;
let lineupSelection = [];
let lineupPlayerIds = [];

function askStartingLineup(playerIds) {
  return new Promise(resolve => {
    lineupResolve = resolve;
    lineupPlayerIds = playerIds;
    lineupSelection = playerIds.slice(0, 5);
    renderLineupPicker();
  });
}

async function renderLineupPicker() {
  const players = await DB.getAll('players');
  const pMap = {};
  players.forEach(p => pMap[p.id] = p);
  const body = lineupPlayerIds.map(pid => {
    const p = pMap[pid];
    const on = lineupSelection.includes(pid);
    return `
      <div class="d-flex align-items-center gap-2 mb-2">
        <button class="btn ${on ? 'btn-success' : 'btn-outline-secondary'} flex-grow-1" onclick="toggleLineup(${pid})">${esc(playerLabel(p))}</button>
        <span class="badge ${on ? 'bg-success' : 'bg-secondary'}">${on ? 'PISTA' : 'BANQUETA'}</span>
      </div>
    `;
  }).join('');
  const footer = `<button class="btn btn-outline-secondary" onclick="cancelLineup()">Cancel·lar</button>
    <button class="btn btn-primary" onclick="confirmLineup()" ${lineupSelection.length === 5 ? '' : 'disabled'}>Confirmar (${lineupSelection.length}/5)</button>`;
  openPopup('5 inicial - tria qui surt a pista', body, footer);
}

function cancelLineup() {
  closePopup();
  if (lineupResolve) {
    const r = lineupResolve;
    lineupResolve = null;
    r(null);
  }
}

function toggleLineup(pid) {
  const idx = lineupSelection.indexOf(pid);
  if (idx >= 0) lineupSelection.splice(idx, 1);
  else {
    if (lineupSelection.length >= 5) return;
    lineupSelection.push(pid);
  }
  renderLineupPicker();
}

function confirmLineup() {
  if (lineupSelection.length !== 5) return;
  const result = lineupSelection.slice();
  closePopup();
  if (lineupResolve) {
    const r = lineupResolve;
    lineupResolve = null;
    r(result);
  }
}

// SUBSTITUCIÓ
function ensureOnCourt() {
  if (!activeGame) return [];
  const court = activeGame.onCourtPlayerIds;
  if (Array.isArray(court) && court.length > 0) return court;
  activeGame.onCourtPlayerIds = activeGame.playerIds.slice(0, 5);
  if (activeGame.id) DB.put('games', activeGame).catch(() => {});
  return activeGame.onCourtPlayerIds;
}

function onCourtIds() {
  return activeGame ? (Array.isArray(activeGame.onCourtPlayerIds) && activeGame.onCourtPlayerIds.length > 0
    ? activeGame.onCourtPlayerIds : activeGame.playerIds.slice(0, 5)) : [];
}

async function openSubstitution() {
  if (!activeGame || !currentPlayerTab || isEditing) return;
  const outId = currentPlayerTab;
  const court = onCourtIds();
  const benchIds = activeGame.playerIds.filter(pid => !court.includes(pid) && pid !== outId);
  if (benchIds.length === 0) {
    alert('No hi ha jugadors a la banqueta');
    return;
  }
  const players = await DB.getAll('players');
  const pMap = {};
  players.forEach(p => pMap[p.id] = p);
  const numOfP = p => (p && p.number !== '' && p.number != null) ? parseInt(p.number) : null;
  const sortedBench = benchIds.slice().sort((a, b) => {
    const an = numOfP(pMap[a]);
    const bn = numOfP(pMap[b]);
    if (an === null && bn === null) return 0;
    if (an === null) return 1;
    if (bn === null) return -1;
    return an - bn;
  });
  const html = '<div class="small text-secondary mb-2">Substituir a ' + esc(playerLabel(pMap[outId])) + '</div>' +
    sortedBench.map(pid => `
      <button class="btn btn-outline-light w-100 mb-2 d-flex align-items-center justify-content-between" onclick="doSubstitution(${pid})">
        <span>${esc(playerLabel(pMap[pid]))}</span><span class="badge bg-secondary">BANQUETA</span>
      </button>
    `).join('');
  openPopup('Canvi de jugador', html, '<button class="btn btn-outline-secondary" onclick="closePopup()">Cancel·lar</button>');
}

async function doSubstitution(inId) {
  const outId = currentPlayerTab;
  if (outId === inId || !activeGame) return;
  const court = ensureOnCourt();
  const idx = court.indexOf(outId);
  if (idx >= 0) court.splice(idx, 1);
  if (!court.includes(inId)) court.push(inId);
  const ts = totalStats();
  const sc = calcScore(ts);
  const rs = calcRivalScore();
  actionLog.push({
    type: 'sub', outId, inId,
    period: activeGame.currentPeriod,
    teamScore: sc, rivalScore: rs
  });
  if (!isEditing) await DB.put('games', activeGame);
  currentPlayerTab = inId;
  closePopup();
  renderLiveGame();
}

async function openAddPlayerPopup() {
  if (!activeGame) return;
  const players = await DB.getAll('players');
  const others = players.filter(p => !activeGame.playerIds.includes(p.id) && p.teamId === activeGame.teamId);
  const createForm = `
    <div class="small text-secondary mb-1">Crear jugador nou:</div>
    <div class="input-group mb-3">
      <input type="text" id="newLiveName" class="form-control" placeholder="Nom">
      <input type="number" id="newLiveNumber" class="form-control" placeholder="Num." min="0" max="99" style="max-width:70px">
    </div>`;
  const list = others.length
    ? `<div class="small text-secondary mb-1">Del teu equip:</div>` +
      others.map(p => `
        <button class="btn btn-outline-light w-100 mb-1 d-flex align-items-center justify-content-between" onclick="addPlayerToLiveGame(${p.id})">
          <span>${esc(playerLabel(p))}</span>
        </button>`).join('')
    : `<div class="small text-secondary mb-2">Tots els jugadors del teu equip ja són a la convocatòria.</div>`;
  openPopup('Afegir jugador', createForm + list,
    `<button class="btn btn-outline-secondary" onclick="closePopup()">Cancel·lar</button>
     <button class="btn btn-primary" onclick="createAndAddPlayerToLive()">Afegir</button>`);
}

async function createAndAddPlayerToLive() {
  const name = document.getElementById('newLiveName').value.trim();
  if (!name) return alert('Introdueix un nom');
  const number = document.getElementById('newLiveNumber').value.trim();
  const teamId = activeGame ? activeGame.teamId : null;
  const pid = await DB.add('players', { name, number: number || '', teamId });
  await addPlayerToLiveGame(pid);
}

async function addPlayerToLiveGame(pid) {
  if (!activeGame || activeGame.playerIds.includes(pid)) {
    closePopup();
    return;
  }
  activeGame.playerIds.push(pid);
  activePlayerStats[pid] = { gameId: activeGame.id, playerId: pid, ...emptyStats() };
  const ts = totalStats();
  const sc = calcScore(ts);
  const rs = calcRivalScore();
  actionLog.push({ type: 'addPlayer', playerId: pid, period: activeGame.currentPeriod, teamScore: sc, rivalScore: rs });
  if (!isEditing) {
    await DB.put('games', activeGame);
    await DB.add('stats', { ...activePlayerStats[pid] });
  }
  closePopup();
  renderLiveGame();
}

// NAVIGATION
function navigateTo(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
  document.getElementById('btnBack').style.display = viewId === 'viewHome' ? 'none' : 'block';
  document.getElementById('btnAddPlayerTop').style.display =
    (viewId === 'viewLiveGame' && activeGame && !isEditing) ? '' : 'none';

  const titles = {
    viewHome: 'Bàsquet Stats',
    viewPlayers: 'Jugadors',
    viewTeams: 'Equips',
    viewNewGame: 'Nou Partit',
    viewLiveGame: activeGame && isEditing ? 'Editar Partit' : 'Partit en Viu',
    viewHistory: 'Historial',
    viewGameDetail: 'Detall del Partit',
    viewStats: 'Estadístiques Globals',
    viewRecords: 'Records'
  };
  document.getElementById('appTitle').textContent = titles[viewId] || 'Bàsquet Stats';

  updateBottomNav();
  switch (viewId) {
    case 'viewHome': renderHome(); break;
    case 'viewPlayers':
      { const f = document.getElementById('playerTeamFilter'); if (f) f.value = 'all'; }
      renderPlayers(); break;
    case 'viewTeams': renderTeams(); break;
    case 'viewNewGame': renderNewGame(); break;
    case 'viewHistory': renderHistory(); break;
    case 'viewStats':
      { const t = document.getElementById('statsTeamFilter'); if (t) t.value = 'all'; const c = document.getElementById('statsTypeFilter'); if (c) c.value = 'all'; const s = document.getElementById('statsSeasonFilter'); if (s) s.value = 'all'; }
      statsSortKey = null; statsSortAsc = true;
      renderGlobalStats(); break;
    case 'viewRecords': recordsMode = 'game'; recordsQuarter = null; recordsGroup = 'player';
      { const t = document.getElementById('recordsTeamFilter'); if (t) t.value = 'all'; const c = document.getElementById('recordsTypeFilter'); if (c) c.value = 'all'; const s = document.getElementById('recordsSeasonFilter'); if (s) s.value = 'all'; }
      { const p = document.getElementById('tabRecordsPlayer'); if (p) p.classList.add('active'); const tm = document.getElementById('tabRecordsTeam'); if (tm) tm.classList.remove('active'); }
      renderRecords(); break;
  }
}

function navigateBack() {
  const active = document.querySelector('.view.active');
  if (!active) return;
  switch (active.id) {
    case 'viewGameDetail': navigateTo('viewHistory'); break;
    case 'viewTeams': navigateTo('viewHome'); break;
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
        &#127936; ${esc(g.team)} ${pts} - ${rPts} ${esc(g.opponent)}<br><small>${periodLabel(g.currentPeriod, g.periods)} ${isCurrent ? '(actual)' : ''}</small>
      </button>`;
    });
  }

  if (!hasPlayers) {
    const teams = await DB.getAll('teams');
    const hasTeams = teams.length > 0;
    const cta = hasTeams
      ? `<button class="btn btn-outline-warning w-100 py-3" onclick="navigateTo('viewPlayers')">&#128101; Afegeix jugadors per començar</button>`
      : `<button class="btn btn-outline-warning w-100 py-3" onclick="navigateTo('viewTeams')">&#128101; Afegeix equips per començar</button>`;
    grid.innerHTML = `
      <div class="col-12">${cta}</div>
      <div class="col-12"><button class="btn btn-success w-100 py-3" onclick="importGames()">&#10515; Importar dades</button></div>
    `;
    return;
  }

  grid.innerHTML = `
    ${activeHtml ? '<div class="col-12"><div class="small text-secondary mb-1">Partits en curs:</div>' + activeHtml + '</div>' : ''}
    <div class="col-6"><button class="btn btn-outline-light w-100 py-4 fs-5" onclick="navigateTo('viewNewGame')">&#127936;<br><small>Nou Partit</small></button></div>
    <div class="col-6"><button class="btn btn-outline-light w-100 py-4 fs-5" onclick="navigateTo('viewHistory')">&#128214;<br><small>Historial</small></button></div>
    <div class="col-6"><button class="btn btn-outline-light w-100 py-4 fs-5" onclick="navigateTo('viewPlayers')">&#128100;<br><small>Jugadors</small></button></div>
    <div class="col-6"><button class="btn btn-outline-light w-100 py-4 fs-5" onclick="navigateTo('viewTeams')">&#128101;<br><small>Equips</small></button></div>
    <div class="col-6"><button class="btn btn-outline-light w-100 py-4 fs-5" onclick="navigateTo('viewStats')">&#128200;<br><small>Estadístiques</small></button></div>
    <div class="col-6"><button class="btn btn-outline-light w-100 py-4 fs-5" onclick="navigateTo('viewRecords')">&#127942;<br><small>Records</small></button></div>
  `;
}

// PLAYERS
let playerSelection = new Set();

async function renderPlayers() {
  const list = document.getElementById('playerList');
  const players = await DB.getAll('players');
  const teams = await DB.getAll('teams');
  const teamMap = {};
  teams.forEach(t => teamMap[t.id] = t);
  const addBox = document.getElementById('playerAddBox');
  if (addBox) addBox.style.display = teams.length ? '' : 'none';
  const teamSel = document.getElementById('playerTeam');
  if (teamSel) {
    const prevTeam = teamSel.value;
    teamSel.innerHTML = teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('') ||
      `<option value="">Sense equip</option>`;
    if (prevTeam !== '' && Array.from(teamSel.options).some(o => o.value === prevTeam)) teamSel.value = prevTeam;
  }
  const filterSel = document.getElementById('playerTeamFilter');
  if (filterSel) {
    const prevFilter = filterSel.value;
    filterSel.innerHTML = `<option value="all">Tots</option>` +
      teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('') ||
      `<option value="all">Sense equip</option>`;
    filterSel.value = (prevFilter !== '' && Array.from(filterSel.options).some(o => o.value === prevFilter))
      ? prevFilter : 'all';
  }
  const bulkSel = document.getElementById('bulkTeamSelect');
  if (bulkSel) {
    const prevBulk = bulkSel.value;
    bulkSel.innerHTML = `<option value="">Sense equip</option>` +
      teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    if (prevBulk !== '' && Array.from(bulkSel.options).some(o => o.value === prevBulk)) bulkSel.value = prevBulk;
  }
  if (players.length === 0) {
    playerSelection = new Set();
    updatePlayersSel();
    if (teams.length === 0) {
      list.innerHTML = `
        <div class="text-center py-4">
          <div class="fs-1">&#128101;</div>
          <div class="text-secondary mb-3">No hi ha cap jugador. Primer crea un equip.</div>
          <button class="btn btn-primary mb-2" onclick="navigateTo('viewTeams')">&#128101; Crear equip</button>
          <div><button class="btn btn-outline-secondary" onclick="importGames()">&#10515; Importar partits</button></div>
        </div>`;
    } else {
      list.innerHTML = '<div class="text-center text-secondary py-4">&#128101;<br>Cap jugador encara</div>';
    }
    return;
  }
  const numOf = p => (p.number !== '' && p.number != null) ? parseInt(p.number) : null;
  const sorted = players.slice().sort((a, b) => {
    const teamCmp = (teamMap[a.teamId] ? teamMap[a.teamId].name : '').localeCompare(teamMap[b.teamId] ? teamMap[b.teamId].name : '');
    if (teamCmp) return teamCmp;
    const an = numOf(a);
    const bn = numOf(b);
    if (an === null && bn === null) return a.name.localeCompare(b.name);
    if (an === null) return 1;
    if (bn === null) return -1;
    if (an !== bn) return an - bn;
    return a.name.localeCompare(b.name);
  });
  const filtered = filterSel && filterSel.value !== 'all'
    ? sorted.filter(p => String(p.teamId) === filterSel.value)
    : sorted;
  list.innerHTML = filtered.map(p => {
    const team = teamMap[p.teamId];
    if (editingPlayerId === p.id) {
      const teamOpts = `<option value="">Sense equip</option>` + teams.map(t =>
        `<option value="${t.id}" ${p.teamId === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
      return `
      <li class="list-group-item d-flex flex-wrap align-items-center gap-2 px-2 py-2 player-item editing">
        <input type="text" id="inlineName" class="form-control form-control-sm" style="flex:2;min-width:110px" value="${esc(p.name)}" placeholder="Nom">
        <input type="number" id="inlineNumber" class="form-control form-control-sm" style="flex:0 0 70px" value="${esc(p.number || '')}" min="0" max="99" placeholder="Num.">
        <select id="inlineTeam" class="form-select form-select-sm" style="flex:1;min-width:100px">${teamOpts}</select>
        <div class="btn-group btn-group-sm ms-auto">
          <button class="btn btn-success" onclick="saveInlinePlayer(${p.id})">&#10003;</button>
          <button class="btn btn-outline-secondary" onclick="cancelEditPlayer()">&#10005;</button>
        </div>
      </li>`;
    }
    const checked = playerSelection.has(p.id) ? ' checked' : '';
    const inactive = p.active === false;
    return `
    <li class="list-group-item d-flex align-items-center gap-2 px-2 py-2 player-item ${inactive ? 'player-inactive' : ''}">
      <input type="checkbox" class="player-check" value="${p.id}" onchange="togglePlayerSelection(${p.id})"${checked}>
      <div class="d-flex flex-column flex-grow-1">
        <span>${p.number ? '<span class="text-primary fw-bold">#' + p.number + '</span> ' : ''}${esc(p.name)}${inactive ? ' <small class="text-secondary">(inactiu)</small>' : ''}</span>
        <small class="text-secondary" style="${team ? 'color:var(--primary)!important' : ''}">${team ? esc(team.name) : 'Sense equip'}</small>
      </div>
      <button class="btn btn-sm ${inactive ? 'btn-outline-danger' : 'btn-outline-secondary'}" title="${inactive ? 'Inactiu (desmarcat en crear partit) - toca per activar' : 'Actiu - toca per marcar inactiu'}" onclick="togglePlayerActive(${p.id})">${inactive ? '&#128683;' : '&#128065;'}</button>
      <div class="btn-group btn-group-sm">
        <button class="btn btn-outline-primary" onclick="editPlayer(${p.id})">&#9998;</button>
        <button class="btn btn-outline-danger" onclick="deletePlayer(${p.id})">&#128465;</button>
      </div>
    </li>`;
  }).join('');
  updatePlayersSel();
}

async function togglePlayerActive(id) {
  const p = await DB.get('players', id);
  if (!p) return;
  p.active = p.active === false ? true : false;
  await DB.put('players', p);
  renderPlayers();
}

function togglePlayerSelection(id) {
  if (playerSelection.has(id)) playerSelection.delete(id);
  else playerSelection.add(id);
  updatePlayersSel();
}

function updatePlayersSel() {
  const bar = document.getElementById('bulkBar');
  const count = document.getElementById('bulkCount');
  if (bar) bar.style.display = playerSelection.size ? '' : 'none';
  if (count) count.textContent = `${playerSelection.size} seleccionat${playerSelection.size === 1 ? '' : 's'}`;
  document.querySelectorAll('#playerList li').forEach(li => {
    li.classList.toggle('selected', false);
    const cb = li.querySelector('.player-check');
    if (cb) {
      cb.checked = playerSelection.has(parseInt(cb.value));
      li.classList.toggle('selected', cb.checked);
    }
  });
}

function clearPlayersSelection() {
  playerSelection.clear();
  updatePlayersSel();
}

async function applyBulkTeam() {
  if (playerSelection.size === 0) return;
  const bulkSel = document.getElementById('bulkTeamSelect');
  const teamId = bulkSel ? (parseInt(bulkSel.value) || null) : null;
  for (const id of playerSelection) {
    const p = await DB.get('players', id);
    if (p) {
      p.teamId = teamId;
      await DB.put('players', p);
    }
  }
  playerSelection.clear();
  renderPlayers();
}

async function addPlayer() {
  const name = document.getElementById('playerName').value.trim();
  const number = document.getElementById('playerNumber').value.trim();
  const teamId = parseInt(document.getElementById('playerTeam').value) || null;
  if (!name) return alert('Introdueix un nom');
  await DB.add('players', { name, number: number || '', teamId });
  document.getElementById('playerName').value = '';
  document.getElementById('playerNumber').value = '';
  renderPlayers();
}

function editPlayer(id) {
  editingPlayerId = id;
  renderPlayers();
}

async function saveInlinePlayer(id) {
  const name = document.getElementById('inlineName').value.trim();
  if (!name) return alert('Introdueix un nom');
  const number = document.getElementById('inlineNumber').value.trim();
  const teamSel = document.getElementById('inlineTeam');
  const teamId = teamSel ? (parseInt(teamSel.value) || null) : null;
  await DB.put('players', { id, name, number: number || '', teamId });
  editingPlayerId = null;
  renderPlayers();
}

function cancelEditPlayer() {
  editingPlayerId = null;
  renderPlayers();
}

async function deletePlayer(id) {
  if (!confirm('Eliminar jugador?')) return;
  if (editingPlayerId === id) editingPlayerId = null;
  playerSelection.delete(id);
  await DB.delete('players', id);
  renderPlayers();
}

// TEAMS CRUD
async function renderTeams() {
  const teams = await DB.getAll('teams');
  const players = await DB.getAll('players');
  const games = await DB.getAll('games');
  const list = document.getElementById('teamList');
  if (teams.length === 0) {
    list.innerHTML = '<div class="text-center text-secondary py-4">No hi ha equips. Crea&#39;n un!</div>';
    return;
  }
  list.innerHTML = teams.map(t => {
    const pCount = players.filter(p => p.teamId === t.id).length;
    const gCount = games.filter(g => g.teamId === t.id).length;
    return `
      <li class="list-group-item list-group-item-action d-flex flex-wrap align-items-center justify-content-between gap-2 px-2 py-2">
        <span>${esc(t.name)}</span>
        <div class="d-flex align-items-center gap-2 flex-wrap">
          <small class="text-secondary">${pCount} jug &middot; ${gCount} partits</small>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary" onclick="renameTeam(${t.id})">&#9998;</button>
            <button class="btn btn-outline-danger" onclick="deleteTeam(${t.id})">&#128465;</button>
          </div>
        </div>
      </li>
    `;
  }).join('');
}

async function addTeam() {
  const name = document.getElementById('teamName').value.trim();
  if (!name) return alert('Introdueix un nom');
  const id = await DB.add('teams', { name });
  document.getElementById('teamName').value = '';
  renderTeams();
  renderHome();
}

async function renameTeam(id) {
  const t = await DB.get('teams', id);
  if (!t) return;
  const name = prompt('Nou nom de l\'equip:', t.name);
  if (!name || !name.trim()) return;
  t.name = name.trim();
  await DB.put('teams', t);
  renderTeams();
}

async function deleteTeam(id) {
  const players = await DB.getAll('players');
  const games = await DB.getAll('games');
  if (players.some(p => p.teamId === id)) {
    return alert('No es pot eliminar: mou primer els jugadors a un altre equip.');
  }
  const teamGames = games.filter(g => g.teamId === id);
  if (teamGames.length > 0) {
    if (!confirm(`L'equip té ${teamGames.length} partits. Quedaran sense equip. Continuar?`)) return;
    for (const g of teamGames) {
      delete g.teamId;
      await DB.put('games', g);
    }
  }
  if (!confirm('Eliminar equip?')) return;
  await DB.delete('teams', id);
  renderTeams();
  renderHome();
}

// NEW GAME
async function renderNewGame() {
  const players = await DB.getAll('players');
  const teams = await DB.getAll('teams');
  const sel = document.getElementById('gameTeamSelect');
  sel.innerHTML = teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  const selected = parseInt(sel.value);
  const gameDate = document.getElementById('gameDate');
  if (gameDate) gameDate.value = new Date().toISOString().slice(0, 10);
  renderGamePlayers(selected, players);
}

async function onGameTeamChange() {
  const players = await DB.getAll('players');
  const sel = document.getElementById('gameTeamSelect');
  const selected = parseInt(sel.value);
  renderGamePlayers(selected, players);
}

function renderGamePlayers(teamId, players) {
  const container = document.getElementById('playerSelectList');
  const teamPlayers = players.filter(p => p.teamId === teamId);
  if (teamPlayers.length === 0) {
    container.innerHTML = '<div class="text-center text-secondary py-4">&#128101;<br>Primer afegeix jugadors a aquest equip</div>';
    return;
  }
  container.innerHTML = teamPlayers.map(p => `
    <div class="form-check${p.active === false ? ' opacity-50' : ''}">
      <input class="form-check-input" type="checkbox" value="${p.id}" id="psel${p.id}" ${p.active === false ? '' : 'checked'}>
      <label class="form-check-label" for="psel${p.id}">${p.number ? '#' + p.number + ' ' : ''}${esc(p.name)}${p.active === false ? ' <small class="text-secondary">(inactiu)</small>' : ''}</label>
    </div>
  `).join('');
}

async function startGame() {
  const teamSelect = document.getElementById('gameTeamSelect');
  const teamId = parseInt(teamSelect.value);
  const teams = await DB.getAll('teams');
  const teamObj = teams.find(t => t.id === teamId);
  if (!teamObj) return alert('Selecciona un equip');
  const team = teamObj.name;
  const opponent = document.getElementById('gameOpponent').value.trim();
  const periods = parseInt(document.getElementById('gamePeriods').value);
  if (!opponent) return alert('Introdueix el nom del rival');

  const checkboxes = document.querySelectorAll('#playerSelectList input:checked');
  const playerIds = Array.from(checkboxes).map(cb => parseInt(cb.value));
  if (playerIds.length === 0) return alert('Selecciona almenys un jugador');

  const isHome = document.querySelector('input[name="gameSide"]:checked').value === 'local';
  const typeSel = document.getElementById('gameType');
  const type = typeSel ? typeSel.value : null;
  const dateSel = document.getElementById('gameDate');
  const dateVal = dateSel ? dateSel.value : '';
  const date = dateVal ? new Date(dateVal + 'T12:00:00').toISOString() : new Date().toISOString();
  const game = {
    date,
    team, opponent, periods, type,
    currentPeriod: 1, playerIds, isActive: true,
    isHome, teamId,
    rival1pt: 0, rival2pt: 0, rival3pt: 0,
    onCourtPlayerIds: null
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

  let lineup;
  if (playerIds.length <= 5) {
    lineup = playerIds.slice();
  } else {
    lineup = await askStartingLineup(playerIds);
  }
  if (!lineup) {
    await DB.delete('games', gameId);
    activeGame = null;
    activePlayerStats = {};
    actionLog = [];
    navigateTo('viewHome');
    renderHome();
    return;
  }
  activeGame.onCourtPlayerIds = lineup;
  await DB.put('games', activeGame);
  currentPlayerTab = lineup[0] || null;

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
    document.getElementById('livePeriod').textContent = periodLabel(activeGame.currentPeriod, activeGame.periods);
  } else {
    document.getElementById('livePeriod').textContent = 'Mode Edició';
  }

  const court = ensureOnCourt();

  const numOfP = p => (p && p.number !== '' && p.number != null) ? parseInt(p.number) : null;
  const sortedCourt = court.slice().sort((a, b) => {
    const an = numOfP(playerMap[a]);
    const bn = numOfP(playerMap[b]);
    if (an === null && bn === null) return 0;
    if (an === null) return 1;
    if (bn === null) return -1;
    return an - bn;
  });

  const tabs = document.getElementById('liveTabs');
  tabs.innerHTML = sortedCourt.map(pid => {
    const p = playerMap[pid];
    const label = playerLabel(p);
    return `<button class="btn btn-outline-secondary player-tab" data-pid="${pid}" onclick="selectPlayerTab(${pid})">${esc(label)}</button>`;
  }).join('');

  if (!sortedCourt.includes(currentPlayerTab)) {
    currentPlayerTab = sortedCourt[0] || null;
  }
  const allTabs = tabs.querySelectorAll('.player-tab');
  const activeBtn = Array.from(allTabs).find(b => b.dataset.pid === String(currentPlayerTab));
  if (activeBtn) activeBtn.classList.add('active');

  document.getElementById('btnSubstitute').style.display = isEditing ? 'none' : '';

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
  const btn = Array.from(document.querySelectorAll('#liveTabs .player-tab')).find(b => b.dataset.pid === String(pid));
  if (btn) btn.classList.add('active');
}

async function renderLiveStats(playerMap) {
  if (!playerMap) {
    const players = await DB.getAll('players');
    playerMap = {};
    players.forEach(p => playerMap[p.id] = p);
  }

  const container = document.getElementById('liveStats');

  let html = '<table class="table table-dark table-striped table-sm stats-table"><thead><tr><th>Jug</th>';
  html += '<th>PTS</th><th>REB</th><th>AST</th><th>VAL</th>';
  html += '<th>T1</th><th>%T1</th><th>T2</th><th>%T2</th><th>T3</th><th>%T3</th>';
  REST_FIELDS.forEach(f => html += `<th>${STAT_LABELS[f]}</th>`);
  html += '</tr></thead><tbody>';

  const totalRow = emptyStats();
  const court = onCourtIds();
  const numOf = pid => {
    const p = playerMap[pid];
    const n = p && p.number !== '' && p.number != null ? parseInt(p.number) : null;
    return n;
  };
  const sorted = activeGame.playerIds.map(pid => activePlayerStats[pid]).filter(Boolean)
    .sort((a, b) => {
      const aOn = court.includes(a.playerId) ? 0 : 1;
      const bOn = court.includes(b.playerId) ? 0 : 1;
      if (aOn !== bOn) return aOn - bOn;
      const an = numOf(a.playerId);
      const bn = numOf(b.playerId);
      if (an === null && bn === null) return 0;
      if (an === null) return 1;
      if (bn === null) return -1;
      return an - bn;
    });
  let benchStarted = false;
  const colCount = 4 + 6 + REST_FIELDS.length + 1;
  const benchSpacer = `<tr class="bench-spacer"><td colspan="${colCount}"><span class="bench-label">&#128102; Banqueta</span></td></tr>`;
  sorted.forEach(s => {
    const on = court.includes(s.playerId);
    if (!on && !benchStarted) {
      benchStarted = true;
      html += benchSpacer;
    }
    const p = playerMap[s.playerId];
    const name = p ? abbrevName(p) : '?';
    const pts = calcScore(s);
    const val = calcVal(s);
    const reb = s.oReb + s.dReb;
    html += `<tr><td class="player-name">${esc(name)}</td>`;
    html += `<td>${pts}</td><td>${reb}</td><td>${s.assists}</td><td class="${val >= 0 ? 'val-pos' : 'val-neg'}">${val}</td>`;
    html += `<td>${s.ftMade}/${s.ftMissed}</td><td>${pct(s.ftMade, s.ftMissed)}</td>`;
    html += `<td>${s.twoMade}/${s.twoMissed}</td><td>${pct(s.twoMade, s.twoMissed)}</td>`;
    html += `<td>${s.threeMade}/${s.threeMissed}</td><td>${pct(s.threeMade, s.threeMissed)}</td>`;
    REST_FIELDS.forEach(f => html += `<td>${s[f]}</td>`);
    html += '</tr>';
    REST_FIELDS.forEach(f => totalRow[f] += s[f]);
    totalRow.assists += s.assists;
    totalRow.twoMade += s.twoMade; totalRow.twoMissed += s.twoMissed;
    totalRow.threeMade += s.threeMade; totalRow.threeMissed += s.threeMissed;
    totalRow.ftMade += s.ftMade; totalRow.ftMissed += s.ftMissed;
  });

  const totalPts = calcScore(totalRow);
  const totalVal = calcVal(totalRow);
  const totalReb = totalRow.oReb + totalRow.dReb;
  html += `<tr class="total-row"><td class="player-name">TOTAL</td>`;
  html += `<td>${totalPts}</td><td>${totalReb}</td><td>${totalRow.assists}</td><td class="${totalVal >= 0 ? 'val-pos' : 'val-neg'}">${totalVal}</td>`;
  html += `<td>${totalRow.ftMade}/${totalRow.ftMissed}</td><td>${pct(totalRow.ftMade, totalRow.ftMissed)}</td>`;
  html += `<td>${totalRow.twoMade}/${totalRow.twoMissed}</td><td>${pct(totalRow.twoMade, totalRow.twoMissed)}</td>`;
  html += `<td>${totalRow.threeMade}/${totalRow.threeMissed}</td><td>${pct(totalRow.threeMade, totalRow.threeMissed)}</td>`;
  REST_FIELDS.forEach(f => html += `<td>${totalRow[f]}</td>`);
  html += '</tr>';

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

  if (last.type === 'addPlayer') {
    const pid = last.playerId;
    const idx = activeGame.playerIds.indexOf(pid);
    if (idx >= 0) activeGame.playerIds.splice(idx, 1);
    delete activePlayerStats[pid];
    if (!isEditing) {
      const existing = await DB.getByIndex('stats', 'gameId', activeGame.id);
      const found = existing.find(s => s.playerId === pid);
      if (found) await DB.delete('stats', found.id);
      await DB.put('games', activeGame);
    }
    renderLiveGame();
    return;
  }

  if (last.type === 'sub') {
    const court = ensureOnCourt();
    const inIdx = court.indexOf(last.inId);
    if (inIdx >= 0) court.splice(inIdx, 1);
    if (!court.includes(last.outId)) court.push(last.outId);
    if (!isEditing) await DB.put('games', activeGame);
    currentPlayerTab = last.outId;
    renderLiveGame();
    return;
  }

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
  document.getElementById('btnToggleLog').innerHTML = '&#128220; ' + (logVisible ? 'Amagar' : 'Mostrar');
}

function toggleStats() {
  statsVisible = !statsVisible;
  const el = document.getElementById('liveStats');
  el.style.display = statsVisible ? 'block' : 'none';
  document.getElementById('btnToggleStats').innerHTML = statsVisible ? '&#128200; Amagar' : '&#128200; Mostrar';
}

async function renderActionLog() {
  const container = document.getElementById('liveActionLog');
  const players = await DB.getAll('players');
  const pMap = {};
  players.forEach(p => pMap[p.id] = p);

  const max = Math.min(actionLog.length, 50);
  const start = actionLog.length - max;
  const running = {};
  const cumAt = {};
  const SHOT_LABELS = { twoMade: 'T2', twoMissed: 'T2', threeMade: 'T3', threeMissed: 'T3', ftMade: 'T1', ftMissed: 'T1' };
  for (let i = 0; i < actionLog.length; i++) {
    const entry = actionLog[i];
    if (entry.playerId !== undefined && entry.playerId !== -1) {
      if (!running[entry.playerId]) running[entry.playerId] = emptyStats();
      const st = running[entry.playerId];
      (entry.fields || []).forEach(f => { if (f in st) st[f]++; });
      cumAt[i] = { ...st };
    }
  }
  const fmtCum = (i) => {
    const entry = actionLog[i];
    const f0 = entry.fields && entry.fields[0];
    const cum = cumAt[i];
    if (!f0 || !cum) return '';
    const label = SHOT_LABELS[f0];
    if (label) {
      const made = label === 'T2' ? cum.twoMade : label === 'T3' ? cum.threeMade : cum.ftMade;
      const missed = label === 'T2' ? cum.twoMissed : label === 'T3' ? cum.threeMissed : cum.ftMissed;
      if (f0 === 'twoMade' || f0 === 'threeMade' || f0 === 'ftMade') {
        const pts = cum.twoMade * 2 + cum.threeMade * 3 + cum.ftMade;
        return ` (${made}/${missed} ${label} - ${pts}p)`;
      }
      return ` (${made}/${missed} ${label})`;
    }
    if (f0 === 'oReb' || f0 === 'dReb') {
      return ` (${cum[f0]}${f0 === 'oReb' ? 'RO' : 'RD'} - ${cum.oReb + cum.dReb}RT)`;
    }
    return ` (${cum[f0]} ${STAT_LABELS[f0] || f0})`;
  };
  let html = '';
  for (let i = actionLog.length - 1; i >= start; i--) {
    const entry = actionLog[i];
    const qStr = entry.period ? `Q${entry.period}` : '';
    const scoreStr = (entry.teamScore !== undefined && entry.rivalScore !== undefined) ? `${entry.teamScore}-${entry.rivalScore}` : '';
    if (entry.type === 'addPlayer') {
      const p = pMap[entry.playerId];
      const label = p ? abbrevName(p) : '#' + entry.playerId;
      html += `<div class="log-entry">${qStr ? `<span class="log-q">${qStr}</span>` : ''}<span class="log-player">${esc(label)}</span> <span class="log-action">afegit</span>${scoreStr ? ` <span class="log-score">${scoreStr}</span>` : ''}</div>`;
      continue;
    }
    if (entry.type === 'sub') {
      const pOut = pMap[entry.outId];
      const pIn = pMap[entry.inId];
      const outLabel = pOut ? abbrevName(pOut) : '#' + entry.outId;
      const inLabel = pIn ? abbrevName(pIn) : '#' + entry.inId;
      html += `<div class="log-entry">${qStr ? `<span class="log-q">${qStr}</span>` : ''}<span class="log-player">${esc(outLabel)}</span> <span class="log-action">surt</span> &middot; <span class="log-player">${esc(inLabel)}</span> <span class="log-action">entra</span>${scoreStr ? ` <span class="log-score">${scoreStr}</span>` : ''}</div>`;
      continue;
    }
    const p = pMap[entry.playerId];
    const actionText = entry.text || (entry.fields || []).map(f => STAT_NAMES[f] || f).join(' + ');
    if (entry.playerId === -1) {
      html += `<div class="log-entry">${qStr ? `<span class="log-q">${qStr}</span>` : ''}<span class="log-rival">${esc(actionText)}</span>${scoreStr ? ` <span class="log-score">${scoreStr}</span>` : ''}</div>`;
      continue;
    }
    const label = p ? abbrevName(p) : '#' + entry.playerId;
    html += `<div class="log-entry">${qStr ? `<span class="log-q">${qStr}</span>` : ''}<span class="log-player">${esc(label)}</span> <span class="log-action">${esc(actionText)}</span><span class="log-cum">${fmtCum(i)}</span>${scoreStr ? ` <span class="log-score">${scoreStr}</span>` : ''}</div>`;
  }
  container.innerHTML = html || '<div class="log-entry text-secondary">Cap acció encara</div>';
  container.scrollTop = 0;
}

async function addRivalStat(points) {
  if (!activeGame) return;
  const field = points === 1 ? 'rival1pt' : points === 2 ? 'rival2pt' : 'rival3pt';
  activeGame[field] = (activeGame[field] || 0) + 1;
  if (!isEditing) await DB.put('games', activeGame);
  const ts = totalStats();
  const sc = calcScore(ts);
  const rs = calcRivalScore();
  actionLog.push({ playerId: -1, fields: [`+${points} rival`], text: `+${points}`, period: activeGame.currentPeriod, teamScore: sc, rivalScore: rs });
  updateLiveScore();
  renderActionLog();
  const btn = document.querySelector(`button[onclick="addRivalStat(${points})"]`);
  if (btn) flashButton(btn);
}

async function nextPeriod() {
  activeGame.currentPeriod++;
  if (!isEditing) await DB.put('games', activeGame);
  document.getElementById('livePeriod').textContent = periodLabel(activeGame.currentPeriod, activeGame.periods);
  updateLiveScore();
}

async function prevPeriod() {
  if (activeGame.currentPeriod <= 1) return;
  const target = activeGame.currentPeriod - 1;
  if (!confirm(`Vols tornar al ${periodLabel(target, activeGame.periods).toLowerCase()}?`)) return;
  activeGame.currentPeriod = target;
  if (!isEditing) await DB.put('games', activeGame);
  document.getElementById('livePeriod').textContent = periodLabel(activeGame.currentPeriod, activeGame.periods);
  updateLiveScore();
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
        <input type="checkbox" class="form-check-input game-select me-2" data-game-id="${g.id}" ${gameSelection.has(g.id) ? 'checked' : ''} onclick="event.stopPropagation(); toggleGameSelection(${g.id})">
        <div class="flex-grow-1 me-2 text-start">
          <div class="fw-semibold">${esc(g.team)} <span class="game-score">${pts}</span> - ${rPts} ${esc(g.opponent)} ${status}</div>
          <div class="small text-secondary">${dateStr} &middot; ${periodsDesc(g)}${g.type ? ` &middot; ${esc(g.type)}` : ''}</div>
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

function toggleGameSelection(id) {
  if (gameSelection.has(id)) gameSelection.delete(id);
  else gameSelection.add(id);
  const cb = document.querySelector(`.game-select[data-game-id="${id}"]`);
  if (cb) cb.checked = gameSelection.has(id);
}

function toggleSelectAllGames() {
  const checked = document.getElementById('gameSelectAll').checked;
  document.querySelectorAll('.game-select').forEach(cb => {
    const id = parseInt(cb.dataset.gameId);
    if (checked) gameSelection.add(id);
    else gameSelection.delete(id);
    cb.checked = checked;
  });
}

async function exportGames() {
  if (gameSelection.size === 0) return alert('Selecciona almenys un partit');
  const allGames = await DB.getAll('games');
  const allStats = await DB.getAll('stats');
  const allPlayers = await DB.getAll('players');
  const allTeams = await DB.getAll('teams');
  const selIds = Array.from(gameSelection);
  const games = allGames.filter(g => selIds.includes(g.id));
  const gameIdSet = new Set(games.map(g => g.id));
  const pidSet = new Set();
  const tidSet = new Set();
  games.forEach(g => {
    (g.playerIds || []).forEach(pid => pidSet.add(pid));
    if (g.teamId) tidSet.add(g.teamId);
  });
  const data = {
    type: 'bqstats-games',
    games,
    stats: allStats.filter(s => gameIdSet.has(s.gameId)),
    players: allPlayers.filter(p => pidSet.has(p.id)),
    teams: allTeams.filter(t => tidSet.has(t.id)),
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `partits-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importGames() {
  document.getElementById('gameImportFile').click();
}

async function handleGamesImport(event) {
  const input = event.target;
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (data.type !== 'bqstats-games' || !Array.isArray(data.games)) throw new Error('Aquest fitxer no és un export de partits');

    const existingGames = await DB.getAll('games');
    const existingTeams = await DB.getAll('teams');
    const existingPlayers = await DB.getAll('players');
    const dayOf = d => (d || '').slice(0, 10);
    const gameKey = g => `${dayOf(g.date)}|${String(g.opponent || '').trim().toLowerCase()}`;
    const known = new Set(existingGames.map(gameKey));
    const newGames = [];
    const skipped = new Set();
    data.games.forEach(g => {
      if (known.has(gameKey(g))) skipped.add(g.id);
      else { known.add(gameKey(g)); newGames.push(g); }
    });
    const newGameIds = new Set(newGames.map(g => g.id));
    const newStats = (data.stats || []).filter(s => newGameIds.has(s.gameId));
    const teamNameById = {};
    existingTeams.forEach(t => teamNameById[t.id] = (t.name || ''));
    const countPlayerKey = p => (p.name || '').trim().toLowerCase() + '#' + (teamNameById[p.teamId] || '').trim().toLowerCase();
    const existingPlayerKeys = new Set(existingPlayers.map(p => countPlayerKey(p)));
    const newPlayersCount = (data.players || []).filter(p => !existingPlayerKeys.has(countPlayerKey(p))).length;

    const dupMsg = skipped.size ? `\n(${skipped.size} partits ja existents s'ometran)` : '';
    if (newGames.length === 0) {
      alert('No hi ha partits nous per importar (ja els tens tots).');
      return;
    }
    if (!confirm(`Importar ${newGames.length} partits nous amb ${newStats.length} registres estadístics i ${newPlayersCount} jugadors nous?${dupMsg}`)) return;

    const teamNameKey = t => (t.name || '').trim().toLowerCase();
    const teamsByName = {};
    existingTeams.forEach(t => teamsByName[teamNameKey(t)] = t);

    const teamIdMap = {};
    for (const t of data.teams || []) {
      const key = teamNameKey(t);
      if (teamsByName[key]) {
        teamIdMap[t.id] = teamsByName[key].id;
      } else {
        teamIdMap[t.id] = await DB.add('teams', { name: t.name });
        teamsByName[key] = { id: teamIdMap[t.id], name: t.name };
      }
    }

    const playerKey = p => (p.name || '').trim().toLowerCase() + '#' + ((p.teamId && teamIdMap[p.teamId]) ? teamIdMap[p.teamId] : '');
    const playersByKey = {};
    existingPlayers.forEach(p => {
      playersByKey[(p.name || '').trim().toLowerCase() + '#' + (p.teamId || '')] = p;
    });

    const playerIdMap = {};
    for (const p of data.players || []) {
      const newTeamId = p.teamId ? (teamIdMap[p.teamId] || null) : null;
      const key = (p.name || '').trim().toLowerCase() + '#' + (newTeamId || '');
      if (playersByKey[key]) {
        playerIdMap[p.id] = playersByKey[key].id;
      } else {
        playerIdMap[p.id] = await DB.add('players', { name: p.name, number: p.number || '', teamId: newTeamId });
        playersByKey[key] = { id: playerIdMap[p.id] };
      }
    }

    for (const g of newGames) {
      const { id, playerIds, teamId, actions, ...rest } = g;
      const newPlayerIds = (playerIds || []).map(pid => playerIdMap[pid]).filter(pid => pid !== undefined);
      const newTeamId = teamId ? (teamIdMap[teamId] || null) : null;
      let newActions = actions;
      if (Array.isArray(actions)) {
        newActions = actions.map(a => {
          const na = { ...a };
          if (na.playerId !== undefined && na.playerId !== -1 && playerIdMap[na.playerId]) na.playerId = playerIdMap[na.playerId];
          if (na.outId !== undefined && playerIdMap[na.outId]) na.outId = playerIdMap[na.outId];
          if (na.inId !== undefined && playerIdMap[na.inId]) na.inId = playerIdMap[na.inId];
          return na;
        });
      }
      const newGameId = await DB.add('games', { ...rest, playerIds: newPlayerIds, teamId: newTeamId, actions: newActions });
      for (const s of (data.stats || [])) {
        if (s.gameId !== g.id) continue;
        if (playerIdMap[s.playerId] === undefined) continue;
        const { id, gameId, playerId, ...srest } = s;
        await DB.add('stats', { ...srest, gameId: newGameId, playerId: playerIdMap[s.playerId] });
      }
    }

    gameSelection = new Set();
    alert(`Partits importats correctament!${skipped.size ? ` (${skipped.size} partits duplicats ometuts)` : ''}`);
    location.reload();
  } catch (e) {
    alert('Error: ' + e.message);
  }
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
    <div class="small text-secondary mb-2">${game.type ? `${esc(game.type)} &middot; ` : ''}${dateStr} &middot; ${periodsDesc(game)}</div>
  `;

  document.getElementById('detailMetaEdit').innerHTML = '';

  // Stats table
  const detailRestFields = REST_FIELDS;
  let html = '<table class="table table-dark table-striped table-sm stats-table"><thead><tr><th>Jug</th>';
  html += '<th>PTS</th><th>REB</th><th>AST</th>';
  html += '<th>2PM</th><th>2PI</th><th>2P%</th>';
  html += '<th>3PM</th><th>3PI</th><th>3P%</th>';
  html += '<th>TLM</th><th>TLI</th><th>TL%</th>';
  detailRestFields.forEach(f => html += `<th>${STAT_LABELS[f]}</th>`);
  html += '<th>VAL</th></tr></thead><tbody>';

  const totalRow = emptyStats();
  const sorted = game.playerIds.map(pid => statsByPlayer[pid]).filter(Boolean);
  sorted.forEach(s => {
    const p = playerMap[s.playerId];
    const name = p ? abbrevName(p) : '?';
    const pts = calcScore(s);
    const val = calcVal(s);
    const reb = s.oReb + s.dReb;
    const zero = FIELDS.every(f => !s[f]);
    html += `<tr><td class="player-name">${esc(name)}${zero ? ` <button class="btn btn-sm btn-outline-danger py-0 px-1" title="No ha jugat: treu-lo del partit" onclick="removePlayerFromGame(${game.id}, ${s.playerId})">&#10005;</button>` : ''}</td>`;
    html += `<td>${pts}</td><td>${reb}</td><td>${s.assists}</td>`;
    html += `<td>${s.twoMade}</td><td>${s.twoMissed}</td><td>${pct(s.twoMade, s.twoMissed)}</td>`;
    html += `<td>${s.threeMade}</td><td>${s.threeMissed}</td><td>${pct(s.threeMade, s.threeMissed)}</td>`;
    html += `<td>${s.ftMade}</td><td>${s.ftMissed}</td><td>${pct(s.ftMade, s.ftMissed)}</td>`;
    detailRestFields.forEach(f => html += `<td>${s[f]}</td>`);
    html += `<td>${val}</td></tr>`;
    detailRestFields.forEach(f => totalRow[f] += s[f]);
    totalRow.assists += s.assists;
    totalRow.twoMade += s.twoMade; totalRow.twoMissed += s.twoMissed;
    totalRow.threeMade += s.threeMade; totalRow.threeMissed += s.threeMissed;
    totalRow.ftMade += s.ftMade; totalRow.ftMissed += s.ftMissed;
  });

  const totalPts = calcScore(totalRow);
  const totalVal = calcVal(totalRow);
  const totalReb = totalRow.oReb + totalRow.dReb;
  html += `<tr style="font-weight:700;border-top:2px solid var(--primary)"><td>TOTAL</td>`;
  html += `<td>${totalPts}</td><td>${totalReb}</td><td>${totalRow.assists}</td>`;
  html += `<td>${totalRow.twoMade}</td><td>${totalRow.twoMissed}</td><td>${pct(totalRow.twoMade, totalRow.twoMissed)}</td>`;
  html += `<td>${totalRow.threeMade}</td><td>${totalRow.threeMissed}</td><td>${pct(totalRow.threeMade, totalRow.threeMissed)}</td>`;
  html += `<td>${totalRow.ftMade}</td><td>${totalRow.ftMissed}</td><td>${pct(totalRow.ftMade, totalRow.ftMissed)}</td>`;
  detailRestFields.forEach(f => html += `<td>${totalRow[f]}</td>`);
  html += `<td>${totalVal}</td></tr>`;

  html += '</tbody></table>';
  document.getElementById('detailStats').innerHTML = html;

  document.getElementById('detailActions').innerHTML = `
    <button class="btn btn-primary" onclick="editGame(${game.id})">&#9998; Editar Estadístiques</button>
    <button class="btn btn-outline-secondary" onclick="toggleGameMetaEdit()">&#128197; Tipus / Data</button>
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
  const maxActionsPeriod = game.actions.reduce((m, a) => (a.period && a.period > m) ? a.period : m, periods);

  let html = '<div class="btn-group btn-group-sm mb-2 flex-wrap">';
  html += `<button class="btn btn-outline-secondary ${detailQuarterFilter === null ? 'active' : ''}" onclick="setDetailQuarter(null,${game.id})">Tots</button>`;
  for (let q = 1; q <= maxActionsPeriod; q++) {
    const label = q <= periods ? `Q${q}` : `P${q - periods}`;
    html += `<button class="btn btn-outline-secondary ${detailQuarterFilter === q ? 'active' : ''}" onclick="setDetailQuarter(${q},${game.id})">${label}</button>`;
  }
  html += '</div>';

  html += '<div class="chat-log">';

  const filtered = detailQuarterFilter === null ? game.actions : game.actions.filter(a => a.period === detailQuarterFilter);
  filtered.forEach(a => {
    const qStr = a.period ? (a.period <= periods ? `Q${a.period}` : `P${a.period - periods}`) : '?';
    const scoreStr = (a.teamScore !== undefined && a.rivalScore !== undefined) ? `${a.teamScore} - ${a.rivalScore}` : '';

    if (a.type === 'addPlayer') {
      const p = playerMap[a.playerId];
      const label = p ? abbrevName(p) : '#' + a.playerId;
      html += `<div class="chat-row local">
        <div class="chat-left"><span class="chat-player">${esc(label)}</span> <span class="chat-action">afegit al partit</span></div>
        <div class="chat-center"><span class="chat-q">${qStr}</span> <span class="chat-score">${scoreStr}</span></div>
        <div class="chat-right"></div>
      </div>`;
      return;
    }

    if (a.type === 'sub') {
      const pOut = playerMap[a.outId];
      const pIn = playerMap[a.inId];
      const outLabel = pOut ? abbrevName(pOut) : '#' + a.outId;
      const inLabel = pIn ? abbrevName(pIn) : '#' + a.inId;
      html += `<div class="chat-row local">
        <div class="chat-left"><span class="chat-player">${esc(outLabel)}</span> <span class="chat-action">surt</span> &middot; <span class="chat-player">${esc(inLabel)}</span> <span class="chat-action">entra</span></div>
        <div class="chat-center"><span class="chat-q">${qStr}</span> <span class="chat-score">${scoreStr}</span></div>
        <div class="chat-right"></div>
      </div>`;
      return;
    }

    if (a.playerId === -1) {
      // Visitor action
      const pts = a.text || a.fields[0] || '+';
      html += `<div class="chat-row visitor">
        <div class="chat-left"></div>
        <div class="chat-center"><span class="chat-q">${qStr}</span> <span class="chat-score">${scoreStr}</span></div>
        <div class="chat-right"><span class="chat-action">${esc(pts)}</span></div>
      </div>`;
    } else {
      // Local action
      const p = playerMap[a.playerId];
      const label = p ? abbrevName(p) : '#' + a.playerId;
      const texts = a.text || (a.fields || []).map(f => STAT_NAMES[f] || f).join(' + ') || 'acció';
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

async function removePlayerFromGame(gameId, playerId) {
  if (!confirm('Marcar aquest jugador com a no jugat? Quedarà fora del partit i no comptarà com a partit jugat.')) return;
  const game = await DB.get('games', gameId);
  if (!game) return;
  const stats = await DB.getByIndex('stats', 'gameId', gameId);
  const record = stats.find(s => s.playerId === playerId);
  if (record) await DB.delete('stats', record.id);
  game.playerIds = (game.playerIds || []).filter(pid => pid !== playerId);
  if (game.onCourtPlayerIds) game.onCourtPlayerIds = game.onCourtPlayerIds.filter(pid => pid !== playerId);
  await DB.put('games', game);
  renderHistory();
  viewGameDetail(gameId);
}

function toggleGameMetaEdit() {
  const game = cachedDetailGame;
  const c = document.getElementById('detailMetaEdit');
  if (!game || !c) return;
  if (c.innerHTML === '') {
    const d = new Date(game.date);
    const today = isNaN(d.getTime()) ? '' :
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    c.innerHTML = `
      <div class="card border-secondary"><div class="card-body p-2 d-flex flex-wrap gap-2 align-items-end">
        <div>
          <label class="form-label small text-secondary mb-1">Tipus de partit:</label>
          <select id="detailGameType" class="form-select form-select-sm">${GAME_TYPES.map(t => `<option value="${t}" ${game.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </div>
        <div>
          <label class="form-label small text-secondary mb-1">Data:</label>
          <input type="date" id="detailGameDate" class="form-control form-control-sm" value="${today}">
        </div>
        <button class="btn btn-sm btn-primary" onclick="saveGameMeta()">Desa</button>
      </div></div>`;
  } else {
    c.innerHTML = '';
  }
}

async function saveGameMeta() {
  const game = cachedDetailGame;
  if (!game) return;
  const sel = document.getElementById('detailGameType');
  const dIn = document.getElementById('detailGameDate');
  if (sel) game.type = sel.value;
  if (dIn && dIn.value) {
    const nd = new Date(dIn.value + 'T12:00:00');
    if (!isNaN(nd.getTime())) game.date = nd.toISOString();
  }
  await DB.put('games', game);
  document.getElementById('detailMetaEdit').innerHTML = '';
  renderHistory();
  viewGameDetail(game.id);
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
  const teamFinishedIds = new Set(allGames.filter(g => !g.isActive).map(g => g.id));
  const players = await DB.getAll('players');
  const playerMap = {};
  players.forEach(p => playerMap[p.id] = p);
  const teams = await DB.getAll('teams');
  const teamMap = {};
  teams.forEach(t => teamMap[t.id] = t);
  const gameMap = {};
  allGames.forEach(g => gameMap[g.id] = g);

  const teamSel = document.getElementById('statsTeamFilter');
  if (teamSel) {
    const prev = teamSel.value;
    teamSel.innerHTML = `<option value="all">Tots</option>` +
      teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    if (prev !== '' && Array.from(teamSel.options).some(o => o.value === prev)) teamSel.value = prev;
  }
  const typeSel = document.getElementById('statsTypeFilter');
  if (typeSel) {
    const prev = typeSel.value;
    typeSel.innerHTML = `<option value="all">Tots</option>` +
      GAME_TYPES.map(t => `<option value="${t}">${esc(t)}</option>`).join('');
    if (prev !== '' && Array.from(typeSel.options).some(o => o.value === prev)) typeSel.value = prev;
  }
  populateSeason('statsSeasonFilter', allGames.filter(g => !g.isActive));
  const teamVal = teamSel ? teamSel.value : 'all';
  const typeVal = typeSel ? typeSel.value : 'all';
  const seasonSel = document.getElementById('statsSeasonFilter');
  const seasonVal = seasonSel ? seasonSel.value : 'all';

  const stats = allStats.filter(s => {
    if (!teamFinishedIds.has(s.gameId)) return false;
    const g = gameMap[s.gameId];
    if (!g) return false;
    if (teamVal !== 'all' && String(g.teamId) !== teamVal) return false;
    if (typeVal !== 'all' && g.type !== typeVal) return false;
    if (seasonVal !== 'all' && seasonOf(g.date) !== seasonVal) return false;
    return true;
  });
  if (stats.length === 0) {
    container.innerHTML = allStats.length === 0
      ? '<div class="text-center text-secondary py-4">&#128200;<br>No hi ha dades encara</div>'
      : '<div class="text-center text-secondary py-4">&#128200;<br>Cap resultat amb aquests filtres</div>';
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

  const rows = Object.keys(totals).map(pid => {
    const t = totals[pid];
    const p = playerMap[parseInt(pid)];
    const team = p ? teamMap[p.teamId] : null;
    const n = gamesCount[pid];
    const pts = calcScore(t);
    const val = calcVal(t);
    const reb = t.oReb + t.dReb;
    return { pid, team, n, t, pts, val, reb, name: p ? abbrevName(p) : '?', num: p && p.number !== '' && p.number != null ? parseInt(p.number) : null };
  });

  const rowCell = (r) => {
    const t = r.t;
    const name = r.name;
    const team = r.team;
    if (statsMode === 'totals') {
      return `<tr><td class="player-name">${esc(name)}${team ? `<br><small style="color:var(--primary)">${esc(team.name)}</small>` : ''}</td><td>${r.n}</td>`
        + `<td>${r.pts}</td><td>${r.reb}</td><td>${t.assists}</td><td>${r.val}</td>`
        + `<td>${t.ftMade}/${t.ftMade + t.ftMissed}</td><td>${pct(t.ftMade, t.ftMissed)}</td>`
        + `<td>${t.twoMade}/${t.twoMade + t.twoMissed}</td><td>${pct(t.twoMade, t.twoMissed)}</td>`
        + `<td>${t.threeMade}/${t.threeMade + t.threeMissed}</td><td>${pct(t.threeMade, t.threeMissed)}</td>`
        + REST_FIELDS.map(f => `<td>${t[f]}</td>`).join('')
        + '</tr>';
    }
    const n = r.n;
    return `<tr><td>${esc(name)}${team ? `<br><small style="color:var(--primary)">${esc(team.name)}</small>` : ''}</td><td>${n}</td>`
      + `<td>${(r.pts / n).toFixed(1)}</td><td>${(r.reb / n).toFixed(1)}</td><td>${(t.assists / n).toFixed(1)}</td><td>${(r.val / n).toFixed(1)}</td>`
      + `<td>${(t.ftMade / n).toFixed(1)}/${((t.ftMade + t.ftMissed) / n).toFixed(1)}</td><td>${pct(t.ftMade, t.ftMissed)}</td>`
      + `<td>${(t.twoMade / n).toFixed(1)}/${((t.twoMade + t.twoMissed) / n).toFixed(1)}</td><td>${pct(t.twoMade, t.twoMissed)}</td>`
      + `<td>${(t.threeMade / n).toFixed(1)}/${((t.threeMade + t.threeMissed) / n).toFixed(1)}</td><td>${pct(t.threeMade, t.threeMissed)}</td>`
      + REST_FIELDS.map(f => `<td>${(t[f] / n).toFixed(1)}</td>`).join('')
      + '</tr>';
  };

  const numVal = (r, f) => statsMode === 'averages' ? (r.n ? r.t[f] / r.n : 0) : r.t[f];
  const sortVal = (r, key) => {
    const avg = v => statsMode === 'averages' ? (r.n ? v / r.n : 0) : v;
    switch (key) {
      case 'player': return r.num === null ? '~~~' : String(r.num).padStart(3, '0');
      case 'pj': return r.n;
      case 'pts': return avg(r.pts);
      case 'reb': return avg(r.reb);
      case 'ast': return avg(r.t.assists);
      case 'twoPct': return (r.t.twoMade + r.t.twoMissed) ? r.t.twoMade / (r.t.twoMade + r.t.twoMissed) : -1;
      case 'threePct': return (r.t.threeMade + r.t.threeMissed) ? r.t.threeMade / (r.t.threeMade + r.t.threeMissed) : -1;
      case 'ftPct': return (r.t.ftMade + r.t.ftMissed) ? r.t.ftMade / (r.t.ftMade + r.t.ftMissed) : -1;
      case 'val': return avg(r.val);
      case 'ppt': return r.n ? r.pts / r.n : 0;
      case 'vpp': return r.n ? r.val / r.n : 0;
      default: return numVal(r, key);
    }
  };

  if (statsSortKey) {
    rows.sort((a, b) => {
      const va = sortVal(a, statsSortKey);
      const vb = sortVal(b, statsSortKey);
      let c;
      if (typeof va === 'string') c = va.localeCompare(vb);
      else c = va < vb ? -1 : va > vb ? 1 : 0;
      if (c === 0 && statsSortKey === 'player') c = a.name.localeCompare(b.name);
      return statsSortAsc ? c : -c;
    });
  }

  const th = (label, key) => `<th class="${statsSortKey === key ? 'sort-active' : ''}" onclick="sortStats('${key}')">${label}${statsSortKey === key ? (statsSortAsc ? ' &#9650;' : ' &#9660;') : ''}</th>` + '\n';

  const headers = th('Jug', 'player') + th('PJ', 'pj') + th('PTS', 'pts') + th('REB', 'reb') + th('AST', 'ast') + th('VAL', 'val')
    + th('T1', 'ftMade') + th('%T1', 'ftPct')
    + th('T2', 'twoMade') + th('%T2', 'twoPct')
    + th('T3', 'threeMade') + th('%T3', 'threePct')
    + REST_FIELDS.map(f => th(STAT_LABELS[f], f)).join('');
  container.innerHTML = '<table class="table table-dark table-striped table-sm stats-table"><thead><tr>' + headers
    + '</tr></thead><tbody>' + rows.map(rowCell).join('') + '</tbody></table>';
}

function sortStats(key) {
  if (statsSortKey === key) statsSortAsc = !statsSortAsc;
  else { statsSortKey = key; statsSortAsc = true; }
  renderGlobalStats();
}

// RECORDS
let recordsMode = 'game';
let recordsQuarter = null;
let recordsGroup = 'player';

function switchRecordsGroup(group) {
  recordsGroup = group;
  document.getElementById('tabRecordsPlayer').classList.toggle('active', group === 'player');
  document.getElementById('tabRecordsTeam').classList.toggle('active', group === 'team');
  renderRecords();
}

function switchRecordsMode(mode) {
  recordsMode = mode;
  document.getElementById('tabRecordsGame').classList.toggle('active', mode === 'game');
  document.getElementById('tabRecordsQuarter').classList.toggle('active', mode === 'quarter');
  renderRecords();
  renderRecordsQuarters();
}

async function renderRecordsQuarters() {
  const el = document.getElementById('recordsQuarters');
  if (recordsMode !== 'quarter') { el.style.display = 'none'; return; }
  const teamSel = document.getElementById('recordsTeamFilter');
  const typeSel = document.getElementById('recordsTypeFilter');
  const seasonSel = document.getElementById('recordsSeasonFilter');
  const teamVal = teamSel ? teamSel.value : 'all';
  const typeVal = typeSel ? typeSel.value : 'all';
  const seasonVal = seasonSel ? seasonSel.value : 'all';
  const allGames = await DB.getAll('games');
  const finished = allGames.filter(g => !g.isActive
    && (teamVal === 'all' || String(g.teamId) === teamVal)
    && (typeVal === 'all' || g.type === typeVal)
    && (seasonVal === 'all' || seasonOf(g.date) === seasonVal));
  let maxP = 4;
  finished.forEach(g => (g.actions || []).forEach(a => {
    const p = a.period || 1;
    if (p > maxP) maxP = p;
  }));
  const qBtn = (label, q) => `<button class="btn btn-sm ${(q === 0 ? recordsQuarter === null : recordsQuarter === q) ? 'btn-primary' : 'btn-outline-secondary'}" onclick="setRecordsQuarter(${q})">${label}</button>`;
  let html = '<div class="d-flex gap-1 flex-wrap mb-2">';
  html += qBtn('Tots', 0);
  html += ['1er', '2n', '3r', '4t'].map((l, i) => qBtn(l, i + 1)).join('');
  for (let p = 5; p <= maxP; p++) html += qBtn(`Pr${p - 4}`, p);
  html += '</div>';
  el.innerHTML = html;
  el.style.display = '';
}

function setRecordsQuarter(q) {
  recordsQuarter = q === 0 ? null : q;
  renderRecords();
  renderRecordsQuarters();
}

async function renderRecords() {
  const container = document.getElementById('recordsList');
  const allGames = await DB.getAll('games');
  const teamSel = document.getElementById('recordsTeamFilter');
  const typeSel = document.getElementById('recordsTypeFilter');
  const teams = await DB.getAll('teams');
  if (teamSel) {
    const prev = teamSel.value;
    teamSel.innerHTML = `<option value="all">Tots</option>` +
      teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    if (prev !== '' && Array.from(teamSel.options).some(o => o.value === prev)) teamSel.value = prev;
  }
  if (typeSel) {
    const prev = typeSel.value;
    typeSel.innerHTML = `<option value="all">Tots</option>` +
      GAME_TYPES.map(t => `<option value="${t}">${esc(t)}</option>`).join('');
    if (prev !== '' && Array.from(typeSel.options).some(o => o.value === prev)) typeSel.value = prev;
  }
  populateSeason('recordsSeasonFilter', allGames.filter(g => !g.isActive));
  const teamVal = teamSel ? teamSel.value : 'all';
  const typeVal = typeSel ? typeSel.value : 'all';
  const seasonSel = document.getElementById('recordsSeasonFilter');
  const seasonVal = seasonSel ? seasonSel.value : 'all';
  const finished = allGames.filter(g => !g.isActive
    && (teamVal === 'all' || String(g.teamId) === teamVal)
    && (typeVal === 'all' || g.type === typeVal)
    && (seasonVal === 'all' || seasonOf(g.date) === seasonVal));
  const finishedIds = new Set(finished.map(g => g.id));
  const stats = (await DB.getAll('stats')).filter(s => finishedIds.has(s.gameId));
  const players = await DB.getAll('players');
  const pMap = {};
  players.forEach(p => pMap[p.id] = p);
  const gameMap = {};
  finished.forEach(g => gameMap[g.id] = g);
  const scoreMap = {};
  stats.forEach(s => {
    if (!scoreMap[s.gameId]) scoreMap[s.gameId] = emptyStats();
    Object.keys(scoreMap[s.gameId]).forEach(k => scoreMap[s.gameId][k] += s[k]);
  });
  const finalScore = g => {
    const t = scoreMap[g.id];
    const rs = (g.rival1pt || 0) + (g.rival2pt || 0) * 2 + (g.rival3pt || 0) * 3;
    return `${t ? calcScore(t) : 0}-${rs}`;
  };
  const groups = { player: [], team: [] };
  const fmtDate = g => {
    const d = new Date(g.date || g.timestamp);
    return d.toLocaleDateString('ca-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const dateSub = g => `${fmtDate(g)} &middot; ${esc(g.team)} - ${esc(g.opponent)}${g.type ? ` &middot; ${esc(g.type)}` : ''} (${finalScore(g)})`;
  const playerSub = (pid, g) => `${esc(playerLabel(pMap[pid]))} &middot; ${dateSub(g)}`;

  const isBadRec = label => /fallats|Perdudes|Taps rebuts|Punts rebuts|Faltes fetes/.test(label);

  const addRow = (group, label, value, sub) => groups[group].push(`<li class="list-group-item d-flex align-items-center gap-2 px-2 py-2">
      <span class="fw-semibold" style="flex:none;width:150px">${label}</span>
      <span class="badge ${isBadRec(label) ? 'bg-danger' : 'bg-success'} text-nowrap" style="flex:none;width:56px;text-align:center">${value}</span>
      <span class="small text-secondary" style="flex:1;min-width:0">${sub}</span>
    </li>`);

  if (stats.length === 0) {
    container.innerHTML = '<div class="text-center text-secondary py-4">&#127942;<br>No hi ha records encara</div>';
    return;
  }

  if (recordsMode === 'game') {
    const allIndiv = (label, keyFn) => {
      let max = null;
      stats.forEach(s => {
        const v = keyFn(s);
        if (max === null || v > max) max = v;
      });
      if (max === null) return;
      const who = stats
        .filter(s => keyFn(s) === max)
        .map(s => playerSub(s.playerId, gameMap[s.gameId]));
      addRow('player', label, max, who.join('<br>'));
    };
    allIndiv('Punts', s => calcScore(s));
    allIndiv('Rebots totals', s => s.oReb + s.dReb);
    allIndiv('Rebots ofensius', s => s.oReb);
    allIndiv('Rebots defensius', s => s.dReb);
    allIndiv('Assistències', s => s.assists);
    allIndiv('Taps', s => s.blocks);
    allIndiv('Taps rebuts', s => s.blocksAgainst);
    allIndiv('Recuperacions', s => s.steals);
    allIndiv('Perdudes', s => s.turnovers);
    allIndiv('Faltes fetes', s => s.pFouls);
    allIndiv('Faltes rebudes', s => s.foulsReceived);
    allIndiv('Triples ficats', s => s.threeMade);
    allIndiv('Triples intentats', s => s.threeMissed);
    allIndiv('Triples fallats', s => s.threeMissed - s.threeMade);
    allIndiv('Tirs de 2 ficats', s => s.twoMade);
    allIndiv('Tirs de 2 intentats', s => s.twoMissed);
    allIndiv('Tirs de 2 fallats', s => s.twoMissed - s.twoMade);
    allIndiv('Tirs de camp ficats', s => s.twoMade + s.threeMade);
    allIndiv('Tirs de camp intentats', s => s.twoMissed + s.threeMissed);
    allIndiv('Tirs de camp fallats', s => (s.twoMissed - s.twoMade) + (s.threeMissed - s.threeMade));
    allIndiv('Tirs lliures ficats', s => s.ftMade);
    allIndiv('Tirs lliures intentats', s => s.ftMissed);
    allIndiv('Tirs lliures fallats', s => s.ftMissed - s.ftMade);
    allIndiv('Valoració', s => calcVal(s));

    const ddMap = {};
    finished.forEach(g => {
      const per = {};
      stats.filter(s => s.gameId === g.id).forEach(s => per[s.playerId] = s);
      Object.entries(per).forEach(([pid, s]) => {
        const cats = [calcScore(s), s.oReb + s.dReb, s.assists].filter(v => v >= 10).length;
        if (!ddMap[pid]) ddMap[pid] = { dd: [], td: [] };
        if (cats >= 3) ddMap[pid].td.push(g.id);
        else if (cats === 2) ddMap[pid].dd.push(g.id);
      });
    });
    const countRows = (label, key) => {
      const matches = Object.entries(ddMap)
        .map(([pid, c]) => ({ pid, n: c[key].length }))
        .filter(x => x.n > 0)
        .sort((a, b) => b.n - a.n);
      if (matches.length) {
        const who = matches.map(m => `${esc(playerLabel(pMap[m.pid]))} (${m.n})`);
        addRow('player', label, matches[0].n, who.join('<br>'));
      } else {
        addRow('player', label, 0, '&mdash;');
      }
    };
    countRows('Dobles-dobles', 'dd');
    countRows('Triples-dobles', 'td');

    const teamRec = (label, keyFn, isMin) => {
      let best = null;
      Object.entries(scoreMap).forEach(([gid, t]) => {
        const g = gameMap[gid];
        const rival = (g.rival1pt || 0) + (g.rival2pt || 0) * 2 + (g.rival3pt || 0) * 3;
        const v = keyFn(t, rival);
        if (!best || (isMin ? v < best.v : v > best.v)) best = { v, g };
      });
      if (best) addRow('team', label, best.v, `${fmtDate(best.g)} &middot; ${esc(best.g.team)} - ${esc(best.g.opponent)}${best.g.type ? ` &middot; ${esc(best.g.type)}` : ''} (${finalScore(best.g)})`);
    };
    teamRec('Punts', t => calcScore(t));
    teamRec('Punts rebuts', (t, rival) => rival);
    teamRec('Rebots totals', t => t.oReb + t.dReb);
    teamRec('Rebots ofensius', t => t.oReb);
    teamRec('Rebots defensius', t => t.dReb);
    teamRec('Assistències', t => t.assists);
    teamRec('Taps', t => t.blocks);
    teamRec('Taps rebuts', t => t.blocksAgainst);
    teamRec('Recuperacions', t => t.steals);
    teamRec('Perdudes', t => t.turnovers);
    teamRec('Faltes fetes', t => t.pFouls);
    teamRec('Faltes rebudes', t => t.foulsReceived);
    teamRec('Triples ficats', t => t.threeMade);
    teamRec('Triples intentats', t => t.threeMissed);
    teamRec('Triples fallats', t => t.threeMissed - t.threeMade);
    teamRec('Tirs de 2 ficats', t => t.twoMade);
    teamRec('Tirs de 2 intentats', t => t.twoMissed);
    teamRec('Tirs de 2 fallats', t => t.twoMissed - t.twoMade);
    teamRec('Tirs de camp ficats', t => t.twoMade + t.threeMade);
    teamRec('Tirs de camp intentats', t => t.twoMissed + t.threeMissed);
    teamRec('Tirs de camp fallats', t => (t.twoMissed - t.twoMade) + (t.threeMissed - t.threeMade));
    teamRec('Tirs lliures ficats', t => t.ftMade);
    teamRec('Tirs lliures intentats', t => t.ftMissed);
    teamRec('Tirs lliures fallats', t => t.ftMissed - t.ftMade);
    teamRec('Marge de victòria', (t, rival) => calcScore(t) - rival);
    teamRec('Menys punts encaixats', (t, rival) => rival, true);
    teamRec('Punts combinats', (t, rival) => calcScore(t) + rival);
  } else {
    const quads = [];
    const qSub = (g, q) => `${periodLabel(q, g.periods)} &middot; ${fmtDate(g)} &middot; ${esc(g.team)} - ${esc(g.opponent)}${g.type ? ` &middot; ${esc(g.type)}` : ''} (${finalScore(g)})`;
    finished.forEach(g => {
      const per = {};
      (g.actions || []).forEach(a => {
        if (a.type === 'sub' || a.type === 'addPlayer') return;
        const q = a.period || 1;
        if (!per[q]) per[q] = { teamPts: 0, rivalPts: 0, players: {} };
        const p = per[q];
        if (a.playerId === -1) { p.rivalPts += parseInt(a.text) || 0; return; }
        if (!p.players[a.playerId]) p.players[a.playerId] = { pts: 0, oReb: 0, dReb: 0, ast: 0, t3: 0, tw: 0, a2: 0, a3: 0, t1: 0, a1: 0, to: 0, fr: 0, pf: 0, ba: 0, bl: 0, st: 0 };
        const pl = p.players[a.playerId];
        (a.fields || []).forEach(f => {
          if (f === 'twoMade' && !a.fields.includes('threeMade')) { p.teamPts += 2; pl.pts += 2; pl.tw += 1; }
          else if (f === 'threeMade') { p.teamPts += 3; pl.pts += 3; pl.t3 += 1; }
          else if (f === 'ftMade') { p.teamPts += 1; pl.pts += 1; pl.t1 += 1; }
          else if (f === 'oReb') pl.oReb += 1;
          else if (f === 'dReb') pl.dReb += 1;
          else if (f === 'assists') pl.ast += 1;
          else if (f === 'twoMissed') pl.a2 += 1;
          else if (f === 'threeMissed') pl.a3 += 1;
          else if (f === 'ftMissed') pl.a1 += 1;
          else if (f === 'turnovers') pl.to += 1;
          else if (f === 'pFouls') pl.pf += 1;
          else if (f === 'foulsReceived') pl.fr += 1;
          else if (f === 'blocksAgainst') pl.ba += 1;
          else if (f === 'blocks') pl.bl += 1;
          else if (f === 'steals') pl.st += 1;
        });
      });
      Object.entries(per).forEach(([q, p]) => {
        if (recordsQuarter !== null && parseInt(q) !== recordsQuarter) return;
        const qi = parseInt(q);
        const players = Object.entries(p.players).map(([pid, pl]) => ({
          pid: parseInt(pid), ...pl,
          val: pl.pts + (pl.oReb + pl.dReb) + pl.ast + pl.bl + pl.st + pl.fr + pl.t1 + pl.tw + pl.t3
            - (pl.a2 + pl.a3 + pl.a1) - pl.to - pl.ba
        }));
        const sum = f => players.reduce((acc, pl) => acc + pl[f], 0);
        quads.push({
          g, q: qi, teamPts: p.teamPts, rivalPts: p.rivalPts,
          total: p.teamPts + p.rivalPts, marge: p.teamPts - p.rivalPts,
          rebT: sum('oReb') + sum('dReb'), rebO: sum('oReb'), rebD: sum('dReb'),
          ast: sum('ast'), bl: sum('bl'), ba: sum('ba'), st: sum('st'),
          to: sum('to'), pf: sum('pf'), fr: sum('fr'),
          tw: sum('tw'), t3: sum('t3'), t1: sum('t1'), a2: sum('a2'), a3: sum('a3'), a1: sum('a1')
        });
        players.forEach(pl => quads.push({ g, q: qi, ...pl }));
      });
    });
    const bestQ = (label, keyFn, group) => {
      let max = null;
      quads.forEach(x => {
        const v = keyFn(x);
        if (v !== undefined && (max === null || v > max)) max = v;
      });
      if (max === null) return;
      const subOf = x => x.pid !== undefined
        ? `${esc(playerLabel(pMap[x.pid]))} &middot; ${qSub(x.g, x.q)}`
        : qSub(x.g, x.q);
      const who = quads.filter(x => keyFn(x) === max).map(subOf);
      addRow(group, label, max, who.join('<br>'));
    };
    bestQ('Punts', x => x.pid !== undefined ? x.pts : undefined, 'player');
    bestQ('Rebots totals', x => x.pid !== undefined ? x.oReb + x.dReb : undefined, 'player');
    bestQ('Rebots ofensius', x => x.pid !== undefined ? x.oReb : undefined, 'player');
    bestQ('Rebots defensius', x => x.pid !== undefined ? x.dReb : undefined, 'player');
    bestQ('Assistències', x => x.pid !== undefined ? x.ast : undefined, 'player');
    bestQ('Taps', x => x.pid !== undefined ? x.bl : undefined, 'player');
    bestQ('Taps rebuts', x => x.pid !== undefined ? x.ba : undefined, 'player');
    bestQ('Recuperacions', x => x.pid !== undefined ? x.st : undefined, 'player');
    bestQ('Perdudes', x => x.pid !== undefined ? x.to : undefined, 'player');
    bestQ('Faltes fetes', x => x.pid !== undefined ? x.pf : undefined, 'player');
    bestQ('Faltes rebudes', x => x.pid !== undefined ? x.fr : undefined, 'player');
    bestQ('Triples ficats', x => x.pid !== undefined ? x.t3 : undefined, 'player');
    bestQ('Triples intentats', x => x.pid !== undefined ? x.a3 : undefined, 'player');
    bestQ('Triples fallats', x => x.pid !== undefined ? x.a3 - x.t3 : undefined, 'player');
    bestQ('Tirs de 2 ficats', x => x.pid !== undefined ? x.tw : undefined, 'player');
    bestQ('Tirs de 2 intentats', x => x.pid !== undefined ? x.a2 : undefined, 'player');
    bestQ('Tirs de 2 fallats', x => x.pid !== undefined ? x.a2 - x.tw : undefined, 'player');
    bestQ('Tirs de camp ficats', x => x.pid !== undefined ? x.tw + x.t3 : undefined, 'player');
    bestQ('Tirs de camp intentats', x => x.pid !== undefined ? x.a2 + x.a3 : undefined, 'player');
    bestQ('Tirs de camp fallats', x => x.pid !== undefined ? (x.a2 + x.a3) - (x.tw + x.t3) : undefined, 'player');
    bestQ('Tirs lliures ficats', x => x.pid !== undefined ? x.t1 : undefined, 'player');
    bestQ('Tirs lliures intentats', x => x.pid !== undefined ? x.a1 : undefined, 'player');
    bestQ('Tirs lliures fallats', x => x.pid !== undefined ? x.a1 - x.t1 : undefined, 'player');
    bestQ('Valoració', x => x.pid !== undefined ? x.val : undefined, 'player');
    bestQ('Punts', x => x.pid === undefined ? x.teamPts : undefined, 'team');
    bestQ('Punts rebuts', x => x.pid === undefined ? x.rivalPts : undefined, 'team');
    bestQ('Rebots totals', x => x.pid === undefined ? x.rebT : undefined, 'team');
    bestQ('Rebots ofensius', x => x.pid === undefined ? x.rebO : undefined, 'team');
    bestQ('Rebots defensius', x => x.pid === undefined ? x.rebD : undefined, 'team');
    bestQ('Assistències', x => x.pid === undefined ? x.ast : undefined, 'team');
    bestQ('Taps', x => x.pid === undefined ? x.bl : undefined, 'team');
    bestQ('Taps rebuts', x => x.pid === undefined ? x.ba : undefined, 'team');
    bestQ('Recuperacions', x => x.pid === undefined ? x.st : undefined, 'team');
    bestQ('Perdudes', x => x.pid === undefined ? x.to : undefined, 'team');
    bestQ('Faltes fetes', x => x.pid === undefined ? x.pf : undefined, 'team');
    bestQ('Faltes rebudes', x => x.pid === undefined ? x.fr : undefined, 'team');
    bestQ('Triples ficats', x => x.pid === undefined ? x.t3 : undefined, 'team');
    bestQ('Triples intentats', x => x.pid === undefined ? x.a3 : undefined, 'team');
    bestQ('Triples fallats', x => x.pid === undefined ? x.a3 - x.t3 : undefined, 'team');
    bestQ('Tirs de 2 ficats', x => x.pid === undefined ? x.tw : undefined, 'team');
    bestQ('Tirs de 2 intentats', x => x.pid === undefined ? x.a2 : undefined, 'team');
    bestQ('Tirs de 2 fallats', x => x.pid === undefined ? x.a2 - x.tw : undefined, 'team');
    bestQ('Tirs de camp ficats', x => x.pid === undefined ? x.tw + x.t3 : undefined, 'team');
    bestQ('Tirs de camp intentats', x => x.pid === undefined ? x.a2 + x.a3 : undefined, 'team');
    bestQ('Tirs de camp fallats', x => x.pid === undefined ? (x.a2 + x.a3) - (x.tw + x.t3) : undefined, 'team');
    bestQ('Tirs lliures ficats', x => x.pid === undefined ? x.t1 : undefined, 'team');
    bestQ('Tirs lliures intentats', x => x.pid === undefined ? x.a1 : undefined, 'team');
    bestQ('Tirs lliures fallats', x => x.pid === undefined ? x.a1 - x.t1 : undefined, 'team');
    bestQ('Marge de victòria', x => x.pid === undefined ? x.marge : undefined, 'team');
    const minRival = quads.reduce((acc, x) => (x.pid === undefined && (!acc || x.rivalPts < acc.x.rivalPts)) ? { x } : acc, null);
    if (minRival) addRow('team', 'Menys punts encaixats', minRival.x.rivalPts, qSub(minRival.x.g, minRival.x.q));
    bestQ('Punts combinats', x => x.pid === undefined ? x.total : undefined, 'team');
  }

  const rows = groups[recordsGroup] || [];
  container.innerHTML = rows.length
    ? `<ul class="list-group list-group-flush">${rows.join('')}</ul>`
    : '<div class="text-center text-secondary py-4">&#127942;<br>No hi ha records encara</div>';
}

async function cleanupDuplicateGames() {
  const games = (await DB.getAll('games')).sort((a, b) => (a.id || 0) - (b.id || 0));
  const dayOf = d => (d || '').slice(0, 10);
  const key = g => `${dayOf(g.date)}|${String(g.opponent || '').trim().toLowerCase()}`;
  const seen = new Set();
  const removeIds = [];
  games.forEach(g => {
    if (seen.has(key(g))) removeIds.push(g.id);
    else seen.add(key(g));
  });
  if (!removeIds.length) { alert('No hi ha partits duplicats.'); return; }
  if (!confirm(`S'eliminaran ${removeIds.length} partits duplicats i les seves estadístiques. Continuar?`)) return;
  const allStats = await DB.getAll('stats');
  const removeSet = new Set(removeIds);
  for (const s of allStats) if (removeSet.has(s.gameId)) await DB.delete('stats', s.id);
  for (const id of removeIds) await DB.delete('games', id);
  alert(`Eliminats ${removeIds.length} partits duplicats.`);
  location.reload();
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
    const court = onCourtIds();
    if (!activeGame || court.length < 2) return;
    const idx = court.indexOf(currentPlayerTab);
    if (dx < 0 && idx < court.length - 1) {
      selectPlayerTab(court[idx + 1]);
      renderLiveStats();
    } else if (dx > 0 && idx > 0) {
      selectPlayerTab(court[idx - 1]);
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
