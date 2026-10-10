// Spiellogik "Ass raus" – rein, ohne Netzwerk. Der Server hält pro Tisch ein Game-Objekt.
//
// Ablauf:
//   lobby    → Spieler setzen sich an den Tisch (Reihenfolge der Anmeldung = Spielreihenfolge)
//   picking  → pro Spieler liegen 3 verdeckte Päckchen à 5 Karten in der Mitte. Reihum nimmt jeder
//              eines und entscheidet blind: auf die Hand (1×) oder auf den Hauptstapel (2×).
//   playing  → Zug: Hand auf 5 auffüllen, beliebig viele Karten auf Spielstapel, eine Karte ablegen.
//              Wer die Hand leer spielt, zieht sofort 5 nach.
//   finished → wer den Hauptstapel leer hat, gewinnt.

const SUITS = ['S', 'H', 'D', 'C']; // Pik, Herz, Karo, Kreuz
const HAND_SIZE = 5;
const PACKET_SIZE = 5;
const PACKETS_PER_PLAYER = 3;
const STOCK_PACKETS = 2;
const TOP_RANK = 12; // Spielstapel gehen vom Ass bis zur Dame
const MAX_PLAYERS = 4;
const VERSION = 2; // Format der gespeicherten Tische

// Zwei Rommé-Blätter: je 52 Karten + 3 Joker = 110 Karten.
// rank: 1 = Ass … 11 = Bube, 12 = Dame, 13 = König, 0 = Joker
function createDeck() {
  const cards = [];
  let id = 0;
  for (let deck = 0; deck < 2; deck++) {
    for (const suit of SUITS) {
      for (let rank = 1; rank <= 13; rank++) cards.push({ id: id++, rank, suit });
    }
    for (let j = 0; j < 3; j++) cards.push({ id: id++, rank: 0, suit: null });
  }
  return cards;
}

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

class Game {
  constructor() {
    this.version = VERSION;
    this.players = []; // { clientId, name, connected, stock, hand, stockPackets }
    this.phase = 'lobby';
    this.config = { wildKings: false };
    this.packets = []; // verdeckte Päckchen beim Wählen, genommene sind null
    this.pickTurn = 0;
    this.picksDone = 0;
    this.builds = []; // Spielstapel, jeder beginnt mit einem Ass (oder Joker)
    this.draw = [];
    this.discard = []; // gemeinsamer Ablagestapel
    this.turn = 0;
    this.winner = null;
    this.log = [];
    this.updatedAt = Date.now();
  }

  isWild(card) {
    return card.rank === 0 || (this.config.wildKings && card.rank === 13);
  }

  addLog(text) {
    this.log.push(text);
    if (this.log.length > 30) this.log.shift();
  }

  join(clientId, name) {
    const existing = this.players.find((p) => p.clientId === clientId);
    if (existing) {
      existing.name = name || existing.name;
      existing.connected = true;
      return existing;
    }
    if (this.phase !== 'lobby') throw new Error('Das Spiel läuft bereits.');
    if (this.players.length >= MAX_PLAYERS) throw new Error('Der Tisch ist voll (max. 4).');
    const player = { clientId, name: name || `Spieler ${this.players.length + 1}`, connected: true };
    this.players.push(player);
    this.addLog(`${player.name} setzt sich an den Tisch.`);
    return player;
  }

  leave(clientId) {
    const idx = this.players.findIndex((p) => p.clientId === clientId);
    if (idx < 0) return;
    if (this.phase === 'lobby') {
      this.addLog(`${this.players[idx].name} verlässt den Tisch.`);
      this.players.splice(idx, 1);
    } else {
      this.players[idx].connected = false;
    }
  }

  start(clientId, options = {}) {
    this.requirePlayer(clientId);
    if (this.phase === 'picking' || this.phase === 'playing') throw new Error('Das Spiel läuft bereits.');
    if (this.players.length < 2) throw new Error('Es braucht mindestens 2 Spieler.');
    if (typeof options.wildKings === 'boolean') this.config.wildKings = options.wildKings;

    this.draw = shuffle(createDeck());
    this.packets = Array.from({ length: this.players.length * PACKETS_PER_PLAYER }, () =>
      this.draw.splice(0, PACKET_SIZE),
    );
    this.builds = [];
    this.discard = [];
    this.winner = null;
    this.log = [];
    for (const p of this.players) {
      p.stock = [];
      p.hand = [];
      p.stockPackets = 0;
    }
    // Der Eröffner des Tisches (erster Platz) beginnt, danach in der Reihenfolge der Anmeldung.
    this.pickTurn = 0;
    this.picksDone = 0;
    this.phase = 'picking';
    this.addLog(`Neues Spiel: ${this.packets.length} Päckchen liegen bereit. Könige ${this.config.wildKings ? 'sind' : 'sind keine'} Joker.`);
    this.addLog(`${this.players[0].name} wählt zuerst.`);
  }

