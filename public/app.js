// Client: verbindet sich per WebSocket, zeigt den Tisch an und schickt Züge an den Server.
// Bedienung: Karte (oder beim Verteilen ein Päckchen) aufs Ziel ziehen, oder antippen und
// danach das Ziel antippen. Mögliche Ziele werden grün markiert.

const $ = (sel) => document.querySelector(sel);
const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RANK_LABEL = ['★', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'B', 'D', 'K'];

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* egal */ } },
};

let clientId = store.get('assraus.clientId');
if (!clientId) {
  clientId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  store.set('assraus.clientId', clientId);
}

let ws = null;
let room = null;
let state = null;
let selected = null; // { type: 'hand', index } | { type: 'stock' } | { type: 'packet', index }
const seenCards = new Set(); // für die Austeil-Animation

// ---------- Verbindung ----------

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}${location.pathname.replace(/[^/]*$/, '')}ws`);
  ws.onopen = () => {
    $('#conn').hidden = true;
    if (room) send({ type: 'join', room, name: store.get('assraus.name') || '', clientId });
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'state') {
      state = msg.state;
      render();
    } else if (msg.type === 'error') {
      toast(msg.message);
    }
  };
  ws.onclose = () => {
    if (room) $('#conn').hidden = false;
    setTimeout(connect, 1500);
  };
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ---------- Tisch wählen / Lobby ----------

function randomRoom() {
  const words = ['ass', 'dame', 'bube', 'herz', 'pik', 'karo', 'kreuz', 'joker', 'koenig'];
  return `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(100 + Math.random() * 900)}`;
}

function initJoin() {
  const params = new URLSearchParams(location.search);
  $('#join-name').value = store.get('assraus.name') || '';
  $('#join-room').value = params.get('t') || '';
  $('#btn-new-room').onclick = () => ($('#join-room').value = randomRoom());
  $('#btn-join').onclick = joinRoom;
  for (const input of [$('#join-name'), $('#join-room')]) {
    input.addEventListener('keydown', (e) => e.key === 'Enter' && joinRoom());
  }
  // Wer schon einmal mit Namen an diesem Tisch war, kommt direkt zurück.
  if (params.get('t') && store.get('assraus.name')) joinRoom();
}

function joinRoom() {
  const name = $('#join-name').value.trim();
  const r = $('#join-room').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!name) return toast('Bitte einen Namen eingeben.');
  if (!r) return toast('Bitte einen Tisch wählen oder 🎲 drücken.');
  store.set('assraus.name', name);
  room = r;
  history.replaceState(null, '', `?t=${encodeURIComponent(room)}`);
  send({ type: 'join', room, name, clientId });
}

$('#btn-copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('#lobby-link').value);
    toast('Link kopiert.');
  } catch {
    $('#lobby-link').select();
  }
};
$('#btn-start').onclick = () =>
  send({
    type: 'start',
    options: { wildKings: $('#opt-kings').checked },
  });
$('#btn-leave').onclick = () => {
  send({ type: 'leave' });
  room = null;
  state = null;
  history.replaceState(null, '', location.pathname);
  showScreen('join');
};

// ---------- Darstellung ----------

function showScreen(name) {
  for (const s of ['join', 'lobby', 'table']) $(`#screen-${s}`).hidden = s !== name;
}

function render() {
  if (!state) return showScreen('join');
  if (state.phase === 'lobby') return renderLobby();
  showScreen('table');
  renderTable();
}

function renderLobby() {
  showScreen('lobby');
  seenCards.clear();
  $('#lobby-room').textContent = room;
  $('#lobby-link').value = `${location.origin}${location.pathname}?t=${encodeURIComponent(room)}`;
  const list = $('#lobby-players');
  list.replaceChildren();
  for (let i = 0; i < 4; i++) {
    const p = state.players[i];
    const li = document.createElement('li');
    if (p) li.textContent = `${p.name}${p.me ? ' (du)' : ''}`;
    else {
      li.textContent = 'freier Platz';
      li.className = 'empty';
    }
    list.append(li);
  }
  $('#btn-start').disabled = state.players.length < 2;
  $('#btn-start').textContent = state.players.length < 2 ? 'Warte auf Mitspieler …' : 'Karten verteilen';
}

