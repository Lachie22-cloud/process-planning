/// <reference types="vite/client" />

declare module "xlsx/dist/cpexcel.full.mjs";

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_AZURE_AD_TENANT_ID?: string;
  readonly VITE_AZURE_AD_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
