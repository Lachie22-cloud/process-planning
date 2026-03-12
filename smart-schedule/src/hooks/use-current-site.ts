import { useSiteContext } from "@/providers/site-provider";

export function useCurrentSite() {
  const { currentSite, currentUser, sites, loading, error, switchSite } =
    useSiteContext();

  return {
    site: currentSite,
    user: currentUser,
    sites,
    loading,
    error,
    switchSite,
  };
}
