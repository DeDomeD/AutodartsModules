# ADM Logs

Dieser Ordner enthaelt die Datei-Logs der Extension.

## Start

1. In `Main/core/logger.js` die Konstante `LOCAL_WRITER_ENABLED` auf `true` setzen (Standard ist `false`, damit ohne Writer kein Netzwerk-Spam entsteht).
2. `Main/logs/start-log-writer.cmd` doppelklicken
3. Fenster offen lassen (der Writer laeuft dort)
4. Extension neu laden

Ab dann schreibt die Extension automatisch in:
- `Main/logs/all.log` (alles)
- `Main/logs/actions.log`
- `Main/logs/throws.log`
- `Main/logs/errors.log`
- `Main/logs/events.log`
- `Main/logs/system.log`
- `Main/logs/state.log`
- `Main/logs/ui.log`
- `Main/logs/sb.log`
- `Main/logs/overlay.log`

## Technisch

- Lokaler Log-Writer lauscht auf `http://127.0.0.1:8765/log`
- Jede Log-Zeile hat Format:
  `ISO_TIME | LEVEL | CHANNEL | MESSAGE | DATA_JSON`
- Wenn der Writer nicht laeuft, bleiben die Dateien leer.

## Hinweis

Zusatzlich speichert die Extension weiterhin strukturierte Debug-Logs in `chrome.storage.local` (109 Tage Retention, 10 Eintraege pro Tag/Kanal).
