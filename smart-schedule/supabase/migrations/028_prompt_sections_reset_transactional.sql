-- 028_prompt_sections_reset_transactional.sql
-- Atomic reset of ai_prompt_sections via a single database function.
-- Replaces the application-level compensating-transaction approach with a
-- true DB transaction: DELETE + INSERT run inside one PL/pgSQL function body,
-- so if the INSERT fails the DELETE is automatically rolled back and the
-- previous sections remain intact.

CREATE OR REPLACE FUNCTION public.reset_ai_prompt_sections_transactional(
  p_site_id  UUID,
  p_sections JSONB          -- array of section objects (section_key, label, content, context, sort_order, enabled)
)
RETURNS SETOF ai_prompt_sections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Delete all existing sections for this site.
  --    If step 2 raises an exception the whole function body is rolled back,
  --    so these rows will be restored automatically.
  DELETE FROM ai_prompt_sections WHERE site_id = p_site_id;

  -- 2. Insert the supplied default sections.
  --    Any constraint violation or other error here aborts the transaction,
  --    which also undoes the DELETE above.
  INSERT INTO ai_prompt_sections (
    site_id,
    section_key,
    label,
    content,
    context,
    sort_order,
    enabled
  )
  SELECT
    p_site_id,
    (elem ->> 'section_key')::TEXT,
    (elem ->> 'label')::TEXT,
    COALESCE(elem ->> 'content', ''),
    COALESCE(elem ->> 'context', 'both'),
    (elem ->> 'sort_order')::INTEGER,
    COALESCE((elem ->> 'enabled')::BOOLEAN, TRUE)
  FROM jsonb_array_elements(p_sections) AS elem;

  -- 3. Return the freshly-inserted rows ordered by sort_order.
  RETURN QUERY
    SELECT *
    FROM   ai_prompt_sections
    WHERE  site_id = p_site_id
    ORDER  BY sort_order ASC;
END;
$$;

-- Grant execute to the service role used by the AI agent backend.
GRANT EXECUTE ON FUNCTION public.reset_ai_prompt_sections_transactional(UUID, JSONB)
  TO service_role;
