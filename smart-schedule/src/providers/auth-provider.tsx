import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import type { ReactNode } from "react";
import type { Session, AuthChangeEvent } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  isDevAuth: boolean;
  signIn: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  loading: true,
  isDevAuth: false,
  signIn: async () => {},
  signInWithEmail: async () => {},
  signOut: async () => {},
});

const IS_E2E_MOCK_AUTH = import.meta.env.VITE_E2E_MOCK_AUTH === "true";
const IS_DEV_AUTH = import.meta.env.VITE_SUPABASE_URL === "__SELF__";
const DEV_AUTO_LOGIN = import.meta.env.VITE_DEV_AUTO_LOGIN === "true";
const DEV_USER_EMAIL = import.meta.env.VITE_DEV_USER_EMAIL as string | undefined;
const DEV_USER_PASSWORD = import.meta.env.VITE_DEV_USER_PASSWORD as string | undefined;

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
  const attemptedDevAutoLogin = useRef(false);

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

  useEffect(() => {
    if (!IS_DEV_AUTH || !DEV_AUTO_LOGIN || !DEV_USER_EMAIL || !DEV_USER_PASSWORD) {
      return;
    }

    if (loading || session || attemptedDevAutoLogin.current) {
      return;
    }

    let cancelled = false;
    const devEmail = DEV_USER_EMAIL;
    const devPassword = DEV_USER_PASSWORD;

    async function autoSignIn() {
      attemptedDevAutoLogin.current = true;
      setLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({
        email: devEmail,
        password: devPassword,
      });

      if (cancelled) {
        return;
      }

      if (error) {
        console.error("Dev auto sign-in failed:", error);
        setLoading(false);
        return;
      }

      setSession(data.session);
      setLoading(false);
    }

    void autoSignIn();

    return () => {
      cancelled = true;
    };
  }, [loading, session]);

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

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
    },
    [],
  );

  const signOut = useCallback(async () => {
    if (IS_E2E_MOCK_AUTH) {
      setSession(null);
      return;
    }

    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  return (
    <AuthContext.Provider
      value={{ session, loading, isDevAuth: IS_DEV_AUTH, signIn, signInWithEmail, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  return useContext(AuthContext);
}
