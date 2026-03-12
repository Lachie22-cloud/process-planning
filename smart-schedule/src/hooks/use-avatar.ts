import { useEffect, useState } from "react";
import { useAuth } from "./use-auth";

const AVATAR_CACHE_PREFIX = "avatar_";

function getCachedAvatar(userId: string): string | null {
  try {
    return localStorage.getItem(`${AVATAR_CACHE_PREFIX}${userId}`);
  } catch {
    return null;
  }
}

function setCachedAvatar(userId: string, dataUrl: string) {
  try {
    localStorage.setItem(`${AVATAR_CACHE_PREFIX}${userId}`, dataUrl);
  } catch {
    // localStorage full or unavailable — ignore
  }
}

export function useAvatar(): string | null {
  const { session } = useAuth();
  const userId = session?.user?.id;
  const providerToken = session?.provider_token;

  const [avatarUrl, setAvatarUrl] = useState<string | null>(() =>
    userId ? getCachedAvatar(userId) : null,
  );

  useEffect(() => {
    if (!userId) return;

    // If we already have a cached avatar, use it
    const cached = getCachedAvatar(userId);
    if (cached) {
      setAvatarUrl(cached);
      return;
    }

    // provider_token is only available on initial sign-in, not session restore
    if (!providerToken) return;

    let cancelled = false;

    async function fetchPhoto() {
      try {
        const res = await fetch(
          "https://graph.microsoft.com/v1.0/me/photo/$value",
          {
            headers: { Authorization: `Bearer ${providerToken}` },
          },
        );

        if (!res.ok) return; // No photo set or permission denied — fall back to initials

        const blob = await res.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
          if (cancelled) return;
          const dataUrl = reader.result as string;
          setCachedAvatar(userId!, dataUrl);
          setAvatarUrl(dataUrl);
        };
        reader.readAsDataURL(blob);
      } catch {
        // Network error — fall back to initials
      }
    }

    fetchPhoto();

    return () => {
      cancelled = true;
    };
  }, [userId, providerToken]);

  return avatarUrl;
}
