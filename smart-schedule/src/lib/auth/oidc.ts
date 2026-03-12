// OIDC provider abstraction — Azure AD first, provider-agnostic
export interface OIDCConfig {
  authority: string;
  clientId: string;
  redirectUri: string;
  scope: string;
}

export function getOIDCConfig(): OIDCConfig {
  return {
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_AD_TENANT_ID}/v2.0`,
    clientId: import.meta.env.VITE_AZURE_AD_CLIENT_ID as string,
    redirectUri: `${window.location.origin}/callback`,
    scope: "openid profile email",
  };
}