  // Ein Päckchen nehmen – blind auf die Hand oder auf den Hauptstapel.
  pick(clientId, packetIndex, to) {
    if (this.phase !== 'picking') throw new Error('Gerade werden keine Päckchen verteilt.');
    const p = this.requirePlayer(clientId);
    if (this.players[this.pickTurn] !== p) throw new Error('Du bist nicht an der Reihe.');
    const packet = this.packets[packetIndex];
    if (!packet) throw new Error('Dieses Päckchen ist schon weg.');

    if (to === 'hand') {
      if (p.hand.length) throw new Error('Du hast schon ein Päckchen auf der Hand.');
      p.hand.push(...packet);
    } else if (to === 'stock') {
      if (p.stockPackets >= STOCK_PACKETS) throw new Error('Dein Hauptstapel ist schon komplett.');
      p.stock.push(...packet);
      p.stockPackets++;
    } else {
      throw new Error('Unbekanntes Ziel.');
    }
    this.packets[packetIndex] = null;
    this.picksDone++;
    this.pickTurn = (this.pickTurn + 1) % this.players.length;

    if (this.picksDone === this.packets.length) {
      this.phase = 'playing';
      this.turn = 0;
      this.addLog('Alle Päckchen sind verteilt – los geht’s!');
      this.beginTurn();
    }
  }

  beginTurn() {
    const p = this.players[this.turn];
    this.refillHand(p);
    this.addLog(`${p.name} ist am Zug.`);
  }

  // Am Ende eines Zugs: fertige Spielstapel (Ass bis Dame) kommen auf den Ablagestapel.
  endTurn() {
    const done = this.builds.filter((pile) => pile.length === TOP_RANK);
    if (done.length) {
      for (const pile of done) this.discard.push(...pile);
      this.builds = this.builds.filter((pile) => pile.length < TOP_RANK);
      this.addLog(`${done.length === 1 ? 'Ein fertiger Spielstapel kommt' : `${done.length} fertige Spielstapel kommen`} auf den Ablagestapel.`);
    }
    this.turn = (this.turn + 1) % this.players.length;
    this.beginTurn();
  }

  drawCard() {
    if (this.draw.length === 0) {
      // Nachziehstapel leer: Ablagestapel neu mischen.
      this.draw = shuffle(this.discard);
      this.discard = [];
    }
    return this.draw.pop();
  }

  refillHand(p) {
    while (p.hand.length < HAND_SIZE) {
      const card = this.drawCard();
      if (!card) break;
      p.hand.push(card);
    }
  }

  requirePlayer(clientId) {
    const p = this.players.find((pl) => pl.clientId === clientId);
    if (!p) throw new Error('Du sitzt nicht an diesem Tisch.');
    return p;
  }

  requireTurn(clientId) {
    if (this.phase !== 'playing') throw new Error('Es läuft kein Spiel.');
    const p = this.requirePlayer(clientId);
    if (this.players[this.turn] !== p) throw new Error('Du bist nicht am Zug.');
    return p;
  }

  // Farbe eines Spielstapels: die der ersten echten (nicht Joker-)Karte.
  pileSuit(pile) {
    const card = pile.find((c) => !this.isWild(c));
    return card ? card.suit : null;
  }

  // Warum eine Karte nicht auf den Stapel passt, oder null, wenn sie passt.
  buildError(pile, card) {
    if (pile.length >= TOP_RANK) return 'Dieser Stapel ist fertig.';
    if (this.isWild(card)) return null;
    const needed = pile.length + 1;
    if (card.rank !== needed) return `Auf diesen Stapel gehört ${rankName(needed)}.`;
    const suit = this.pileSuit(pile);
    if (suit && card.suit !== suit) return 'Die Farbe muss stimmen.';
    return null;
  }

  // Jeder Joker in einem Spielstapel darf gegen die Karte getauscht werden, die er vertritt
  // (Wert = Position im Stapel, Farbe = Farbe des Stapels). Der Joker kommt auf die Hand.
  swapError(pile, index, card) {
    if (!pile[index] || !this.isWild(pile[index])) return 'Hier liegt kein Joker.';
    if (this.isWild(card)) return 'Ein Joker lässt sich nicht gegen einen Joker tauschen.';
    if (card.rank !== index + 1) return `Diesen Joker ersetzt nur ${rankName(index + 1)}.`;
    const suit = this.pileSuit(pile);
    if (suit && card.suit !== suit) return 'Die Farbe muss stimmen.';
    return null;
  }

  checkWin(p, from) {
    if (from.type !== 'stock' || p.stock.length > 0) return false;
    this.phase = 'finished';
    this.winner = p.name;
    this.addLog(`🏆 ${p.name} hat den Hauptstapel leer und gewinnt!`);
    return true;
  }

