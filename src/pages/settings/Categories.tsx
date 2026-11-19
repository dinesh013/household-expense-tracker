import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { supabase } from '../../lib/supabase';
import { errorText, must, rpc } from '../../lib/api';
import { useApp } from '../../lib/session';
import type { Category } from '../../lib/types';
import { moveItem } from '../../lib/order';
import { categoryColour, Icon, useToast } from '../../components/ui';

const validName = (n: string) => (n.trim() ? (n.trim().length > 40 ? 'Keep it under 40 characters.' : null) : 'Enter a name.');

interface Usage { expense_count: number; locked_count: number }
type UsageMap = Record<string, Usage>;

export default function Categories() {
  const { household, categories, isOwner, refresh } = useApp();
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageMap>({});
  const [order, setOrder] = useState<Category[]>(categories);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Show the saved order, but keep an optimistic reorder on screen while it is being saved.
  useEffect(() => { if (!busy) setOrder(categories); }, [categories, busy]);

  const loadUsage = useCallback(async () => {
    if (!isOwner || !household) return;
    const rows = await rpc<({ category_id: string } & Usage)[]>('category_usage', { p_household: household.id });
    setUsage(Object.fromEntries(rows.map((r) => [r.category_id, { expense_count: r.expense_count, locked_count: r.locked_count }])));
  }, [isOwner, household]);
  useEffect(() => { loadUsage().catch((e) => setError(errorText(e))); }, [loadUsage, categories.length]);

  async function add(e: FormEvent) {
    e.preventDefault();
    const problem = validName(name);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const nextOrder = Math.max(0, ...categories.map((c) => c.sort_order)) + 1;
      await must(supabase.from('categories').insert({ household_id: household!.id, name: name.trim(), sort_order: nextOrder }));
      setName('');
      toast('Category added');
      await refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, by: -1 | 1) {
    const next = moveItem(order, index, by);
    if (next === order) return;
    setOrder(next);
    setBusy(true);
    setError(null);
    try {
      await rpc('reorder_categories', { p_household: household!.id, p_ids: next.map((c) => c.id) });
      await refresh();
    } catch (err) {
      setError(errorText(err));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Category, moveTo: string | null) {
    setBusy(true);
    setError(null);
    try {
      await rpc('delete_category', { p_category: c.id, p_move_to: moveTo });
      setDeleting(null);
      toast(`Deleted ${c.name}`);
      await refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <div className="alert error" role="alert">{error}</div>}
      <section className="card" aria-labelledby="cat-h">
        <div className="card-head"><h2 id="cat-h">Categories</h2><span className="badge">{order.length}</span></div>
        {isOwner && <p className="small muted">Use the arrows to change the order shown in pickers and filters.</p>}
        <ul className="list">
          {order.map((c, i) => (
            <CategoryRow key={c.id} c={c} colour={categoryColour(i)} editable={isOwner} busy={busy} onError={setError}
              isFirst={i === 0} isLast={i === order.length - 1} onMove={(by) => move(i, by)}
              onSaved={async () => { toast('Category renamed'); await refresh(); }}
              deleting={deleting === c.id} onDeleteToggle={(open) => { setError(null); setDeleting(open ? c.id : null); }}
              deletePanel={deleting === c.id && (
                <DeletePanel c={c} usage={usage[c.id]} others={order.filter((o) => o.id !== c.id)} busy={busy}
                  onCancel={() => setDeleting(null)} onDelete={(to) => remove(c, to)} />
              )} />
          ))}
        </ul>
      </section>
      {isOwner ? (
        <form className="card stack" onSubmit={add} noValidate>
          <h2>Add a category</h2>
          <div className="row">
            <label className="sr-only" htmlFor="new-cat">Category name</label>
            <input id="new-cat" className="input" placeholder="e.g. Pets" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            <button className="btn" disabled={busy}>Add</button>
          </div>
        </form>
      ) : (
        <p className="small muted">Only the Owner can add, rename, reorder or delete categories.</p>
      )}
    </>
  );
}

function CategoryRow({ c, colour, editable, busy, isFirst, isLast, onMove, onSaved, onError, deleting, onDeleteToggle, deletePanel }: {
  c: Category; colour: string; editable: boolean; busy: boolean; isFirst: boolean; isLast: boolean;
  onMove: (by: -1 | 1) => void; onSaved: () => Promise<void>; onError: (m: string | null) => void;
  deleting: boolean; onDeleteToggle: (open: boolean) => void; deletePanel: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(c.name);
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const problem = validName(value);
    if (problem) return onError(problem);
    if (value.trim() === c.name) return setEditing(false);
    setSaving(true);
    onError(null);
    try {
      await must(supabase.from('categories').update({ name: value.trim() }).eq('id', c.id));
      setEditing(false);
      await onSaved();
    } catch (err) {
      onError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="cat-item">
      <div className="list-item">
        <span className="swatch" style={{ width: 12, height: 12, borderRadius: 4, background: colour, flex: 'none' }} aria-hidden="true" />
        {editing ? (
          <form className="row grow" onSubmit={save}>
            <label className="sr-only" htmlFor={`cat-${c.id}`}>New name for {c.name}</label>
            <input id={`cat-${c.id}`} className="input" value={value} maxLength={40} autoFocus onChange={(e) => setValue(e.target.value)} />
            <button className="btn sm" disabled={saving}>Save</button>
            <button type="button" className="btn ghost sm" onClick={() => { setEditing(false); setValue(c.name); }}>Cancel</button>
          </form>
        ) : (
          <>
            <span className="grow truncate">{c.name}</span>
            {editable && (
              <div className="cat-actions">
                <button className="icon-btn sm" disabled={busy || isFirst} onClick={() => onMove(-1)} aria-label={`Move ${c.name} up`}>{Icon.up}</button>
                <button className="icon-btn sm" disabled={busy || isLast} onClick={() => onMove(1)} aria-label={`Move ${c.name} down`}>{Icon.down}</button>
                <button className="btn ghost sm" onClick={() => setEditing(true)} aria-label={`Rename ${c.name}`}>Rename</button>
                <button className="btn danger-ghost sm" aria-expanded={deleting} onClick={() => onDeleteToggle(!deleting)} aria-label={`Delete ${c.name}`}>Delete</button>
              </div>
            )}
          </>
        )}
      </div>
      {deletePanel}
    </li>
  );
}

function DeletePanel({ c, usage, others, busy, onCancel, onDelete }: {
  c: Category; usage: Usage | undefined; others: Category[]; busy: boolean; onCancel: () => void; onDelete: (moveTo: string | null) => void;
}) {
  const fallback = others.find((o) => o.name.toLowerCase() === 'other') ?? others[0];
  const [target, setTarget] = useState(fallback?.id ?? '');
  const count = usage?.expense_count ?? 0;

  let body;
  if (!usage) {
    body = <p className="small muted">Checking which expenses use it…</p>;
  } else if (others.length === 0) {
    body = <p className="small">This is the only category, so it can't be deleted. Rename it instead.</p>;
  } else if (usage.locked_count > 0) {
    body = (
      <p className="small">
        {usage.locked_count === 1 ? '1 of its expenses is in a closed month' : `${usage.locked_count} of its expenses are in closed months`},
        so it can't be deleted. Reopen {usage.locked_count === 1 ? 'that month' : 'those months'} first, or rename the category instead.
      </p>
    );
  } else if (count === 0) {
    body = (
      <>
        <p className="small">No expenses use <strong>{c.name}</strong>. Delete it?</p>
        <div className="row"><button className="btn danger sm" disabled={busy} onClick={() => onDelete(null)}>Delete</button></div>
      </>
    );
  } else {
    body = (
      <>
        <p className="small">
          {count === 1 ? '1 expense uses' : `${count} expenses use`} <strong>{c.name}</strong>.{' '}
          {count === 1 ? "It'll move to the category you pick, and its edit history will show the change."
            : "They'll move to the category you pick, and each one's edit history will show the change."}
        </p>
        <div className="row wrap">
          <label className="small" htmlFor={`move-${c.id}`}>Move to</label>
          <select id={`move-${c.id}`} className="input" style={{ width: 'auto' }} value={target} onChange={(e) => setTarget(e.target.value)}>
            {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button className="btn danger sm" disabled={busy || !target} onClick={() => onDelete(target)}>Move &amp; delete</button>
        </div>
      </>
    );
  }

  return (
    <div className="delete-panel stack" role="region" aria-label={`Delete ${c.name}`}>
      {body}
      <div><button className="btn ghost sm" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}
