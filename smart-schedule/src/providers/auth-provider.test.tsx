import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { AuthProvider, resolveAuthSubject, useAuthContext } from "./auth-provider";

const {
  getSessionMock,
  onAuthStateChangeMock,
  signInWithOAuthMock,
  signOutMock,
  unsubscribeMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  onAuthStateChangeMock: vi.fn(),
  signInWithOAuthMock: vi.fn(),
  signOutMock: vi.fn(),
  unsubscribeMock: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
      onAuthStateChange: onAuthStateChangeMock,
      signInWithOAuth: signInWithOAuthMock,
      signOut: signOutMock,
    },
  },
}));

function Consumer() {
  const { session, loading, signIn, signOut } = useAuthContext();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="session">{session?.user?.id ?? "none"}</span>
      <button onClick={() => signIn()}>SignIn</button>
      <button onClick={() => signOut()}>SignOut</button>
    </div>
  );
}

function renderProvider(ui: ReactNode) {
  return render(<AuthProvider>{ui}</AuthProvider>);
}

describe("resolveAuthSubject", () => {
  it("prefers session user id", () => {
    expect(resolveAuthSubject({ user: { id: "user-1" } } as never)).toBe("user-1");
  });

  it("falls back to user_metadata.sub then app_metadata.sub", () => {
    expect(
      resolveAuthSubject({ user: { id: null, user_metadata: { sub: "um-sub" }, app_metadata: {} } } as never),
    ).toBe("um-sub");
    expect(
      resolveAuthSubject({ user: { id: null, user_metadata: {}, app_metadata: { sub: "am-sub" } } } as never),
    ).toBe("am-sub");
  });
});

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "session-user", email: "a@b.com" } } },
    });
    onAuthStateChangeMock.mockImplementation((cb: (event: string, session: unknown) => void) => {
      cb("SIGNED_IN", { user: { id: "event-user", email: "e@x.com" } });
      return { data: { subscription: { unsubscribe: unsubscribeMock } } };
    });
    signInWithOAuthMock.mockResolvedValue({ error: null });
    signOutMock.mockResolvedValue({ error: null });
  });

  it("loads initial session and registers auth state change listener", async () => {
    renderProvider(<Consumer />);

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });

    expect(getSessionMock).toHaveBeenCalledTimes(1);
    expect(onAuthStateChangeMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("session")).toHaveTextContent("session-user");
  });

  it("calls supabase oauth and sign out actions", async () => {
    renderProvider(<Consumer />);

    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });

    fireEvent.click(screen.getByText("SignIn"));
    fireEvent.click(screen.getByText("SignOut"));

    await waitFor(() => {
      expect(signInWithOAuthMock).toHaveBeenCalledWith({
        provider: "azure",
        options: {
          scopes: "openid profile email User.Read",
          redirectTo: `${window.location.origin}/callback`,
        },
      });
      expect(signOutMock).toHaveBeenCalledTimes(1);
    });
  });
});
