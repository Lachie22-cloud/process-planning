-- Migration 021: Change credential_encrypted from BYTEA to TEXT
--
-- The ai-agent encrypts credentials using Node's AES-256-GCM and stores
-- the result as a base64 string. PostgREST applies hex encoding to BYTEA
-- columns, causing a format mismatch on read. TEXT avoids this.
--
-- Also updates the unused pgcrypto-based helper functions to match.

ALTER TABLE ai_config
  ALTER COLUMN credential_encrypted TYPE TEXT
  USING convert_from(credential_encrypted, 'UTF8');

-- Update the decrypt helper to accept TEXT instead of BYTEA
CREATE OR REPLACE FUNCTION public.decrypt_ai_credential(
  p_encrypted TEXT,
  p_key TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN pgp_sym_decrypt(decode(p_encrypted, 'base64'), p_key);
END;
$$;

-- Update the encrypt helper to return TEXT
CREATE OR REPLACE FUNCTION public.encrypt_ai_credential(
  p_plaintext TEXT,
  p_key TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN encode(pgp_sym_encrypt(p_plaintext, p_key), 'base64');
END;
$$;

-- Revoke/grant for updated signatures
REVOKE EXECUTE ON FUNCTION public.encrypt_ai_credential(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decrypt_ai_credential(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encrypt_ai_credential(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.decrypt_ai_credential(TEXT, TEXT) TO service_role;
