import { resolveAuthSubject, useAuthContext } from "@/providers/auth-provider";

export function useAuth() {
  const { session, loading, isDevAuth, signIn, signInWithEmail, signOut } =
    useAuthContext();
  const authSubject = resolveAuthSubject(session);

  return {
    session,
    authSubject,
    isAuthenticated: !!session,
    loading,
    isDevAuth,
    signIn,
    signInWithEmail,
    signOut,
  };
}
