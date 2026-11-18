import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { must } from './api';
import type { Category, Household, Member, Profile, Role } from './types';

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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  const refresh = useCallback(async () => {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [userId]);

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
      nameOf: (id) => (id ? names.get(id) ?? 'Former member' : 'Scheduled job'),
      refresh,
    };
  }, [authReady, loading, error, session, profile, household, role, members, categories, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Owner/Member rows that are currently active — the people who can be "Paid by". */
export const activePayers = (members: Member[]) =>
  members.filter((m) => !m.removed_at && (m.role === 'owner' || m.role === 'member'));
