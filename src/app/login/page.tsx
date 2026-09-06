import { LoginForm } from '@/components/login';
import { query } from '@/lib/db';
export const metadata = { title: 'Anmelden', robots: { index: false, follow: false } };
export default async function Page() {
  const setupRequired = !(await query('SELECT 1 FROM admin_account WHERE id=1')).length;
  return (
    <div className="login-page">
      <div className="login-intro">
        <span className="eyebrow accent">{setupRequired ? 'ERSTER START' : 'DEIN PRIVATER VORFÜHRRAUM'}</span>
        <h1>
          {setupRequired ? 'Admin' : 'Willkommen'}
          <br />
          {setupRequired ? 'anlegen' : 'zurück'}
          <span className="accent">.</span>
        </h1>
        <p>
          {setupRequired
            ? 'Ein Konto für den privaten Bereich.'
            : 'Deine History, Bewertungen und Filmabende.'}
          <br />
          {setupRequired ? 'Danach ist die Einrichtung geschlossen.' : 'Nur für dich.'}
        </p>
      </div>
      <LoginForm setupRequired={setupRequired} />
    </div>
  );
}
