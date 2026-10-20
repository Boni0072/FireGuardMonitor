import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, firestore } from '@/lib/firebase';
import { Profile } from '@/lib/db';

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

  const loadProfile = useCallback(async (uid: string) => {
    try {
      const snap = await getDoc(doc(firestore, 'profiles', uid));
      if (snap.exists()) {
        setProfile({ id: snap.id, ...(snap.data() as Omit<Profile, 'id'>) });
      } else {
        setProfile(null);
      }
    } catch (err) {
      console.error('Profile load error:', err);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        loadProfile(u.uid).finally(() => setLoading(false));
      } else {
        setProfile(null);
        setLoading(false);
      }
    });
    return () => unsub();
  }, [loadProfile]);

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
      const docData: Omit<Profile, 'id'> = {
        tenant_id: null,
        full_name: fullName,
        email,
        role: 'viewer',
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
