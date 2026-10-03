'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
type Item = { value: string; label: string; count: number; isTarget: boolean; aliases: string[] };
export function FacetMergeList({
  category,
  items,
  recoveryRunning = false,
  recoveryAvailable = false,
}: {
  category: 'country' | 'genre';
  items: Item[];
  recoveryRunning?: boolean;
  recoveryAvailable?: boolean;
}) {
  const router = useRouter();
  const [sourceQuery, setSourceQuery] = useState('');
  const [targetQuery, setTargetQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  const [aliasSelection, setAliasSelection] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const busy = saving || refreshing || recoveryRunning;
  const active = items.find((item) => item.value === target);
  const sources = items.filter((item) => !item.isTarget && item.value !== target);
  const chosen = selected.filter((value) => sources.some((item) => item.value === value));
  const chosenAliases = aliasSelection.filter((value) => active?.aliases.includes(value));
  const matches = (item: Item, query: string) =>
    [item.value, item.label].some((value) =>
      value.toLocaleLowerCase('de').includes(query.trim().toLocaleLowerCase('de')),
    );
  const visibleSources = sources.filter((item) => matches(item, sourceQuery));
  const visibleTargets = useMemo(
    () =>
      items.filter(
        (item) =>
          matches(item, targetQuery) ||
          item.aliases.some((alias) =>
            alias.toLocaleLowerCase('de').includes(targetQuery.trim().toLocaleLowerCase('de')),
          ),
      ),
    [items, targetQuery],
  );
  const toggle = (values: string[], value: string) =>
    values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
  function chooseTarget(value: string) {
    setTarget(value);
    setAliasSelection([]);
    setSelected((values) => values.filter((v) => v !== value));
  }
  async function save(operation: 'merge' | 'unmerge' | 'release') {
    if (!active || busy) return;
    const unmerge = operation === 'unmerge';
    const release = operation === 'release';
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: release ? 'release-facet-target' : unmerge ? 'unmerge-facet' : 'merge-facet',
          data: { category, canonical: target, aliases: unmerge ? chosenAliases : chosen },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || 'Zuordnung konnte nicht gespeichert werden.');
      setNotice(
        release
          ? `„${active.label}“ ist wieder links als offener Begriff verfügbar. Bestehende Titel bleiben unverändert.`
          : unmerge
            ? `${data.aliases} Alias-Zuordnung(en) gelöst. ${data.affected} Titel anhand ihrer Originalwerte neu zugeordnet.`
            : `${data.affected} Titel aktualisiert. Die Zuordnung zu „${active.label}“ gilt auch für künftige Importe.`,
      );
      setSelected([]);
      setAliasSelection([]);
      if (release) {
        setTarget('');
        setSourceQuery(active.value);
      }
      setExpanded((values) => [...new Set([...values, target])]);
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const name = (item: Item) => (
    <span className="facet-merge-label">
      {item.label}
      {item.label !== item.value && <small className="muted"> {item.value}</small>}
    </span>
  );
  return (
    <>
      {recoveryAvailable && (
        <button
          className="button"
          type="button"
          onClick={async () => {
            try {
              const response = await fetch('/api/admin/facet-recovery', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'show' }),
              });
              if (!response.ok) throw Error('Status konnte nicht geöffnet werden.');
              router.refresh();
            } catch (error) {
              setError((error as Error).message);
            }
          }}
        >
          Wiederherstellungsstatus anzeigen
        </button>
      )}
      {notice && (
        <p className="panel" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="facet-manager" aria-busy={busy}>
        <section className="facet-pane" aria-label="Offene Begriffe">
          <header>
            <span className="eyebrow accent">QUELLE</span>
            <h2>
              Offene Begriffe <small>{sources.length}</small>
            </h2>
            <p>Keinem Ziel zugeordnet und aktuell selbst kein Ziel.</p>
            <input
              type="search"
              aria-label="Offene Begriffe suchen"
              placeholder="Begriff suchen …"
              value={sourceQuery}
              onChange={(e) => setSourceQuery(e.target.value)}
            />
          </header>
          <div className="facet-scroll">
            {visibleSources.map((item) => (
              <label
                key={item.value}
                className={`facet-merge-row${chosen.includes(item.value) ? ' selected' : ''}`}
              >
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={chosen.includes(item.value)}
                  onChange={() => setSelected(toggle(selected, item.value))}
                />
                {name(item)}
                <span className="facet-count">{item.count.toLocaleString('de-DE')}</span>
              </label>
            ))}
            {!visibleSources.length && (
              <p className="empty compact">
                {sources.length ? 'Keine Treffer.' : 'Alle Begriffe sind zugeordnet.'}
              </p>
            )}
          </div>
          <footer>
            {chosen.length} ausgewählt
            {chosen.length > 0 && (
              <button className="facet-text-button" disabled={busy} onClick={() => setSelected([])}>
                Auswahl aufheben
              </button>
            )}
          </footer>
        </section>
        <div className="facet-transfer">
          <button
            type="button"
            className="button primary"
            disabled={busy || !active || !chosen.length || chosen.length > 100}
            onClick={() => save('merge')}
          >
            Zuordnen →
          </button>
          <button
            type="button"
            className="button"
            disabled={busy || !chosenAliases.length || chosenAliases.length > 100}
            onClick={() => save('unmerge')}
          >
            ← Alias lösen
          </button>
          <p>
            {recoveryRunning
              ? 'Originalwerte werden wiederhergestellt …'
              : busy
                ? 'Wird gespeichert …'
                : active
                  ? `Ziel: ${active.label}`
                  : 'Rechts ein Ziel wählen.'}
          </p>
          {active?.isTarget && active.aliases.length === 0 && (
            <>
              <button type="button" className="button" disabled={busy} onClick={() => save('release')}>
                Ziel wieder freigeben
              </button>
              <p>Der Begriff wird links wieder auswählbar. Bestehende Titel bleiben unverändert.</p>
            </>
          )}
          {(chosen.length > 100 || chosenAliases.length > 100) && (
            <p>Bitte höchstens 100 Begriffe auf einmal wählen.</p>
          )}
        </div>
        <section className="facet-pane" aria-label="Alle Begriffe und Aliase">
          <header>
            <span className="eyebrow accent">ZIEL</span>
            <h2>Alle Begriffe & Aliase</h2>
            <p>Ein Ziel wählen. Zugeordnete Aliase lassen sich aufklappen.</p>
            <input
              type="search"
              aria-label="Ziele und Aliase suchen"
              placeholder="Begriff oder Alias suchen …"
              value={targetQuery}
              onChange={(e) => setTargetQuery(e.target.value)}
            />
          </header>
          <div className="facet-scroll">
            {visibleTargets.map((item) => {
              const open = expanded.includes(item.value) || !!targetQuery.trim();
              return (
                <div key={item.value}>
                  <div className={`facet-target-row${target === item.value ? ' selected' : ''}`}>
                    {item.aliases.length > 0 ? (
                      <button
                        type="button"
                        className="facet-expand"
                        aria-label={`Aliase von ${item.label}`}
                        aria-expanded={open}
                        onClick={() => setExpanded(toggle(expanded, item.value))}
                      >
                        {open ? '▾' : '▸'}
                      </button>
                    ) : (
                      <span className="facet-expand" />
                    )}
                    <label className="facet-merge-row">
                      <input
                        type="radio"
                        name={`target-${category}`}
                        disabled={busy}
                        checked={target === item.value}
                        onChange={() => chooseTarget(item.value)}
                      />
                      {name(item)}
                      {item.isTarget && <small className="facet-badge">Ziel</small>}
                      <span className="facet-count">{item.count.toLocaleString('de-DE')}</span>
                    </label>
                  </div>
                  {open &&
                    item.aliases.map((alias) => (
                      <label className="facet-alias-row" key={alias}>
                        <span aria-hidden="true">↳</span>
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={target === item.value && chosenAliases.includes(alias)}
                          onChange={() => {
                            if (target !== item.value) {
                              setTarget(item.value);
                              setSelected((values) => values.filter((v) => v !== item.value));
                              setAliasSelection([alias]);
                            } else setAliasSelection(toggle(aliasSelection, alias));
                          }}
                        />
                        <span>{alias}</span>
                        <small className="muted">Alias</small>
                      </label>
                    ))}
                </div>
              );
            })}
            {!visibleTargets.length && <p className="empty compact">Keine Treffer.</p>}
          </div>
          <footer>
            {active ? `Ziel: ${active.label}` : 'Kein Ziel gewählt'}
            <span>{chosenAliases.length} Aliase ausgewählt</span>
          </footer>
        </section>
      </div>
      <p className="muted small facet-help">
        Zuordnen aktualisiert bestehende Titel und merkt sich die Regel für künftige Importe. „Alias lösen“
        entfernt die Regel und ordnet bestehende Titel anhand ihrer gespeicherten Originalwerte neu zu.
        Bekannte Ländercodes und Genre-Schreibweisen werden weiterhin automatisch vereinheitlicht.
      </p>
    </>
  );
}