function renderTable() {
  const me = state.players.find((p) => p.me);
  const picking = state.phase === 'picking';
  const myPick = picking && me && state.players[state.pickTurn] === me;
  const myTurn = state.phase === 'playing' && me && state.players[state.turn] === me;
  if (!myTurn && !myPick) selected = null;
  if (selected && !sourceValid(me, selected)) selected = null;

  let dealIndex = 0;
  const deal = (el, card) => {
    if (card && !seenCards.has(card.id)) {
      seenCards.add(card.id);
      el.classList.add('deal');
      el.style.animationDelay = `${Math.min(dealIndex++, 12) * 60}ms`;
    }
    return el;
  };
  const activeSeat = picking ? state.pickTurn : state.phase === 'playing' ? state.turn : -1;

  // Mitspieler, in Sitzreihenfolge ab dem eigenen Platz
  const opponents = $('#opponents');
  opponents.replaceChildren();
  const mySeat = me ? me.seat : 0;
  for (let k = 1; k < state.players.length; k++) {
    const p = state.players[(mySeat + k) % state.players.length];
    const box = document.createElement('div');
    box.className = 'opponent';
    if (activeSeat === p.seat) box.classList.add('active');
    if (!p.connected) box.classList.add('offline');

    const header = document.createElement('header');
    header.innerHTML = `<span></span><span class="hand-count">✋ ${p.handCount}</span>`;
    header.firstChild.textContent = p.name + (p.connected ? '' : ' (weg)');

    const piles = document.createElement('div');
    piles.className = 'piles';
    piles.append(deal(stockEl(p), p.stockTop));
    box.append(header, piles);
    opponents.append(box);
  }

  // Mitte: Nachziehstapel und gemeinsamer Ablagestapel
  $('#draw-pile').replaceChildren(state.drawCount ? cardEl(null, { back: true }) : emptyEl(''));
  $('#draw-count').textContent = state.drawCount;
  const discard = state.discardTop ? cardEl(state.discardTop) : emptyEl('Ablage');
  if (myTurn && selected?.type === 'hand') makeTarget(discard, () => doMove({ type: 'discard' }));
  $('#discard-pile').replaceChildren(discard);
  $('#discard-count').textContent = state.discardCount;

  // Päckchen zum Wählen
  const packets = $('#packets');
  packets.hidden = !picking;
  packets.replaceChildren();
  if (picking) {
    state.packets.forEach((size, i) => {
      const el = size ? cardEl(null, { back: true }) : emptyEl('');
      if (size) {
        el.classList.add('packet');
        makePickable(el, myPick, { type: 'packet', index: i });
      }
      packets.append(el);
    });
  }

  // Spielstapel: einer pro ausgespieltem Ass, aufgefächert wie bei Solitär, plus ein Platz
  // für das nächste Ass. Auf den Fächer ziehen = oben anlegen, auf einen Joker ziehen = tauschen.
  const builds = $('#build-piles');
  builds.hidden = picking;
  builds.replaceChildren();
  const selCard = myTurn && selected && sourceCard(me, selected);
  state.builds.forEach((pile, i) => {
    const slot = document.createElement('div');
    slot.className = 'slot build';
    const count = pile.cards.length;
    const fan = document.createElement('div');
    fan.className = 'fan';
    if (count === state.topRank) fan.classList.add('complete');
    fan.style.height = `calc(var(--ch) + var(--fan) * ${count - 1})`;
    pile.cards.forEach((card, k) => {
      const el = deal(cardEl(card), card);
      el.style.top = `calc(var(--fan) * ${k})`;
      if (selCard && canSwap(selCard, pile, k)) makeTarget(el, () => doMove({ type: 'swap', pile: i, index: k }));
      fan.append(el);
    });
    if (selCard && canBuild(selCard, pile)) makeTarget(fan, () => doMove({ type: 'build', pile: i }));
    const need = document.createElement('span');
    need.className = 'need';
    const suit = pile.suit ? SUIT_SYMBOL[pile.suit] : '★';
    need.textContent = count === state.topRank ? `${suit} fertig` : `${suit} → ${RANK_LABEL[count + 1]}`;
    if (pile.suit === 'H' || pile.suit === 'D') need.classList.add('red');
    slot.append(fan, need);
    builds.append(slot);
  });
  const newSlot = document.createElement('div');
  newSlot.className = 'slot build';
  const newPile = emptyEl('Ass raus!');
  if (selCard && (selCard.rank === 1 || isWild(selCard))) makeTarget(newPile, () => doMove({ type: 'newBuild' }));
  const newCaption = document.createElement('span');
  newCaption.className = 'need';
  newCaption.textContent = 'neuer Stapel';
  newSlot.append(newPile, newCaption);
  builds.append(newSlot);

  // Eigener Bereich
  $('#me').classList.toggle('active', !!(myTurn || myPick));
  if (me) {
    const stock = deal(stockEl(me), me.stockTop);
    makePickable(stock, myTurn && me.stockTop, { type: 'stock' });
    if (myPick && selected?.type === 'packet' && me.stockPackets < 2) makeTarget(stock, () => doPick('stock'));
    $('#my-stock').replaceChildren(stock);
    $('#my-stock-count').textContent = me.stockCount;

    const hand = $('#my-hand');
    hand.replaceChildren();
    hand.classList.remove('target', 'drop-hover');
    hand.onclick = null;
    me.hand.forEach((card, i) => {
      const el = deal(cardEl(card), card);
      makePickable(el, myTurn, { type: 'hand', index: i });
      hand.append(el);
    });
    if (picking && !me.hand.length) hand.append(emptyEl('Hand'));
    if (myPick && selected?.type === 'packet' && !me.hand.length) makeTarget(hand, () => doPick('hand'));
  }

  // Status und Verlauf
  const status = $('#status');
  status.className = myTurn || myPick ? 'mine' : '';
  if (state.phase === 'finished') {
    status.replaceChildren(winnerBanner());
  } else if (picking) {
    status.textContent = myPick
      ? selected
        ? 'Blind entscheiden: auf die Hand oder auf den Hauptstapel?'
        : 'Du bist dran: Nimm ein Päckchen.'
      : `${state.players[state.pickTurn]?.name ?? '…'} wählt ein Päckchen.`;
  } else if (myTurn && me.hand.length === 0) {
    const pass = document.createElement('button');
    pass.textContent = 'Keine Handkarten – Zug beenden';
    pass.onclick = () => send({ type: 'pass' });
    status.replaceChildren(pass);
  } else if (myTurn) {
    status.textContent = selected
      ? selCard && state.builds.some((pile) => pile.cards.some((_, k) => canSwap(selCard, pile, k)))
        ? 'Grün markiert: anlegen – oder auf einen Joker ziehen, um ihn auszutauschen.'
        : 'Wohin damit? Grün markierte Stapel sind möglich.'
      : 'Du bist am Zug: Karten ausspielen, mit einer Karte auf die Ablage beendest du den Zug.';
  } else {
    status.textContent = `${state.players[state.turn]?.name ?? '…'} ist am Zug.`;
  }
  const log = $('#log');
  log.replaceChildren(...state.log.map((line) => Object.assign(document.createElement('li'), { textContent: line })));
  log.scrollTop = log.scrollHeight;
}

