'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
export function LoginForm({ setupRequired = false }: { setupRequired?: boolean }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form
      className="panel login-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        const data = new FormData(e.currentTarget);
        try {
          const r = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: setupRequired ? 'setup' : 'login',
              username: data.get('username'),
              password: data.get('password'),
              passwordConfirm: data.get('passwordConfirm'),
            }),
          });
          const result = await r.json();
          if (!r.ok) throw Error(result.error);
          router.push(result.next);
          router.refresh();
        } catch (e) {
          setError((e as Error).message || 'Anmelden fehlgeschlagen.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{setupRequired ? 'Admin anlegen' : 'Anmelden'}</h2>
      <label>
        Benutzername
        <input name="username" autoComplete="username" required autoFocus />
      </label>
      <label>
        Passwort
        <input
          name="password"
          type="password"
          autoComplete={setupRequired ? 'new-password' : 'current-password'}
          minLength={setupRequired ? 12 : undefined}
          required
        />
      </label>
      {setupRequired && (
        <label>
          Passwort wiederholen
          <input name="passwordConfirm" type="password" autoComplete="new-password" minLength={12} required />
        </label>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary" disabled={busy}>
        {busy
          ? setupRequired
            ? 'Wird angelegt ...'
            : 'Wird angemeldet ...'
          : setupRequired
            ? 'Admin anlegen'
            : 'Tagebuch öffnen'}
        <ArrowUpRight size={18} />
      </button>
      <p className="muted small">Der öffentliche Katalog ist auch ohne Anmeldung zugänglich.</p>
    </form>
  );
}
