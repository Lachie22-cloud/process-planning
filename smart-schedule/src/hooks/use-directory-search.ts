import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";

export interface DirectoryUser {
  id: string;
  displayName: string | null;
  givenName: string | null;
  surname: string | null;
  mail: string | null;
  userPrincipalName: string;
  mailNickname: string | null;
}

export function useDirectorySearch(input: string) {
  const [debouncedTerm, setDebouncedTerm] = useState(input);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(input), 300);
    return () => clearTimeout(timer);
  }, [input]);

  const enabled = debouncedTerm.length >= 2;

  return useQuery<DirectoryUser[]>({
    queryKey: ["directory_search", debouncedTerm],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_directory_users", {
        search_term: debouncedTerm,
      });
      if (error) throw error;
      return (data as DirectoryUser[]) ?? [];
    },
    enabled,
    staleTime: 30_000,
  });
}
