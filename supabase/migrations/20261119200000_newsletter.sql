-- ==============================================================================
-- Newsletter diária
--
-- Inscrição com confirmação por e-mail (dupla confirmação, exigida pela LGPD) e envio
-- diário automático das notícias das últimas 24 horas, pela Edge Function "newsletter".
--
-- Fluxo:
--   1. O site chama a função (acao=inscrever). Ela grava o e-mail como "pendente" e
--      envia o link de confirmação.
--   2. O link confirma a inscrição (status "ativo").
--   3. Todo dia às 07h (Itabaiana), o pg_cron chama a função (acao=enviar), que manda
--      o resumo para os inscritos ativos. Todo e-mail tem o link para cancelar.
--
-- Pré-requisito do agendamento: o segredo 'newsletter_cron_secret' no Vault, com o mesmo
-- valor do segredo NEWSLETTER_CRON_SECRET da função.
-- Pode ser executado mais de uma vez.
-- ==============================================================================

BEGIN;

ALTER TABLE public.newsletter_subscribers
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS token UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS confirmado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmacao_enviada_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ultimo_envio_em TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE public.newsletter_subscribers
    ADD CONSTRAINT newsletter_subscribers_status_check CHECK (status IN ('pendente', 'ativo', 'cancelado'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_token_idx ON public.newsletter_subscribers (token);

-- A inscrição agora passa pela função (que envia a confirmação); o site não grava direto
DROP POLICY IF EXISTS "Qualquer pessoa pode se inscrever na newsletter" ON public.newsletter_subscribers;
REVOKE INSERT, UPDATE, DELETE ON public.newsletter_subscribers FROM anon;

-- Registro de cada envio diário (para conferência no painel/SQL)
CREATE TABLE IF NOT EXISTS public.newsletter_envios (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enviado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  materias INTEGER NOT NULL DEFAULT 0,
  destinatarios INTEGER NOT NULL DEFAULT 0,
  enviados INTEGER NOT NULL DEFAULT 0,
  falhas INTEGER NOT NULL DEFAULT 0,
  observacao TEXT
);
ALTER TABLE public.newsletter_envios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Administradores veem envios da newsletter" ON public.newsletter_envios;
CREATE POLICY "Administradores veem envios da newsletter" ON public.newsletter_envios
  FOR SELECT USING ((SELECT public.is_admin()));
REVOKE INSERT, UPDATE, DELETE ON public.newsletter_envios FROM anon, authenticated;

COMMIT;

-- Agendamento diário (fora da transação: CREATE EXTENSION de pg_cron)
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.disparar_newsletter_diaria()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  segredo TEXT;
BEGIN
  SELECT decrypted_secret INTO segredo FROM vault.decrypted_secrets WHERE name = 'newsletter_cron_secret' LIMIT 1;
  IF coalesce(segredo, '') = '' THEN
    RAISE WARNING 'newsletter: segredo newsletter_cron_secret ausente no Vault';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := 'https://aqregftcnkypoovawlmz.supabase.co/functions/v1/newsletter',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-newsletter-secret', segredo),
    body := jsonb_build_object('acao', 'enviar'),
    timeout_milliseconds := 120000
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.disparar_newsletter_diaria() FROM PUBLIC, anon, authenticated;

-- Lotes de até 80 e-mails a cada 10 minutos entre 10:00 e 11:50 UTC (07:00–08:50 em Itabaiana, UTC-3).
-- Cada lote só pega quem ainda não recebeu o resumo do dia; o Gmail aceita ~500 envios por dia.
SELECT cron.unschedule('newsletter-diaria') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'newsletter-diaria');
SELECT cron.schedule('newsletter-diaria', '*/10 10-11 * * *', 'SELECT public.disparar_newsletter_diaria();');
