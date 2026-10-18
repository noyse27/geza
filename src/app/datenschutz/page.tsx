import { getSetting } from '@/lib/settings';

export const metadata = { title: 'Datenschutz' };

export default async function Page() {
  const [name, address, email, hosting] = await Promise.all([
    getSetting('PRIVACY_CONTROLLER_NAME'),
    getSetting('PRIVACY_CONTROLLER_ADDRESS'),
    getSetting('PRIVACY_CONTROLLER_EMAIL'),
    getSetting('PRIVACY_HOSTING_PROVIDER'),
  ]);
  return (
    <div className="page prose">
      <span className="eyebrow accent">TRANSPARENT & DATENSPARSAM</span>
      <h1>
        Datenschutz<span className="accent">.</span>
      </h1>

      <h2>Verantwortlicher</h2>
      {name || address || email ? (
        <address className="privacy-address">
          {name && <strong>{name}</strong>}
          {address && <span>{address}</span>}
          {email && <a href={`mailto:${email}`}>{email}</a>}
        </address>
      ) : (
        <p className="muted">Die Betreiberangaben werden derzeit ergänzt.</p>
      )}

      <h2>Bereitstellung und Serverprotokolle</h2>
      <p>
        Beim Abruf dieser Website verarbeitet der Server technisch notwendige Verbindungsdaten wie IP-Adresse,
        Zeitpunkt, angeforderte Adresse, übertragene Datenmenge, Referrer und Browserkennung. Die Verarbeitung
        dient der sicheren und zuverlässigen Bereitstellung der Website auf Grundlage von Art. 6 Abs. 1 lit. f
        DSGVO. Serverprotokolle werden nach den Vorgaben des Hosting-Anbieters gelöscht.
      </p>
      {hosting && <p>Hosting: {hosting}</p>}

      <h2>Aufrufzählung</h2>
      <p>
        Öffentliche Titelseiten verwenden eine eigene, cookielose Reichweitenzählung. Zur Vermeidung von
        Mehrfachzählungen wird serverseitig aus IP-Adresse, Browserkennung, Titel und Kalendertag ein nicht
        rückrechenbarer HMAC gebildet. IP-Adresse und Browserkennung werden dafür nicht dauerhaft in der
        Statistikdatenbank gespeichert. Der HMAC wird spätestens nach 48 Stunden gelöscht; dauerhaft erhalten
        bleiben nur die aggregierten Aufrufzahlen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das
        berechtigte Interesse liegt in einer datensparsamen und gegen einfache Manipulation geschützten
        Reichweitenstatistik.
      </p>

      <h2>Cookies</h2>
      <p>
        Geza verwendet keine Werbe- oder Analyse-Cookies. Das Cookie <code>geza_session</code> ist für die
        ausdrücklich verwendete Administrator-Anmeldung erforderlich und läuft nach sieben Tagen ab. Das
        Cookie <code>geza_commenter</code> wird erst nach einer Reaktion oder einem Kommentar gesetzt. Es
        ordnet weitere Reaktionen demselben Browser zu, verhindert einfache Mehrfachabstimmungen und
        unterstützt die Spam-Abwehr; es läuft nach einem Jahr ab. Beide Cookies sind ausschließlich für diese
        Funktionen bestimmt und werden nicht an Dritte übermittelt.
      </p>

      <h2>Kommentare und Reaktionen</h2>
      <p>
        Bei Textkommentaren werden Name, E-Mail-Adresse, Kommentar und gegebenenfalls eine freiwillig
        angegebene Website verarbeitet. Name, Kommentar und Website werden nach Freigabe öffentlich angezeigt;
        die E-Mail-Adresse bleibt nichtöffentlich und wird verschlüsselt gespeichert. Für Moderation und
        Missbrauchsschutz werden außerdem pseudonyme Browser- und kurzlebige Netzwerk-Hashes verarbeitet.
        Rechtsgrundlagen sind Art. 6 Abs. 1 lit. b und lit. f DSGVO. Kommentare bleiben bis zu ihrer Löschung
        gespeichert. Abgelehnte Beiträge und Spam können zur Missbrauchsabwehr aufbewahrt werden, solange dies
        erforderlich ist.
      </p>

      <h2>Betroffenenrechte</h2>
      <p>
        Betroffene Personen haben nach Maßgabe der gesetzlichen Voraussetzungen insbesondere Rechte auf
        Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und Datenübertragbarkeit. Einer auf
        Art. 6 Abs. 1 lit. f DSGVO gestützten Verarbeitung kann aus Gründen der eigenen besonderen Situation
        widersprochen werden. Außerdem besteht ein Beschwerderecht bei einer Datenschutzaufsichtsbehörde.
      </p>
      <p>
        Anfragen können an{' '}
        {email ? <a href={`mailto:${email}`}>{email}</a> : 'den oben genannten Verantwortlichen'} gerichtet
        werden.
      </p>
    </div>
  );
}