  // from: { type: 'hand', index } | { type: 'stock' }
  // to:   { type: 'build', pile } | { type: 'newBuild' } | { type: 'swap', pile, index } | { type: 'discard' }
  move(clientId, from, to) {
    const p = this.requireTurn(clientId);
    const card = this.peekSource(p, from);
    if (!card) throw new Error('Dort liegt keine Karte.');

    if (to.type === 'swap') {
      const pile = this.builds[to.pile];
      if (!pile) throw new Error('Unbekannter Stapel.');
      const index = Number(to.index) || 0;
      const err = this.swapError(pile, index, card);
      if (err) throw new Error(err);
      this.takeSource(p, from);
      const joker = pile[index];
      pile[index] = card;
      p.hand.push(joker);
      this.addLog(`${p.name} tauscht einen Joker gegen ${rankName(card.rank)} und nimmt ihn auf die Hand.`);
      this.checkWin(p, from);
      return;
    }

    if (to.type === 'build' || to.type === 'newBuild') {
      let pile;
      if (to.type === 'newBuild') {
        if (card.rank !== 1 && !this.isWild(card)) throw new Error('Ein neuer Spielstapel beginnt mit einem Ass.');
        pile = [];
        this.builds.push(pile);
      } else {
        pile = this.builds[to.pile];
        if (!pile) throw new Error('Unbekannter Stapel.');
        const err = this.buildError(pile, card);
        if (err) throw new Error(err);
      }
      this.takeSource(p, from);
      pile.push(card);
      if (this.checkWin(p, from)) return;
      // Alle Handkarten ausgespielt: sofort 5 nachziehen und weiterspielen.
      if (p.hand.length === 0) {
        this.refillHand(p);
        this.addLog(`${p.name} hat die Hand leer gespielt und zieht ${p.hand.length} Karten nach.`);
      }
      return;
    }

    if (to.type === 'discard') {
      if (from.type !== 'hand') throw new Error('Ablegen geht nur aus der Hand.');
      this.takeSource(p, from);
      this.discard.push(card);
      this.endTurn();
      return;
    }

    throw new Error('Unbekanntes Ziel.');
  }

  // Zug ohne Ablegen beenden – nur wenn keine Handkarte mehr da ist und auch nichts
  // nachgezogen werden konnte (Nachzieh- und Ablagestapel leer).
  pass(clientId) {
    const p = this.requireTurn(clientId);
    if (p.hand.length > 0) throw new Error('Lege eine Handkarte ab, um den Zug zu beenden.');
    this.addLog(`${p.name} hat keine Handkarten mehr und beendet den Zug.`);
    this.endTurn();
  }

  peekSource(p, from) {
    if (from.type === 'hand') return p.hand[from.index];
    if (from.type === 'stock') return p.stock[p.stock.length - 1];
    return undefined;
  }

  takeSource(p, from) {
    if (from.type === 'hand') return p.hand.splice(from.index, 1)[0];
    return p.stock.pop();
  }

  // Sicht eines einzelnen Spielers: fremde Handkarten und verdeckte Karten bleiben geheim.
  viewFor(clientId) {
    const showStock = this.phase === 'playing' || this.phase === 'finished';
    return {
      phase: this.phase,
      config: this.config,
      topRank: TOP_RANK,
      turn: this.turn,
      pickTurn: this.pickTurn,
      winner: this.winner,
      log: this.log,
      drawCount: this.draw.length,
      discardCount: this.discard.length,
      discardTop: this.discard[this.discard.length - 1] || null,
      packets: this.packets.map((pk) => (pk ? pk.length : 0)),
      builds: this.builds.map((pile) => ({ cards: pile, suit: this.pileSuit(pile) })),
      players: this.players.map((p, seat) => {
        const me = p.clientId === clientId;
        return {
          seat,
          me,
          name: p.name,
          connected: p.connected,
          stockCount: p.stock ? p.stock.length : 0,
          stockPackets: p.stockPackets || 0,
          stockTop: showStock && p.stock && p.stock.length ? p.stock[p.stock.length - 1] : null,
          handCount: p.hand ? p.hand.length : 0,
          hand: me ? p.hand || [] : undefined,
        };
      }),
    };
  }

  toJSON() {
    const { version, players, phase, config, packets, pickTurn, picksDone, builds, draw, discard, turn, winner, log, updatedAt } = this;
    return { version, players, phase, config, packets, pickTurn, picksDone, builds, draw, discard, turn, winner, log, updatedAt };
  }

  static fromJSON(data) {
    const g = Object.assign(new Game(), data);
    // Spielstände eines älteren Formats: Spieler behalten, Spiel zurück in die Lobby.
    if (data.version !== VERSION) {
      Object.assign(g, new Game(), { players: g.players.map(({ clientId, name }) => ({ clientId, name })) });
    }
    for (const p of g.players) p.connected = false;
    return g;
  }
}

function rankName(rank) {
  return ['Joker', 'ein Ass', 'eine 2', 'eine 3', 'eine 4', 'eine 5', 'eine 6', 'eine 7', 'eine 8', 'eine 9', 'eine 10', 'ein Bube', 'eine Dame', 'ein König'][rank];
}

module.exports = { Game, MAX_PLAYERS };
