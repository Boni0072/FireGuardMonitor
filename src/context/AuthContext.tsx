import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
} from 'firebase/auth';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { auth, firestore } from '@/lib/firebase';
import { Profile, isDemoAccount } from '@/lib/db';

interface AuthContextValue {
  session: { user: User } | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (uid: string): Promise<Profile | null> => {
    try {
      const snap = await getDoc(doc(firestore, 'profiles', uid));
      if (snap.exists()) {
        const p = { id: snap.id, ...(snap.data() as Omit<Profile, 'id'>) };
        setProfile(p);
        return p;
      }
      setProfile(null);
      return null;
    } catch (err) {
      console.error('Profile load error:', err);
      return null;
    }
  }, []);

  // Auto-recuperação: contas de Auth sem documento em `profiles` (ex.: criadas
  // antes desta correção ou via Console) ganham o documento automaticamente no
  // login. O primeiro usuário real do projeto vira `platform_admin`, o que
  // libera o botão "Nova Empresa" e quebra o impasse de bootstrap.
  const ensureProfileFor = useCallback(async (u: User) => {
    try {
      const ref = doc(firestore, 'profiles', u.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        setProfile({ id: snap.id, ...(snap.data() as Omit<Profile, 'id'>) });
        return;
      }
      let existing = 0;
      try {
        existing = (await getDocs(collection(firestore, 'profiles'))).size;
      } catch {
        /* segue assumindo 0 */
      }
      const now = new Date().toISOString();
      const profileData: Omit<Profile, 'id'> = {
        tenant_id: null,
        full_name: u.displayName ?? u.email?.split('@')[0] ?? 'Novo usuário',
        email: u.email ?? '',
        role: existing === 0 && !isDemoAccount(u.email) ? 'platform_admin' : 'viewer',
        phone: null,
        status: 'active',
        last_login_at: now,
        created_at: now,
      };
      await setDoc(ref, profileData);
      setProfile({ id: u.uid, ...profileData });
    } catch (err) {
      console.error('Profile ensure error:', err);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        (async () => {
          const p = await loadProfile(u.uid);
          if (!p) await ensureProfileFor(u);
          setLoading(false);
        })();
      } else {
        setProfile(null);
        setLoading(false);
      }
    });
    return () => unsub();
  }, [loadProfile, ensureProfileFor]);

  const signIn = async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      return { error: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha no login';
      return { error: msg };
    }
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const now = new Date().toISOString();
      // Bootstrap: o primeiro usuário real do projeto vira admin da plataforma
      // (necessário para liberar o botão "Nova Empresa").
      let role: 'platform_admin' | 'viewer' = 'viewer';
      try {
        const all = await getDocs(collection(firestore, 'profiles'));
        if (all.empty && !isDemoAccount(email)) role = 'platform_admin';
      } catch {
        /* mantém viewer */
      }
      const docData: Omit<Profile, 'id'> = {
        tenant_id: null,
        full_name: fullName,
        email,
        role,
        phone: null,
        status: 'active',
        last_login_at: now,
        created_at: now,
      };
      await setDoc(doc(firestore, 'profiles', cred.user.uid), docData);
      setProfile({ id: cred.user.uid, ...docData });
      return { error: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha no cadastro';
      return { error: msg };
    }
  };

  const signOut = async () => {
    await fbSignOut(auth);
    setProfile(null);
    setUser(null);
  };

  const refreshProfile = async () => {
    if (user) await loadProfile(user.uid);
  };

  return (
    <AuthContext.Provider
      value={{ session: user ? { user } : null, user, profile, loading, signIn, signUp, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
