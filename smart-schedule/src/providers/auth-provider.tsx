import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import type { Session, AuthChangeEvent } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
});

const IS_E2E_MOCK_AUTH = import.meta.env.VITE_E2E_MOCK_AUTH === "true";

function buildMockSession(): Session {
  const expiresIn = 60 * 60;
  const now = Math.floor(Date.now() / 1000);

  return {
    access_token: "e2e-access-token",
    refresh_token: "e2e-refresh-token",
    token_type: "bearer",
    expires_in: expiresIn,
    expires_at: now + expiresIn,
    user: {
      id: "00000000-0000-4000-8000-000000000999",
      app_metadata: { provider: "oidc" },
      user_metadata: {},
      aud: "authenticated",
      role: "authenticated",
      email: "site-admin@example.com",
      created_at: new Date().toISOString(),
    },
  } as Session;
}

export function resolveAuthSubject(session: Session | null): string | null {
  if (!session?.user) return null;
  return (
    session.user.id ??
    (typeof session.user.user_metadata?.sub === "string"
      ? session.user.user_metadata.sub
      : null) ??
    (typeof session.user.app_metadata?.sub === "string"
      ? session.user.app_metadata.sub
      : null)
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (IS_E2E_MOCK_AUTH) {
      setSession(buildMockSession());
      setLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setLoading(false);
    });

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, s: Session | null) => {
        setSession(s);
        setLoading(false);
      },
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async () => {
    if (IS_E2E_MOCK_AUTH) {
      setSession(buildMockSession());
      return;
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        scopes: "openid profile email User.Read",
        redirectTo: `${window.location.origin}/callback`,
      },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (IS_E2E_MOCK_AUTH) {
      setSession(null);
      return;
    }

    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  return useContext(AuthContext);
}
