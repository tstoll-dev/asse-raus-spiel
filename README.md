# Ass raus

Kartenspiel mit zwei Rommé-Blättern (110 Karten inkl. 6 Joker) für 2–4 Spieler im Browser.
Kein Login: Wer den Link zum Tisch hat, kann sich dazusetzen.

## Aufbau

| Datei | Inhalt |
|---|---|
| `game.js` | Spielregeln und Zustand eines Tisches (ohne Netzwerk) |
| `server.js` | liefert `public/` aus und synchronisiert über WebSocket `/ws` |
| `public/` | Oberfläche (HTML/CSS/JS, keine Abhängigkeiten) |

Der Server entscheidet, was gilt: Clients schicken nur Züge (`join`, `start`, `pick`, `move`, `pass`, `leave`),
der Server prüft sie und schickt jedem Spieler seine eigene Sicht zurück. Fremde Handkarten und
die verdeckten Karten der Hauptstapel verlassen den Server nie. Spielstände werden nach
`data/rooms.json` gesichert und überstehen so einen Neustart.

Die Spieler erkennt das Spiel an einer zufälligen ID im `localStorage`. Wer die Seite neu lädt,
sitzt deshalb wieder auf seinem Platz.

## Lokal starten

```bash
npm install
npm start
```

Dann `http://localhost:3000` öffnen. Für mehrere Spieler einfach mehrere Browserfenster verwenden,
z. B. ein normales und ein privates Fenster.

## Auf dem Server (Docker + nginx)

```bash
docker compose up -d --build
```

Der Container lauscht nur auf `127.0.0.1:3100`. In nginx braucht es einen Proxy mit
WebSocket-Upgrade, siehe `nginx.conf.example`. Er funktioniert auf einer eigenen Subdomain
oder unter einem Unterpfad wie `/assraus/`.

## Bedienung

Eine Karte (beim Verteilen ein Päckchen) auf das Ziel ziehen, mit Maus oder Finger. Oder sie antippen und danach das Ziel antippen.
Mögliche Ziele leuchten grün.

## Regeln

**Verteilen**
- Pro Spieler liegen 3 verdeckte Päckchen à 5 Karten in der Mitte, der Rest ist der Nachziehstapel.
- Reihum nimmt jeder ein Päckchen, bis alle 3 haben. Dabei entscheidet man blind: 1 Päckchen kommt auf die Hand,
  2 Päckchen bilden den Hauptstapel (10 Karten, oberste Karte offen).
- Reihenfolge, auch beim Spielen: Wer den Tisch eröffnet hat, beginnt, danach in der Reihenfolge der Anmeldung.

**Spielstapel**
- Jedes Ass eröffnet einen neuen Spielstapel („Ass raus“). Es gibt so viele Stapel, wie Asse ausgespielt werden.
- Aufgebaut wird vom Ass bis zur Dame in derselben Farbe.
- Joker ersetzen jede Karte, auch das Ass. Wahlweise sind auch Könige Joker (Schalter in der Lobby, standardmässig aus).
- Jeder Joker in einem Spielstapel darf vom Spieler am Zug gegen die Karte getauscht werden, die er vertritt
  (passender Wert und Farbe des Stapels). Dazu die Karte auf den Joker ziehen. Der Joker kommt auf die Hand.
- Die Spielstapel liegen aufgefächert wie bei Solitär, damit man jeden Joker sieht.
- Fertige Stapel (bis zur Dame) kommen am Ende des Zugs auf den Ablagestapel.

**Ein Zug**
1. Hand auf 5 Karten auffüllen.
2. Beliebig viele Karten aus der Hand oder vom Hauptstapel auf die Spielstapel legen.
   Wer dabei alle Handkarten ausspielt, zieht sofort 5 neue und spielt weiter.
3. Eine Handkarte auf den gemeinsamen Ablagestapel legen, das beendet den Zug. Vom Ablagestapel darf man nichts nehmen.
   Gibt es nichts mehr nachzuziehen und ist die Hand leer, beendet man den Zug ohne Ablegen.

Ist der Nachziehstapel leer, wird der Ablagestapel gemischt und zum neuen Nachziehstapel.
Gewonnen hat, wer den Hauptstapel leer gespielt hat.

## Ideen für später

- Was tun, wenn sich das Spiel festfährt (alle Spielstapel warten auf Karten, die tief in Hauptstapeln liegen)?
- Weitere regionale Regeln als Optionen in der Lobby
- Punktezählung über mehrere Runden