function winnerBanner() {
  const div = document.createElement('div');
  div.className = 'winner-banner';
  const strong = document.createElement('strong');
  strong.textContent = `🏆 ${state.winner} gewinnt!`;
  const again = document.createElement('button');
  again.textContent = 'Neue Runde verteilen';
  again.onclick = () => send({ type: 'start', options: state.config });
  div.append(strong, again);
  return div;
}

function cardEl(card, { back = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card';
  if (back || !card) {
    el.classList.add('back');
    return el;
  }
  if (card.rank === 0) {
    el.classList.add('joker', 'wild');
    // Ecken mit ★, damit man den Joker auch im Fächer erkennt, wo nur der obere Rand sichtbar ist
    el.innerHTML = '<div class="corner">★</div><div class="pip">JOKER</div><div class="corner bottom">★</div>';
    return el;
  }
  const label = RANK_LABEL[card.rank];
  const suit = SUIT_SYMBOL[card.suit];
  if (card.suit === 'H' || card.suit === 'D') el.classList.add('red');
  if (isWild(card)) el.classList.add('wild');
  el.innerHTML =
    `<div class="corner">${label}<small>${suit}</small></div>` +
    `<div class="pip">${suit}</div>` +
    `<div class="corner bottom">${label}<small>${suit}</small></div>`;
  el.title = `${label}${suit}`;
  return el;
}

function emptyEl(text) {
  const el = document.createElement('div');
  el.className = 'card empty';
  el.textContent = text;
  return el;
}

function stockEl(p) {
  // Beim Verteilen ist der Hauptstapel noch ganz verdeckt.
  const el = p.stockTop ? cardEl(p.stockTop) : p.stockCount ? cardEl(null, { back: true }) : emptyEl('leer');
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = p.stockCount;
  el.append(badge);
  return el;
}

function makePickable(el, enabled, source) {
  if (!enabled) return;
  el.classList.add('pickable');
  if (sameSource(selected, source)) el.classList.add('selected');
  el.onclick = (e) => {
    e.stopPropagation();
    if (drag.suppressClick) return;
    selected = sameSource(selected, source) ? null : source;
    renderTable();
  };
  el.onpointerdown = (e) => startDrag(e, el, source);
}

// ---------- Drag & Drop ----------
// Mit Pointer-Events statt HTML5-DnD, damit es auch mit dem Finger geht. Beim Ziehen wird die
// Karte ausgewählt (grüne Ziele erscheinen), losgelassen wird über dem Ziel, das dann wie ein
// Klick ausgelöst wird.

const DRAG_THRESHOLD = 6; // px, darunter gilt es als Klick
const drag = { pending: null, ghost: null, offsetX: 0, offsetY: 0, hover: null, suppressClick: false };

function startDrag(e, el, source) {
  if (e.button !== 0) return;
  const rect = el.getBoundingClientRect();
  drag.pending = { x: e.clientX, y: e.clientY, el, source, rect };
}

document.addEventListener('pointermove', (e) => {
  if (drag.pending && !drag.ghost) {
    const { x, y, el, source, rect } = drag.pending;
    if (Math.hypot(e.clientX - x, e.clientY - y) < DRAG_THRESHOLD) return;
    // Ziehen beginnt: Kopie der Karte folgt dem Zeiger, das Original bleibt als Platzhalter.
    drag.ghost = el.cloneNode(true);
    drag.ghost.className = el.className.replace(/\b(pickable|selected|deal)\b/g, '') + ' ghost';
    drag.ghost.style.cssText = `width:${rect.width}px;height:${rect.height}px;left:${rect.left}px;top:${rect.top}px`;
    drag.offsetX = x - rect.left;
    drag.offsetY = y - rect.top;
    document.body.append(drag.ghost);
    document.body.classList.add('dragging');
    selected = source;
    renderTable();
  }
  if (!drag.ghost) return;
  e.preventDefault();
  drag.ghost.style.left = `${e.clientX - drag.offsetX}px`;
  drag.ghost.style.top = `${e.clientY - drag.offsetY}px`;
  setHover(dropTargetAt(e.clientX, e.clientY));
});

document.addEventListener('pointerup', (e) => {
  if (!drag.ghost) {
    drag.pending = null;
    return;
  }
  const target = dropTargetAt(e.clientX, e.clientY);
  endDrag();
  // Der Browser schickt nach dem Loslassen noch einen click – der soll nichts mehr auswählen.
  drag.suppressClick = true;
  setTimeout(() => (drag.suppressClick = false), 0);
  if (target && target.onclick) {
    target.onclick();
  } else {
    selected = null;
    renderTable();
  }
});

document.addEventListener('pointercancel', () => {
  if (!drag.ghost) return;
  endDrag();
  selected = null;
  renderTable();
});

function endDrag() {
  setHover(null);
  drag.ghost.remove();
  drag.ghost = null;
  drag.pending = null;
  document.body.classList.remove('dragging');
}

function dropTargetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return el && el.closest('.target');
}

