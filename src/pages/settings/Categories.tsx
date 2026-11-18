import { useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { errorText, must } from '../../lib/api';
import { useApp } from '../../lib/session';
import type { Category } from '../../lib/types';
import { categoryColour, useToast } from '../../components/ui';

const validName = (n: string) => (n.trim() ? (n.trim().length > 40 ? 'Keep it under 40 characters.' : null) : 'Enter a name.');

export default function Categories() {
  const { household, categories, isOwner, refresh } = useApp();
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
      {error && <div className="alert error" role="alert">{error}</div>}
      <section className="card" aria-labelledby="cat-h">
        <div className="card-head"><h2 id="cat-h">Categories</h2><span className="badge">{categories.length}</span></div>
        <ul className="list">
          {categories.map((c, i) => (
            <CategoryRow key={c.id} c={c} colour={categoryColour(i)} editable={isOwner} onError={setError}
              onSaved={async () => { toast('Category renamed'); await refresh(); }} />
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
        <p className="small muted">Only the Owner can add or rename categories.</p>
      )}
    </>
  );
}

function CategoryRow({ c, colour, editable, onSaved, onError }: {
  c: Category; colour: string; editable: boolean; onSaved: () => Promise<void>; onError: (m: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(c.name);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const problem = validName(value);
    if (problem) return onError(problem);
    if (value.trim() === c.name) return setEditing(false);
    setBusy(true);
    onError(null);
    try {
      await must(supabase.from('categories').update({ name: value.trim() }).eq('id', c.id));
      setEditing(false);
      await onSaved();
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="list-item">
      <span className="swatch" style={{ width: 12, height: 12, borderRadius: 4, background: colour, flex: 'none' }} aria-hidden="true" />
      {editing ? (
        <form className="row grow" onSubmit={save}>
          <label className="sr-only" htmlFor={`cat-${c.id}`}>New name for {c.name}</label>
          <input id={`cat-${c.id}`} className="input" value={value} maxLength={40} autoFocus onChange={(e) => setValue(e.target.value)} />
          <button className="btn sm" disabled={busy}>Save</button>
          <button type="button" className="btn ghost sm" onClick={() => { setEditing(false); setValue(c.name); }}>Cancel</button>
        </form>
      ) : (
        <>
          <span className="grow truncate">{c.name}</span>
          {editable && <button className="btn ghost sm" onClick={() => setEditing(true)} aria-label={`Rename ${c.name}`}>Rename</button>}
        </>
      )}
    </li>
  );
}
