# Reviews schreiben und verknüpfen

Nach der Anmeldung auf einer Film-, Serien- oder Staffelseite im Bereich **Reviews** auf **Review schreiben** klicken. Bei einem vorhandenen Review öffnet **Bearbeiten / Sichtbarkeit** den Editor.

## Filme und Personen auswählen

Die Kürzel direkt im Reviewtext eingeben, ohne Leerzeichen zwischen Kürzel und Suchtext:

| Kürzel | Beispiel | Gesuchte Einträge |
| --- | --- | --- |
| `@m` | `@mHellraiser` | Filme nach Titel oder Originaltitel |
| `@r` | `@rTony Randel` | Regisseure |
| `@a` | `@aSophie Marceau` | Darsteller |

1. Mindestens zwei Suchzeichen hinter dem Kürzel eingeben, etwa `@mHe`. Leerzeichen innerhalb eines Namens sind möglich.
2. Nach einer kurzen Tipppause erscheint am Cursor eine Liste mit bis zu sechs Treffern. Bei Filmen hilft das Erscheinungsjahr bei der Auswahl.
3. Mit den Pfeiltasten nach oben oder unten und **Enter** auswählen, alternativ auf einen Treffer klicken oder tippen. **Escape** schließt die Liste.
4. Weiterschreiben und anschließend **Review speichern** wählen. Die Auswahl allein speichert das Review noch nicht.

Nach der Auswahl steht nur der Titel oder Name im Editor, beispielsweise „… vom gleichen Regisseur wie Hellraiser II“. Die Verknüpfung wird mitgespeichert. Ein lediglich eingetippter Name oder ein nicht ausgewählter Suchtext wird nicht automatisch zum Verweis.

## Verweise lesen

Ein Filmverweis führt zur jeweiligen Geza-Filmseite. Ein Personenverweis erscheint unterstrichen. Beim Darüberfahren mit der Maus öffnet sich nach einer kurzen Verzögerung eine Filmvorschau; auf dem Handy öffnet sie sich durch Tippen auf den Namen. Mit der Tastatur lässt sich der Name fokussieren und per Enter oder Leertaste öffnen. Escape schließt die Vorschau.

Die Vorschau enthält bis zu fünf Filme aus Geza, jeweils mit Jahr, sofern vorhanden. Jeder Film ist anklickbar. Bei `@r` zählen die Regieeinträge, bei `@a` die Besetzungseinträge der Person. Die Sortierung bevorzugt die höchste eigene Geza-Bewertung, danach das neuere Erscheinungsjahr; unbewertete Filme folgen dahinter.

## Verweise bearbeiten

Beim erneuten Öffnen eines gespeicherten Reviews bleiben die Verknüpfungen erhalten. Text vor oder nach einem Verweis kann wie gewohnt ergänzt werden. Wird der verknüpfte Titel oder Name selbst verändert, entfällt seine Verknüpfung: Den gewünschten Eintrag dann erneut über `@m`, `@r` oder `@a` auswählen. Zum Entfernen eines Verweises den entsprechenden Text löschen.

**Enthält Spoiler** kennzeichnet das Review als Spoiler. **Öffentlich veröffentlichen – ohne Anschauinformationen** bestimmt die Sichtbarkeit; ohne Häkchen bleibt das Review ein privater Entwurf. Diese Einstellungen gelten auch für Reviews mit Verweisen.

## Suchumfang und Grenzen

- Gesucht wird nur im lokalen Geza-Filmbestand außerhalb der Rumpelkammer. Die Auswahl lädt keine neuen Filme oder Personen von externen Diensten nach; Serien und Episoden sind keine Filmverweis-Treffer.
- Sind mehr als sechs Treffer vorhanden, den Suchtext verlängern. Bleibt die Liste leer, auch den Originaltitel oder eine andere im Katalog gespeicherte Schreibweise versuchen.
- Personen stammen aus den gespeicherten Regie- und Besetzungsnamen. Gleichnamige Personen können derzeit nicht anhand einer eigenen Personen-ID unterschieden werden. Eine spätere Namenskorrektur im Katalog wird nicht automatisch in vorhandene Verweise übernommen.
- Filmverweise speichern die Geza-Datensatz-ID. Eine Umbenennung des Films ändert deshalb nicht das Linkziel; der beim Auswählen eingefügte Text bleibt erhalten.
- Die Suche wartet etwa 200 ms nach dem Tippen, bricht überholte Anfragen ab und verwendet einen Zwischenspeicher. Filmvorschauen werden erst beim Öffnen geladen.

Zurück zur [README](../README.md#film--und-personenverweise-in-reviews).