function setHover(el) {
  if (drag.hover === el) return;
  drag.hover?.classList.remove('drop-hover');
  drag.hover = el;
  el?.classList.add('drop-hover');
}

function makeTarget(el, action) {
  el.classList.add('target');
  el.onclick = (e) => {
    e?.stopPropagation(); // beim Drop ohne Event aufgerufen
    action();
  };
}

function doMove(to) {
  if (!selected) return;
  send({ type: 'move', from: selected, to });
  selected = null;
}

function doPick(to) {
  if (selected?.type !== 'packet') return;
  send({ type: 'pick', packet: selected.index, to });
  selected = null;
}

// ---------- Regeln (nur für die Anzeige; der Server prüft verbindlich) ----------

function isWild(card) {
  return card.rank === 0 || (state.config.wildKings && card.rank === 13);
}

function canBuild(card, pile) {
  const count = pile.cards.length;
  if (count >= state.topRank) return false;
  if (isWild(card)) return true;
  return card.rank === count + 1 && (!pile.suit || card.suit === pile.suit);
}

// Joker an Position k gegen die Karte tauschen, die er vertritt
function canSwap(card, pile, k) {
  return !isWild(card) && isWild(pile.cards[k]) && card.rank === k + 1 && (!pile.suit || card.suit === pile.suit);
}

function sourceCard(me, src) {
  if (!me || !src) return null;
  if (src.type === 'hand') return me.hand[src.index] || null;
  if (src.type === 'stock') return me.stockTop;
  return null;
}

function sourceValid(me, src) {
  if (src.type === 'packet') return !!state.packets[src.index];
  return !!sourceCard(me, src);
}

function sameSource(a, b) {
  return !!a && !!b && a.type === b.type && a.index === b.index && a.pile === b.pile;
}

// ---------- Kleinkram ----------

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

// Klick ins Leere hebt die Auswahl auf.
document.addEventListener('click', (e) => {
  if (selected && !drag.suppressClick && !e.target.closest('.target, .pickable')) {
    selected = null;
    if (state && state.phase !== 'lobby') renderTable();
  }
});

initJoin();
connect();
