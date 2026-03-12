import { resolveAuthSubject, useAuthContext } from "@/providers/auth-provider";

export function useAuth() {
  const { session, loading, signIn, signOut } = useAuthContext();
  const authSubject = resolveAuthSubject(session);

  return {
    session,
    authSubject,
    isAuthenticated: !!session,
    loading,
    signIn,
    signOut,
  };
}
