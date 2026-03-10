import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface SpotlightState {
  active: boolean;
  batchId: string | null;
  targetResourceId: string | null;
}

interface SpotlightContextValue {
  spotlight: SpotlightState;
  /** Spotlight a batch (optional target resource). Auto-navigates to /resources. */
  spotlightBatch: (batchId: string, targetResourceId?: string | null) => void;
  /** Clear the spotlight */
  clearSpotlight: () => void;
}

const SpotlightContext = createContext<SpotlightContextValue | null>(null);

const INITIAL: SpotlightState = { active: false, batchId: null, targetResourceId: null };

export function SpotlightProvider({ children }: { children: ReactNode }) {
  const [spotlight, setSpotlight] = useState<SpotlightState>(INITIAL);

  const spotlightBatch = useCallback(
    (batchId: string, targetResourceId?: string | null) => {
      setSpotlight({ active: true, batchId, targetResourceId: targetResourceId ?? null });
    },
    [],
  );

  const clearSpotlight = useCallback(() => {
    setSpotlight(INITIAL);
  }, []);

  return (
    <SpotlightContext.Provider value={{ spotlight, spotlightBatch, clearSpotlight }}>
      {children}
    </SpotlightContext.Provider>
  );
}

export function useSpotlight() {
  const ctx = useContext(SpotlightContext);
  if (!ctx) throw new Error("useSpotlight must be used within SpotlightProvider");
  return ctx;
}
