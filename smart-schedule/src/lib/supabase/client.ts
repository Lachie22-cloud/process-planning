import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// In the dev container, VITE_SUPABASE_URL is "__SELF__" meaning "use current origin".
// nginx on the same host proxies /rest/v1, /auth/v1, etc. to the backend services.
// Behind a reverse proxy (e.g. /preview/project/dev/), we must include the base path
// so that Supabase client requests route through the container's nginx, not the host.
const rawUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseUrl =
  rawUrl === "__SELF__"
    ? `${window.location.origin}${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}`
    : rawUrl;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);
