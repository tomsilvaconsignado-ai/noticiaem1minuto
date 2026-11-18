-- ==============================================================================
-- Permissões da API (Data API) + RLS na tabela categories
--
-- Projetos Supabase criados a partir de 2026 não liberam mais as tabelas do schema
-- public para os papéis anon/authenticated automaticamente: sem estes GRANTs o
-- portal recebe "permission denied" em todas as consultas. Os GRANTs abaixo
-- reproduzem o padrão antigo; quem decide o que cada um pode ler/gravar são as
-- políticas RLS de cada tabela.
--
-- A tabela categories estava sem RLS: com os GRANTs, qualquer visitante poderia
-- alterar ou apagar categorias. Agora: leitura pública, escrita só de admins.
--
-- Pode ser executado mais de uma vez.
-- ==============================================================================

BEGIN;

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Categorias visíveis publicamente" ON public.categories;
CREATE POLICY "Categorias visíveis publicamente" ON public.categories
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Apenas administradores gerenciam categorias" ON public.categories;
CREATE POLICY "Apenas administradores gerenciam categorias" ON public.categories
  FOR ALL USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;

COMMIT;
