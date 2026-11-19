import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { must } from './api';
import type { Category, Household, Member, Profile, Role } from './types';
import { isStale } from './members';

interface AppState {
  loading: boolean;
  error: string | null;
  session: Session | null;
  profile: Profile | null;
  household: Household | null;
  role: Role | null;
  members: Member[];
  categories: Category[];
  canWrite: boolean;
  isOwner: boolean;
  nameOf: (userId: string | null | undefined) => string;
  refresh: () => Promise<void>;
  /** Reloads household, people and categories unless they were loaded in the last few seconds. */
  revalidate: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const loadedAt = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  const load = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      setHousehold(null);
      setRole(null);
      setMembers([]);
      setCategories([]);
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const [p, mine] = await Promise.all([
        must(supabase.from('profiles').select('id, email, display_name').eq('id', userId).maybeSingle()),
        must(supabase.from('household_members').select('household_id, role').eq('user_id', userId).is('removed_at', null).maybeSingle()),
      ]);
      setProfile(p as unknown as Profile | null);
      if (!mine) {
        setHousehold(null);
        setRole(null);
        setMembers([]);
        setCategories([]);
        return;
      }
      const hid = (mine as { household_id: string }).household_id;
      const [h, ms, cs] = await Promise.all([
        must(supabase.from('households').select('id, name, created_at').eq('id', hid).single()),
        must(supabase
          .from('household_members')
          .select('id, user_id, role, joined_at, removed_at, profile:profiles(display_name, email)')
          .eq('household_id', hid)
          .order('joined_at')),
        must(supabase.from('categories').select('id, name, sort_order').eq('household_id', hid).order('sort_order').order('name')),
      ]);
      setHousehold(h as unknown as Household);
      setRole((mine as { role: Role }).role);
      setMembers(ms as unknown as Member[]);
      setCategories(cs as Category[]);
      loadedAt.current = Date.now();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // An explicit refresh (after joining, a role change…) always loads, so it never returns an older result.
  const refresh = useCallback(() => {
    const p = load().finally(() => { if (inFlight.current === p) inFlight.current = null; });
    inFlight.current = p;
    return p;
  }, [load]);

  // The people list must stay current: someone can join while this tab is open (or the app sits on a
  // phone's home screen for days), and "Paid by", the filters and Access all read from it. Background
  // checks skip if a load is already running or the data is only a few seconds old.
  const revalidate = useCallback(() => {
    if (userId && !inFlight.current && isStale(loadedAt.current, Date.now())) void refresh();
  }, [userId, refresh]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') revalidate(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', revalidate);
    window.addEventListener('online', revalidate);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', revalidate);
      window.removeEventListener('online', revalidate);
    };
  }, [revalidate]);

  useEffect(() => {
    if (!authReady) return;
    setLoading(true);
    void refresh();
  }, [authReady, refresh]);

  const value = useMemo<AppState>(() => {
    const names = new Map(members.map((m) => [m.user_id, m.profile?.display_name ?? 'Unknown']));
    if (profile) names.set(profile.id, profile.display_name);
    return {
      loading: !authReady || loading,
      error,
      session,
      profile,
      household,
      role,
      members,
      categories,
      canWrite: role === 'owner' || role === 'member',
      isOwner: role === 'owner',
      nameOf: (id) => (id ? names.get(id) ?? 'Former member' : 'Unknown'),
      refresh,
      revalidate,
    };
  }, [authReady, loading, error, session, profile, household, role, members, categories, refresh, revalidate]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { activePayers } from './members';
