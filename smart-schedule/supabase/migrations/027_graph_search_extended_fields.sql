-- 027_graph_search_extended_fields.sql
-- Extend search_directory_users to return givenName, surname, and mailNickname
-- in addition to the existing id, displayName, mail, userPrincipalName fields.
-- This allows the invite form to build a full display name from givenName+surname
-- when Azure AD's displayName is incomplete, and to surface the user's alias.

CREATE OR REPLACE FUNCTION search_directory_users(search_term text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  tenant_id   text;
  client_id   text;
  client_sec  text;
  token_resp  http_response;
  token_body  jsonb;
  access_tok  text;
  graph_resp  http_response;
  graph_body  jsonb;
  filter_str  text;
BEGIN
  -- Only allow authenticated users
  IF current_setting('request.jwt.claims', true)::jsonb ->> 'role' IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Read Azure credentials from environment (set via docker-compose)
  tenant_id  := current_setting('app.azure_tenant_id', true);
  client_id  := current_setting('app.azure_client_id', true);
  client_sec := current_setting('app.azure_client_secret', true);

  IF tenant_id IS NULL OR client_id IS NULL OR client_sec IS NULL THEN
    RAISE EXCEPTION 'Azure AD credentials not configured';
  END IF;

  -- 1. Get access token via client credentials flow
  SELECT * INTO token_resp FROM http_post(
    'https://login.microsoftonline.com/' || tenant_id || '/oauth2/v2.0/token',
    'grant_type=client_credentials'
      || '&client_id=' || urlencode(client_id)
      || '&client_secret=' || urlencode(client_sec)
      || '&scope=' || urlencode('https://graph.microsoft.com/.default'),
    'application/x-www-form-urlencoded'
  );

  IF token_resp.status != 200 THEN
    RAISE EXCEPTION 'Failed to obtain Azure AD token: %', token_resp.content;
  END IF;

  token_body := token_resp.content::jsonb;
  access_tok := token_body ->> 'access_token';

  -- 2. Search users via Graph API
  filter_str := 'startsWith(displayName,''' || replace(search_term, '''', '''''') || ''')'
             || ' or startsWith(mail,''' || replace(search_term, '''', '''''') || ''')'
             || ' or startsWith(userPrincipalName,''' || replace(search_term, '''', '''''') || ''')';

  SELECT * INTO graph_resp FROM http((
    'GET',
    'https://graph.microsoft.com/v1.0/users?$filter=' || urlencode(filter_str)
      || '&$select=id,displayName,givenName,surname,mail,userPrincipalName,mailNickname&$top=10',
    ARRAY[http_header('Authorization', 'Bearer ' || access_tok)],
    NULL,
    NULL
  )::http_request);

  IF graph_resp.status != 200 THEN
    RAISE EXCEPTION 'Graph API error: %', graph_resp.content;
  END IF;

  graph_body := graph_resp.content::jsonb;

  RETURN COALESCE(graph_body -> 'value', '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION search_directory_users(text) TO authenticated;
