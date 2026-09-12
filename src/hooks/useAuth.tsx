import { useState, useEffect, createContext, useContext, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import { withServerRetry } from "@/lib/server-request";

interface Profile {
  approved: boolean;
  role: string;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  serverUnreachable: boolean;
  retryServerCheck: () => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadProfile(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("approved, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [serverUnreachable, setServerUnreachable] = useState(false);
  const [sessionRetryTick, setSessionRetryTick] = useState(0);

  useEffect(() => {
    let mounted = true;

    const applySession = (nextSession: Session | null) => {
      if (!mounted) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setAuthLoading(false);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setServerUnreachable(false);
      applySession(nextSession);
    });

    withServerRetry(() => supabase.auth.getSession(), { timeoutMs: 12_000, retries: 2 })
      .then(({ data: { session: currentSession } }) => {
        if (mounted) setServerUnreachable(false);
        applySession(currentSession);
      })
      .catch((error) => {
        console.error("Failed to restore session:", error);
        if (mounted) {
          setServerUnreachable(true);
          setAuthLoading(false);
        }
      });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [sessionRetryTick]);

  useEffect(() => {
    let cancelled = false;

    const fetchProfile = async () => {
      if (!user) {
        setProfile(null);
        setProfileLoading(false);
        return;
      }

      setProfileLoading(true);

      try {
        const data = await withServerRetry(() => loadProfile(user.id), { timeoutMs: 12_000, retries: 2 });
        if (!cancelled) {
          setProfile(data);
          setServerUnreachable(false);
        }
      } catch (error) {
        console.error("Failed to fetch profile:", error);
        if (!cancelled) {
          setProfile(null);
          setServerUnreachable(true);
        }
      } finally {
        if (!cancelled) {
          setProfileLoading(false);
        }
      }
    };

    void fetchProfile();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshProfile = async () => {
    if (!user) return;

    setProfileLoading(true);
    try {
      const data = await loadProfile(user.id);
      setProfile(data);
    } catch (error) {
      console.error("Failed to refresh profile:", error);
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  };

  const loading = authLoading || profileLoading;
  const isAdmin = profile?.role === "admin" && profile?.approved === true;

  const retryServerCheck = () => {
    setServerUnreachable(false);
    setAuthLoading(true);
    setSessionRetryTick((tick) => tick + 1);
  };

  return (
    <AuthContext.Provider
      value={{ user, session, profile, loading, isAdmin, serverUnreachable, retryServerCheck, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

