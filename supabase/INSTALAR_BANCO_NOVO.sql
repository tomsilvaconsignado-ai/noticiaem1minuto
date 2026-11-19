-- ==============================================================================
-- INSTALAÇÃO COMPLETA DO BANCO (banco novo e vazio) - Notícia em 1 Minuto
-- Supabase -> SQL Editor -> New query -> cole este arquivo inteiro -> Run.
-- Contém: schema.sql + todas as migrações em supabase/migrations, em ordem.
-- Para banco que JÁ tem as tabelas, use ATUALIZAR_BANCO.sql.
-- ==============================================================================

-- >>>>>>>>>> schema.sql
-- ==============================================================================
-- SCHEMA COMPLETO DO BANCO DE DADOS - NOTÍCIA EM 1 MINUTO ONLINE (SUPABASE / POSTGRESQL)
-- Para executar: Abra seu projeto no Supabase -> Menu SQL Editor -> Cole este código -> Run
-- ==============================================================================

-- 1. Habilitar extensão de UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Tabela de Perfis de Usuários (Integrada com Supabase Auth e Categorias de Interesse)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT DEFAULT 'reader' CHECK (role IN ('admin', 'editor', 'reader')),
  avatar_url TEXT,
  interests TEXT[] DEFAULT ARRAY['Política', 'Cidades'], -- Categorias de interesse para notificações
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'blocked')),
  account_type TEXT DEFAULT 'pf' CHECK (account_type IN ('pf', 'pj')),
  phone TEXT,
  city TEXT,
  state TEXT DEFAULT 'SE',
  cpf TEXT,
  cnpj TEXT,
  company_name TEXT,
  trade_name TEXT,
  legal_representative TEXT,
  representative_cpf TEXT,
  terms_accepted BOOLEAN DEFAULT true,
  terms_accepted_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  terms_version TEXT DEFAULT 'v2.1',
  moderation_reason TEXT,
  moderation_at TIMESTAMP WITH TIME ZONE,
  moderated_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Funções de verificação de papel com SECURITY DEFINER (evitam recursão infinita no RLS)
-- search_path vazio, só usuários ativos, EXECUTE apenas para authenticated
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid()) AND role = 'admin' AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_editor_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid()) AND role IN ('admin', 'editor') AND status = 'active'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_editor_or_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_editor_or_admin() TO authenticated, service_role;

-- Habilitar RLS para profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Perfis: leitura só do próprio dono e de admins (contêm e-mail, telefone, CPF/CNPJ)
DROP POLICY IF EXISTS "Perfis visíveis publicamente" ON public.profiles;
DROP POLICY IF EXISTS "Usuários veem o próprio perfil" ON public.profiles;
CREATE POLICY "Usuários veem o próprio perfil"
  ON public.profiles FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = id OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "Usuários podem criar seus próprios perfis" ON public.profiles;
CREATE POLICY "Usuários podem criar seus próprios perfis"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Usuários podem atualizar seus próprios dados de perfil" ON public.profiles;
CREATE POLICY "Usuários podem atualizar seus próprios dados de perfil"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Administradores gerenciam todos os perfis" ON public.profiles;
CREATE POLICY "Administradores gerenciam todos os perfis"
  ON public.profiles FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- Campos privilegiados só podem ser definidos por admin, service_role ou pelo
-- próprio banco (trigger de cadastro / SQL Editor). Para os demais, os valores
-- são preservados silenciosamente (não quebra o upsert do cadastro no app).
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.role := 'reader';
    NEW.status := 'active';
    NEW.moderation_reason := NULL;
    NEW.moderation_at := NULL;
    NEW.moderated_by := NULL;
  ELSE
    NEW.id := OLD.id;
    NEW.email := OLD.email;
    NEW.role := OLD.role;
    NEW.status := OLD.status;
    NEW.moderation_reason := OLD.moderation_reason;
    NEW.moderation_at := OLD.moderation_at;
    NEW.moderated_by := OLD.moderated_by;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_profile_privileged_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_profile_privileged_fields ON public.profiles;
CREATE TRIGGER protect_profile_privileged_fields
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileged_fields();

-- 3. Tabela de Categorias de Notícias
CREATE TABLE IF NOT EXISTS public.categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Inserir categorias padrão
INSERT INTO public.categories (id, name, slug) VALUES
  ('cat-1', 'Artigo', 'artigo'),
  ('cat-2', 'Brasil', 'brasil'),
  ('cat-3', 'Cidades', 'cidades'),
  ('cat-4', 'Esporte', 'esporte'),
  ('cat-5', 'Eventos', 'eventos'),
  ('cat-6', 'Polícia', 'policia'),
  ('cat-7', 'Política', 'politica'),
  ('cat-8', 'Vídeos', 'videos'),
  ('cat-9', 'Classificados', 'classificados')
ON CONFLICT (slug) DO NOTHING;

-- 4. Tabela de Notícias (Articles)
CREATE TABLE IF NOT EXISTS public.articles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title TEXT NOT NULL,
  subtitle TEXT,
  slug TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  image_url TEXT NOT NULL,
  video_url TEXT,
  is_video BOOLEAN DEFAULT false,
  is_hero BOOLEAN DEFAULT false,
  is_secondary BOOLEAN DEFAULT false,
  views_count INTEGER DEFAULT 0,
  author TEXT DEFAULT 'Redação Notícia em 1 Minuto',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_articles_slug ON public.articles(slug);
CREATE INDEX IF NOT EXISTS idx_articles_category ON public.articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_created_at ON public.articles(created_at DESC);

-- Habilitar RLS para Notícias
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Notícias são públicas para leitura" ON public.articles;
CREATE POLICY "Notícias são públicas para leitura"
  ON public.articles FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Apenas editores e admins podem inserir/modificar notícias" ON public.articles;
CREATE POLICY "Apenas editores e admins podem inserir/modificar notícias"
  ON public.articles FOR ALL
  TO authenticated
  USING ((SELECT public.is_editor_or_admin()))
  WITH CHECK ((SELECT public.is_editor_or_admin()));

-- 5. Tabela de Publicidade (Ads)
CREATE TABLE IF NOT EXISTS public.ads (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title TEXT NOT NULL,
  sponsor_name TEXT NOT NULL,
  link_url TEXT NOT NULL,
  media_url TEXT NOT NULL,
  media_type TEXT CHECK (media_type IN ('image', 'video', 'gif')),
  placement TEXT CHECK (placement IN ('header', 'sidebar', 'feed')),
  aspect_ratio TEXT DEFAULT '1 / 1',
  max_width INTEGER,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anúncios visíveis publicamente" ON public.ads;
CREATE POLICY "Anúncios visíveis publicamente"
  ON public.ads FOR SELECT
  TO anon, authenticated
  USING (active = true);

DROP POLICY IF EXISTS "Apenas administradores gerenciam anúncios" ON public.ads;
CREATE POLICY "Apenas administradores gerenciam anúncios"
  ON public.ads FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- 6. Tabela de Notificações para Usuários Logados
CREATE TABLE IF NOT EXISTS public.notifications (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  article_id TEXT REFERENCES public.articles(id) ON DELETE CASCADE,
  article_slug TEXT NOT NULL,
  article_title TEXT NOT NULL,
  category TEXT NOT NULL,
  image_url TEXT,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications(read);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuários podem ver suas próprias notificações" ON public.notifications;
CREATE POLICY "Usuários podem ver suas próprias notificações"
  ON public.notifications FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Usuários podem atualizar status de leitura das suas notificações" ON public.notifications;
CREATE POLICY "Usuários podem atualizar status de leitura das suas notificações"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Editores e admins criam notificações" ON public.notifications;
CREATE POLICY "Editores e admins criam notificações"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.is_editor_or_admin()));

-- 7. ===========================================================================
-- MÓDULO CLASSIFICADOS (TABELAS, RLS E TRIGGERS)
-- ==============================================================================

-- Tabela de Configurações dos Classificados
CREATE TABLE IF NOT EXISTS public.classified_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  require_approval BOOLEAN DEFAULT true,
  default_validity_days INTEGER DEFAULT 30,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

INSERT INTO public.classified_settings (id, require_approval, default_validity_days)
VALUES ('default', true, 30)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.classified_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Configurações de classificados públicas para leitura" ON public.classified_settings;
CREATE POLICY "Configurações de classificados públicas para leitura"
  ON public.classified_settings FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Apenas admins alteram configurações de classificados" ON public.classified_settings;
CREATE POLICY "Apenas admins alteram configurações de classificados"
  ON public.classified_settings FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));


-- Tabela de Categorias de Classificados
CREATE TABLE IF NOT EXISTS public.classified_categories (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  section TEXT NOT NULL CHECK (section IN ('produtos_servicos', 'vagas_emprego', 'procuro_emprego')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.classified_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Categorias de classificados públicas" ON public.classified_categories;
CREATE POLICY "Categorias de classificados públicas"
  ON public.classified_categories FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Apenas admins gerenciam categorias de classificados" ON public.classified_categories;
CREATE POLICY "Apenas admins gerenciam categorias de classificados"
  ON public.classified_categories FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- Tabela de Classificados (Anúncios)
CREATE TABLE IF NOT EXISTS public.classifieds (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  code TEXT UNIQUE NOT NULL, -- Ex: CL-4019
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  section TEXT NOT NULL CHECK (section IN ('produtos_servicos', 'vagas_emprego', 'procuro_emprego')),
  type TEXT NOT NULL CHECK (type IN ('vendo', 'compro', 'alugo', 'ofereco_servico', 'ofereco_vaga', 'procuro_emprego')),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL,
  price_type TEXT DEFAULT 'fixed' CHECK (price_type IN ('fixed', 'free', 'negotiable')),
  price NUMERIC(12, 2),
  city TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'SE',
  advertiser_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  images TEXT[] DEFAULT ARRAY[]::TEXT[], -- Máximo 3 imagens
  -- Campos de Emprego
  job_role TEXT,
  job_area TEXT,
  contract_type TEXT,
  workload TEXT,
  experience TEXT,
  requirements TEXT,
  -- Moderação e Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected', 'paused', 'expired')),
  rejection_reason TEXT,
  views_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_classifieds_slug ON public.classifieds(slug);
CREATE INDEX IF NOT EXISTS idx_classifieds_section ON public.classifieds(section);
CREATE INDEX IF NOT EXISTS idx_classifieds_status ON public.classifieds(status);
CREATE INDEX IF NOT EXISTS idx_classifieds_expires_at ON public.classifieds(expires_at);

ALTER TABLE public.classifieds ENABLE ROW LEVEL SECURITY;

-- Regras de Segurança RLS
CREATE INDEX IF NOT EXISTS idx_classifieds_user_id ON public.classifieds(user_id);

DROP POLICY IF EXISTS "Anúncios publicados e não expirados são visíveis publicamente" ON public.classifieds;
CREATE POLICY "Anúncios publicados e não expirados são visíveis publicamente"
  ON public.classifieds FOR SELECT
  TO anon, authenticated
  USING (status = 'published' AND expires_at > now());

DROP POLICY IF EXISTS "Donos e equipe veem todos os anúncios" ON public.classifieds;
CREATE POLICY "Donos e equipe veem todos os anúncios"
  ON public.classifieds FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id OR (SELECT public.is_editor_or_admin()));

DROP POLICY IF EXISTS "Usuários autenticados podem publicar anúncios" ON public.classifieds;
CREATE POLICY "Usuários autenticados podem publicar anúncios"
  ON public.classifieds FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Usuários podem editar seus próprios anúncios" ON public.classifieds;
CREATE POLICY "Usuários podem editar seus próprios anúncios"
  ON public.classifieds FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id OR (SELECT public.is_admin()))
  WITH CHECK ((SELECT auth.uid()) = user_id OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "Usuários podem excluir seus próprios anúncios" ON public.classifieds;
CREATE POLICY "Usuários podem excluir seus próprios anúncios"
  ON public.classifieds FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id OR (SELECT public.is_admin()));

-- Moderação: dono comum não pode se autoaprovar, mexer em views/rejeição
-- nem transferir o anúncio. Admin e service_role passam direto.
CREATE OR REPLACE FUNCTION public.protect_classified_moderation_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  approval_required BOOLEAN;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(s.require_approval, true) INTO approval_required
  FROM public.classified_settings s WHERE s.id = 'default';
  approval_required := COALESCE(approval_required, true);

  IF TG_OP = 'INSERT' THEN
    NEW.views_count := 0;
    NEW.rejection_reason := NULL;
    IF NEW.status IS DISTINCT FROM 'pending' AND (approval_required OR NEW.status <> 'published') THEN
      NEW.status := 'pending';
    END IF;
  ELSE
    NEW.id := OLD.id;
    NEW.code := OLD.code;
    NEW.user_id := OLD.user_id;
    NEW.views_count := OLD.views_count;
    NEW.rejection_reason := OLD.rejection_reason;
    NEW.created_at := OLD.created_at;
    -- Dono pode: pausar o que está no ar, reativar o que pausou, reenviar para
    -- análise. Publicar direto só quando a aprovação está desligada.
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
         NEW.status = 'pending'
         OR (NEW.status = 'paused' AND OLD.status = 'published')
         OR (NEW.status = 'published' AND OLD.status = 'paused')
         OR (NEW.status = 'published' AND NOT approval_required AND OLD.status IN ('pending', 'expired'))
       ) THEN
      NEW.status := CASE WHEN NEW.status = 'published' THEN 'pending' ELSE OLD.status END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_classified_moderation_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_classified_moderation_fields ON public.classifieds;
CREATE TRIGGER protect_classified_moderation_fields
  BEFORE INSERT OR UPDATE ON public.classifieds
  FOR EACH ROW EXECUTE FUNCTION public.protect_classified_moderation_fields();

-- Tabela de Denúncias de Classificados
CREATE TABLE IF NOT EXISTS public.classified_reports (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  classified_id TEXT REFERENCES public.classifieds(id) ON DELETE CASCADE NOT NULL,
  classified_title TEXT NOT NULL,
  reporter_name TEXT,
  reporter_email TEXT,
  reason TEXT NOT NULL CHECK (reason IN ('fraude', 'produto_proibido', 'dados_falsos', 'conteudo_ofensivo', 'outro')),
  details TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.classified_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Qualquer visitante pode enviar denúncia" ON public.classified_reports;
CREATE POLICY "Qualquer visitante pode enviar denúncia"
  ON public.classified_reports FOR INSERT
  TO anon, authenticated
  WITH CHECK (status = 'pending');

DROP POLICY IF EXISTS "Apenas administradores visualizam e moderam denúncias" ON public.classified_reports;
CREATE POLICY "Apenas administradores visualizam e moderam denúncias"
  ON public.classified_reports FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- 8. Tabela de Comentários
CREATE TABLE IF NOT EXISTS public.comments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  article_id TEXT REFERENCES public.articles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  user_avatar TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Comentários visíveis publicamente" ON public.comments;
CREATE POLICY "Comentários visíveis publicamente"
  ON public.comments FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Usuários autenticados podem comentar" ON public.comments;
CREATE POLICY "Usuários autenticados podem comentar"
  ON public.comments FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Autores e equipe removem comentários" ON public.comments;
CREATE POLICY "Autores e equipe removem comentários"
  ON public.comments FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id OR (SELECT public.is_editor_or_admin()));

-- 9. Tabela de Assinantes da Newsletter
CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Qualquer pessoa pode se inscrever na newsletter" ON public.newsletter_subscribers;
CREATE POLICY "Qualquer pessoa pode se inscrever na newsletter"
  ON public.newsletter_subscribers FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Administradores veem assinantes" ON public.newsletter_subscribers;
CREATE POLICY "Administradores veem assinantes"
  ON public.newsletter_subscribers FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin()));

-- 10. Funções RPC
CREATE OR REPLACE FUNCTION public.increment_article_views(article_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.articles
  SET views_count = views_count + 1
  WHERE id = article_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_classified_views(classified_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.classifieds
  SET views_count = views_count + 1
  WHERE id = classified_id AND status = 'published';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_article_views(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_classified_views(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_article_views(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_classified_views(TEXT) TO anon, authenticated, service_role;


-- 11. Trigger automático para criar Perfil quando novo usuário se cadastrar no Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parsed_interests TEXT[];
BEGIN
  -- Trata array de interesses de forma segura sem erro de cast
  BEGIN
    IF new.raw_user_meta_data->'interests' IS NOT NULL AND jsonb_typeof(new.raw_user_meta_data->'interests') = 'array' THEN
      SELECT COALESCE(ARRAY_AGG(x), ARRAY['Política', 'Cidades'])
      INTO parsed_interests
      FROM jsonb_array_elements_text(new.raw_user_meta_data->'interests') AS x;
    ELSE
      parsed_interests := ARRAY['Política', 'Cidades'];
    END IF;
  EXCEPTION WHEN OTHERS THEN
    parsed_interests := ARRAY['Política', 'Cidades'];
  END;

  INSERT INTO public.profiles (
    id, email, full_name, role, avatar_url, interests, account_type, phone, city, state,
    cpf, cnpj, company_name, trade_name, legal_representative, representative_cpf,
    terms_accepted, terms_accepted_at, terms_version, status
  )
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    'reader',
    COALESCE(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', 'https://api.dicebear.com/7.x/initials/svg?seed=' || new.email),
    COALESCE(parsed_interests, ARRAY['Política', 'Cidades']),
    CASE WHEN new.raw_user_meta_data->>'account_type' = 'pj' THEN 'pj' ELSE 'pf' END,
    new.raw_user_meta_data->>'phone',
    COALESCE(new.raw_user_meta_data->>'city', 'Itabaiana'),
    COALESCE(new.raw_user_meta_data->>'state', 'SE'),
    new.raw_user_meta_data->>'cpf',
    new.raw_user_meta_data->>'cnpj',
    new.raw_user_meta_data->>'company_name',
    new.raw_user_meta_data->>'trade_name',
    new.raw_user_meta_data->>'legal_representative',
    new.raw_user_meta_data->>'representative_cpf',
    COALESCE(new.raw_user_meta_data->>'terms_accepted' = 'true', true),
    timezone('utc'::text, now()),
    COALESCE(new.raw_user_meta_data->>'terms_version', 'v2.1'),
    'active'
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    avatar_url = EXCLUDED.avatar_url,
    updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();



-- >>>>>>>>>> 20261019210000_harden_auth_rls.sql
-- ==============================================================================
-- MIGRAÇÃO: Endurecimento de segurança (Auth + RLS) - Notícia em 1 Minuto
-- Para executar: Supabase -> SQL Editor -> cole este arquivo inteiro -> Run
-- Idempotente: pode ser executada mais de uma vez sem efeitos colaterais.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Funções auxiliares de papel (SECURITY DEFINER para evitar recursão no RLS)
--    - search_path vazio + nomes qualificados
--    - só contam usuários com status 'active'
--    - EXECUTE apenas para authenticated (anon nunca precisa delas)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid()) AND role = 'admin' AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_editor_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid()) AND role IN ('admin', 'editor') AND status = 'active'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_editor_or_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_editor_or_admin() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 2. PROFILES
--    - Leitura: apenas o próprio dono e administradores (antes: pública, expunha
--      e-mail, telefone, CPF/CNPJ, papel e status de todos os usuários)
--    - Atualização: USING + WITH CHECK
--    - Trigger impede que não-admins alterem role/status/e-mail/moderação
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Perfis visíveis publicamente" ON public.profiles;
DROP POLICY IF EXISTS "Usuários veem o próprio perfil" ON public.profiles;
CREATE POLICY "Usuários veem o próprio perfil"
  ON public.profiles FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = id OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "Usuários podem criar seus próprios perfis" ON public.profiles;
CREATE POLICY "Usuários podem criar seus próprios perfis"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Usuários podem atualizar seus próprios dados de perfil" ON public.profiles;
CREATE POLICY "Usuários podem atualizar seus próprios dados de perfil"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Administradores gerenciam todos os perfis" ON public.profiles;
CREATE POLICY "Administradores gerenciam todos os perfis"
  ON public.profiles FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- Campos privilegiados só podem ser definidos por admin, service_role ou pelo
-- próprio banco (trigger de cadastro / SQL Editor). Para os demais, os valores
-- são preservados silenciosamente (não quebra o upsert do cadastro no app).
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.role := 'reader';
    NEW.status := 'active';
    NEW.moderation_reason := NULL;
    NEW.moderation_at := NULL;
    NEW.moderated_by := NULL;
  ELSE
    NEW.id := OLD.id;
    NEW.email := OLD.email;
    NEW.role := OLD.role;
    NEW.status := OLD.status;
    NEW.moderation_reason := OLD.moderation_reason;
    NEW.moderation_at := OLD.moderation_at;
    NEW.moderated_by := OLD.moderated_by;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_profile_privileged_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_profile_privileged_fields ON public.profiles;
CREATE TRIGGER protect_profile_privileged_fields
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileged_fields();

-- ------------------------------------------------------------------------------
-- 3. Cadastro: role/status NUNCA vêm de raw_user_meta_data (editável pelo
--    usuário no signUp). Antes, signUp com data.role = 'admin' criava um admin.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parsed_interests TEXT[];
BEGIN
  -- Trata array de interesses de forma segura sem erro de cast
  BEGIN
    IF new.raw_user_meta_data->'interests' IS NOT NULL AND jsonb_typeof(new.raw_user_meta_data->'interests') = 'array' THEN
      SELECT COALESCE(ARRAY_AGG(x), ARRAY['Política', 'Cidades'])
      INTO parsed_interests
      FROM jsonb_array_elements_text(new.raw_user_meta_data->'interests') AS x;
    ELSE
      parsed_interests := ARRAY['Política', 'Cidades'];
    END IF;
  EXCEPTION WHEN OTHERS THEN
    parsed_interests := ARRAY['Política', 'Cidades'];
  END;

  INSERT INTO public.profiles (
    id, email, full_name, role, avatar_url, interests, account_type, phone, city, state,
    cpf, cnpj, company_name, trade_name, legal_representative, representative_cpf,
    terms_accepted, terms_accepted_at, terms_version, status
  )
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    'reader',
    COALESCE(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', 'https://api.dicebear.com/7.x/initials/svg?seed=' || new.email),
    COALESCE(parsed_interests, ARRAY['Política', 'Cidades']),
    CASE WHEN new.raw_user_meta_data->>'account_type' = 'pj' THEN 'pj' ELSE 'pf' END,
    new.raw_user_meta_data->>'phone',
    COALESCE(new.raw_user_meta_data->>'city', 'Itabaiana'),
    COALESCE(new.raw_user_meta_data->>'state', 'SE'),
    new.raw_user_meta_data->>'cpf',
    new.raw_user_meta_data->>'cnpj',
    new.raw_user_meta_data->>'company_name',
    new.raw_user_meta_data->>'trade_name',
    new.raw_user_meta_data->>'legal_representative',
    new.raw_user_meta_data->>'representative_cpf',
    COALESCE(new.raw_user_meta_data->>'terms_accepted' = 'true', true),
    timezone('utc'::text, now()),
    COALESCE(new.raw_user_meta_data->>'terms_version', 'v2.1'),
    'active'
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    avatar_url = EXCLUDED.avatar_url,
    updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------------------------
-- 4. ARTICLES / ADS: troca auth.role() (deprecated) por TO authenticated
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Notícias são públicas para leitura" ON public.articles;
CREATE POLICY "Notícias são públicas para leitura"
  ON public.articles FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Apenas editores e admins podem inserir/modificar notícias" ON public.articles;
CREATE POLICY "Apenas editores e admins podem inserir/modificar notícias"
  ON public.articles FOR ALL
  TO authenticated
  USING ((SELECT public.is_editor_or_admin()))
  WITH CHECK ((SELECT public.is_editor_or_admin()));

DROP POLICY IF EXISTS "Anúncios visíveis publicamente" ON public.ads;
CREATE POLICY "Anúncios visíveis publicamente"
  ON public.ads FOR SELECT
  TO anon, authenticated
  USING (active = true);

DROP POLICY IF EXISTS "Apenas administradores gerenciam anúncios" ON public.ads;
CREATE POLICY "Apenas administradores gerenciam anúncios"
  ON public.ads FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- ------------------------------------------------------------------------------
-- 5. NOTIFICATIONS
--    - UPDATE com WITH CHECK
--    - INSERT para editores/admins (o app cria notificações ao publicar notícia;
--      antes não havia policy e os inserts falhavam silenciosamente)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Usuários podem ver suas próprias notificações" ON public.notifications;
CREATE POLICY "Usuários podem ver suas próprias notificações"
  ON public.notifications FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Usuários podem atualizar status de leitura das suas notificações" ON public.notifications;
CREATE POLICY "Usuários podem atualizar status de leitura das suas notificações"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Editores e admins criam notificações" ON public.notifications;
CREATE POLICY "Editores e admins criam notificações"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.is_editor_or_admin()));

-- ------------------------------------------------------------------------------
-- 6. CLASSIFICADOS
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Configurações de classificados públicas para leitura" ON public.classified_settings;
CREATE POLICY "Configurações de classificados públicas para leitura"
  ON public.classified_settings FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Apenas admins alteram configurações de classificados" ON public.classified_settings;
CREATE POLICY "Apenas admins alteram configurações de classificados"
  ON public.classified_settings FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "Categorias de classificados públicas" ON public.classified_categories;
CREATE POLICY "Categorias de classificados públicas"
  ON public.classified_categories FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Apenas admins gerenciam categorias de classificados" ON public.classified_categories;
CREATE POLICY "Apenas admins gerenciam categorias de classificados"
  ON public.classified_categories FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

CREATE INDEX IF NOT EXISTS idx_classifieds_user_id ON public.classifieds(user_id);

DROP POLICY IF EXISTS "Anúncios publicados e não expirados são visíveis publicamente" ON public.classifieds;
CREATE POLICY "Anúncios publicados e não expirados são visíveis publicamente"
  ON public.classifieds FOR SELECT
  TO anon, authenticated
  USING (status = 'published' AND expires_at > now());

DROP POLICY IF EXISTS "Donos e equipe veem todos os anúncios" ON public.classifieds;
CREATE POLICY "Donos e equipe veem todos os anúncios"
  ON public.classifieds FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id OR (SELECT public.is_editor_or_admin()));

DROP POLICY IF EXISTS "Usuários autenticados podem publicar anúncios" ON public.classifieds;
CREATE POLICY "Usuários autenticados podem publicar anúncios"
  ON public.classifieds FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Usuários podem editar seus próprios anúncios" ON public.classifieds;
CREATE POLICY "Usuários podem editar seus próprios anúncios"
  ON public.classifieds FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id OR (SELECT public.is_admin()))
  WITH CHECK ((SELECT auth.uid()) = user_id OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "Usuários podem excluir seus próprios anúncios" ON public.classifieds;
CREATE POLICY "Usuários podem excluir seus próprios anúncios"
  ON public.classifieds FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id OR (SELECT public.is_admin()));

-- Moderação: dono comum não pode se autoaprovar, mexer em views/rejeição
-- nem transferir o anúncio. Admin e service_role passam direto.
CREATE OR REPLACE FUNCTION public.protect_classified_moderation_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  approval_required BOOLEAN;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(s.require_approval, true) INTO approval_required
  FROM public.classified_settings s WHERE s.id = 'default';
  approval_required := COALESCE(approval_required, true);

  IF TG_OP = 'INSERT' THEN
    NEW.views_count := 0;
    NEW.rejection_reason := NULL;
    IF NEW.status IS DISTINCT FROM 'pending' AND (approval_required OR NEW.status <> 'published') THEN
      NEW.status := 'pending';
    END IF;
  ELSE
    NEW.id := OLD.id;
    NEW.code := OLD.code;
    NEW.user_id := OLD.user_id;
    NEW.views_count := OLD.views_count;
    NEW.rejection_reason := OLD.rejection_reason;
    NEW.created_at := OLD.created_at;
    -- Dono pode: pausar o que está no ar, reativar o que pausou, reenviar para
    -- análise. Publicar direto só quando a aprovação está desligada.
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
         NEW.status = 'pending'
         OR (NEW.status = 'paused' AND OLD.status = 'published')
         OR (NEW.status = 'published' AND OLD.status = 'paused')
         OR (NEW.status = 'published' AND NOT approval_required AND OLD.status IN ('pending', 'expired'))
       ) THEN
      NEW.status := CASE WHEN NEW.status = 'published' THEN 'pending' ELSE OLD.status END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_classified_moderation_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_classified_moderation_fields ON public.classifieds;
CREATE TRIGGER protect_classified_moderation_fields
  BEFORE INSERT OR UPDATE ON public.classifieds
  FOR EACH ROW EXECUTE FUNCTION public.protect_classified_moderation_fields();

DROP POLICY IF EXISTS "Qualquer visitante pode enviar denúncia" ON public.classified_reports;
CREATE POLICY "Qualquer visitante pode enviar denúncia"
  ON public.classified_reports FOR INSERT
  TO anon, authenticated
  WITH CHECK (status = 'pending');

DROP POLICY IF EXISTS "Apenas administradores visualizam e moderam denúncias" ON public.classified_reports;
CREATE POLICY "Apenas administradores visualizam e moderam denúncias"
  ON public.classified_reports FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- ------------------------------------------------------------------------------
-- 7. COMENTÁRIOS: comentário precisa ser do próprio usuário logado
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Comentários visíveis publicamente" ON public.comments;
CREATE POLICY "Comentários visíveis publicamente"
  ON public.comments FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Usuários autenticados podem comentar" ON public.comments;
CREATE POLICY "Usuários autenticados podem comentar"
  ON public.comments FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Autores e equipe removem comentários" ON public.comments;
CREATE POLICY "Autores e equipe removem comentários"
  ON public.comments FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id OR (SELECT public.is_editor_or_admin()));

-- ------------------------------------------------------------------------------
-- 8. NEWSLETTER: inscrição pública; leitura só admin
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Qualquer pessoa pode se inscrever na newsletter" ON public.newsletter_subscribers;
CREATE POLICY "Qualquer pessoa pode se inscrever na newsletter"
  ON public.newsletter_subscribers FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Administradores veem assinantes" ON public.newsletter_subscribers;
CREATE POLICY "Administradores veem assinantes"
  ON public.newsletter_subscribers FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin()));

-- ------------------------------------------------------------------------------
-- 9. RPCs de visualização: search_path fixo e grants explícitos
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_article_views(article_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.articles
  SET views_count = views_count + 1
  WHERE id = article_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_classified_views(classified_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.classifieds
  SET views_count = views_count + 1
  WHERE id = classified_id AND status = 'published';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_article_views(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_classified_views(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_article_views(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_classified_views(TEXT) TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 10. Limpeza: policies duplicadas encontradas no banco de produção que não
--     existem no schema.sql (policies permissivas somam com OR, então qualquer
--     sobra antiga reabriria o acesso que as regras acima fecham)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Apenas editores e admins podem gerenciar notícias" ON public.articles;
DROP POLICY IF EXISTS "Apenas admins moderam denúncias" ON public.classified_reports;
DROP POLICY IF EXISTS "Apenas administradores alteram configurações de classificados" ON public.classified_settings;
DROP POLICY IF EXISTS "Configurações de classificados públicas" ON public.classified_settings;
DROP POLICY IF EXISTS "Anúncios publicados visíveis publicamente" ON public.classifieds;
DROP POLICY IF EXISTS "Usuários gerenciam seus comentários ou administradores" ON public.comments;
DROP POLICY IF EXISTS "Apenas administradores visualizam assinantes" ON public.newsletter_subscribers;
DROP POLICY IF EXISTS "Usuários podem atualizar leitura das suas notificações" ON public.notifications;

-- Usuário pode criar notificação para si mesmo (comportamento já existente em produção)
DROP POLICY IF EXISTS "Criadores e admins podem inserir notificações" ON public.notifications;
CREATE POLICY "Criadores e admins podem inserir notificações"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id OR (SELECT public.is_editor_or_admin()));

DROP POLICY IF EXISTS "Categorias públicas para leitura" ON public.categories;
CREATE POLICY "Categorias públicas para leitura"
  ON public.categories FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Apenas administradores gerenciam categorias" ON public.categories;
CREATE POLICY "Apenas administradores gerenciam categorias"
  ON public.categories FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

COMMIT;


-- >>>>>>>>>> 20261020000000_classifieds_active_user_rls.sql
-- ==============================================================================
-- MIGRAÇÃO: Acesso e Publicação de Classificados para Usuários com Conta Ativa
--
-- Regras aplicadas:
-- 1. Não exigir confirmação de e-mail para publicar anúncios.
-- 2. Não exigir token ou etapa adicional de validação.
-- 3. Cadastro obrigatório: usuário precisa ter conta cadastrada (perfil existente).
-- 4. Conta ativa e login: qualquer usuário autenticado com status 'active' pode publicar.
-- 5. Bloqueio: visitantes anônimos e contas inativas, suspensas ou bloqueadas NÃO publicam.
-- ==============================================================================

-- 1. Função auxiliar para verificar se o usuário autenticado atual possui conta ativa
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid()) AND status = 'active'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_active_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated, service_role;

-- 2. Atualização das Políticas de RLS em public.classifieds

-- INSERT: Apenas usuários autenticados com conta ativa podem publicar anúncios
DROP POLICY IF EXISTS "Usuários autenticados podem publicar anúncios" ON public.classifieds;
DROP POLICY IF EXISTS "Usuários autenticados com conta ativa podem publicar anúncios" ON public.classifieds;
CREATE POLICY "Usuários autenticados com conta ativa podem publicar anúncios"
  ON public.classifieds FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (SELECT public.is_active_user())
  );

-- UPDATE: Usuário dono com conta ativa ou administradores podem editar
DROP POLICY IF EXISTS "Usuários podem editar seus próprios anúncios" ON public.classifieds;
DROP POLICY IF EXISTS "Usuários ativos ou admins podem editar seus próprios anúncios" ON public.classifieds;
CREATE POLICY "Usuários ativos ou admins podem editar seus próprios anúncios"
  ON public.classifieds FOR UPDATE
  TO authenticated
  USING (
    ((SELECT auth.uid()) = user_id AND (SELECT public.is_active_user()))
    OR (SELECT public.is_admin())
  )
  WITH CHECK (
    ((SELECT auth.uid()) = user_id AND (SELECT public.is_active_user()))
    OR (SELECT public.is_admin())
  );

-- DELETE: Usuário dono com conta ativa ou administradores podem excluir
DROP POLICY IF EXISTS "Usuários podem excluir seus próprios anúncios" ON public.classifieds;
DROP POLICY IF EXISTS "Usuários ativos ou admins podem excluir seus próprios anúncios" ON public.classifieds;
CREATE POLICY "Usuários ativos ou admins podem excluir seus próprios anúncios"
  ON public.classifieds FOR DELETE
  TO authenticated
  USING (
    ((SELECT auth.uid()) = user_id AND (SELECT public.is_active_user()))
    OR (SELECT public.is_admin())
  );


-- >>>>>>>>>> 20261024000000_supabase_source_of_truth.sql
-- ==============================================================================
-- MIGRAÇÃO: Supabase como fonte única dos dados - Notícia em 1 Minuto
-- Para executar: Supabase -> SQL Editor -> cole este arquivo inteiro -> Run
-- Idempotente: pode ser executada mais de uma vez sem efeitos colaterais.
--
-- Até aqui o app gravava notícias, anúncios, configurações, comentários e
-- denúncias apenas no localStorage do navegador de quem editou (e as tabelas
-- não tinham as colunas que o app envia). Esta migração:
--   1. Alinha as tabelas com o que o app grava (articles.status, colunas de ads)
--   2. Cria site_settings (configurações do portal e dos espaços publicitários)
--   3. Cria user_audit_logs (auditoria de moderação)
--   4. Cria RPCs administrativas que substituem as rotas /api do servidor Express
--      (que não existe no GitHub Pages)
--   5. Gera notificações de novas matérias no próprio banco
--   6. Cria o bucket de mídia "media" no Storage (imagens deixam de ir em base64)
--   7. Popula as categorias padrão dos classificados
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. PROFILES: status 'inactive' já é usado pelo app
-- ------------------------------------------------------------------------------
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_status_check CHECK (status IN ('active', 'suspended', 'blocked', 'inactive')) NOT VALID;

-- ------------------------------------------------------------------------------
-- 2. ARTICLES: coluna status (rascunho/publicado) e leitura pública só do publicado
-- ------------------------------------------------------------------------------
ALTER TABLE public.articles ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE public.articles DROP CONSTRAINT IF EXISTS articles_status_check;
ALTER TABLE public.articles
  ADD CONSTRAINT articles_status_check CHECK (status IN ('published', 'draft')) NOT VALID;
CREATE INDEX IF NOT EXISTS idx_articles_status ON public.articles(status);

DROP POLICY IF EXISTS "Notícias são públicas para leitura" ON public.articles;
DROP POLICY IF EXISTS "Notícias publicadas são públicas" ON public.articles;
CREATE POLICY "Notícias publicadas são públicas"
  ON public.articles FOR SELECT
  TO anon
  USING (status = 'published');

DROP POLICY IF EXISTS "Equipe vê rascunhos e publicadas" ON public.articles;
CREATE POLICY "Equipe vê rascunhos e publicadas"
  ON public.articles FOR SELECT
  TO authenticated
  USING (status = 'published' OR (SELECT public.is_editor_or_admin()));

-- ------------------------------------------------------------------------------
-- 3. ADS: colunas usadas pelo painel de publicidade (formato, carrossel, métricas)
-- ------------------------------------------------------------------------------
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS ad_format TEXT;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS width INTEGER;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS height INTEGER;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS start_date TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS end_date TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS alt_text TEXT;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 1;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS duration_seconds INTEGER DEFAULT 5;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS open_in_new_tab BOOLEAN DEFAULT true;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS campaign_id TEXT;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS campaign_name TEXT;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS impressions_count INTEGER DEFAULT 0;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS clicks_count INTEGER DEFAULT 0;
ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- O app usa mais espaços do que os três originais
ALTER TABLE public.ads DROP CONSTRAINT IF EXISTS ads_placement_check;
-- Anúncios gravados por versões antigas com espaço que o app não conhece mais
-- (ex.: 'sidebar_300x300') vão para o espaço equivalente pelo tamanho
UPDATE public.ads SET placement = CASE
    WHEN width = 300 AND height = 900 THEN 'sidebar_300x900'
    WHEN width = 300 AND height = 600 THEN 'sidebar_300x600'
    WHEN placement ILIKE 'sidebar%' OR (width = 300 AND height = 300) THEN 'sidebar'
    ELSE placement
  END
WHERE placement NOT IN (
  'header', 'feed', 'sidebar', 'article', 'footer', 'sidebar_300x900', 'sidebar_300x600',
  'sidebar_300x300_2', 'sidebar_300x300_3'
);
-- NOT VALID: vale para toda gravação nova, sem barrar a atualização por dado antigo
ALTER TABLE public.ads
  ADD CONSTRAINT ads_placement_check
  CHECK (placement IN (
    'header', 'feed', 'sidebar', 'article', 'footer', 'sidebar_300x900', 'sidebar_300x600',
    'sidebar_300x300_2', 'sidebar_300x300_3'
  )) NOT VALID;
ALTER TABLE public.ads DROP CONSTRAINT IF EXISTS ads_status_check;
ALTER TABLE public.ads
  ADD CONSTRAINT ads_status_check CHECK (status IN ('active', 'paused', 'ended')) NOT VALID;
CREATE INDEX IF NOT EXISTS idx_ads_display_order ON public.ads(display_order);

-- Métricas de impressão/clique (visitantes anônimos não têm UPDATE em ads)
CREATE OR REPLACE FUNCTION public.increment_ad_metric(p_ad_id TEXT, p_metric TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_metric = 'click' THEN
    UPDATE public.ads SET clicks_count = COALESCE(clicks_count, 0) + 1 WHERE id = p_ad_id AND active = true;
  ELSIF p_metric = 'impression' THEN
    UPDATE public.ads SET impressions_count = COALESCE(impressions_count, 0) + 1 WHERE id = p_ad_id AND active = true;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_ad_metric(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_ad_metric(TEXT, TEXT) TO anon, authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. SITE_SETTINGS: configurações do portal e dos espaços publicitários
--    Chaves usadas pelo app: 'portal', 'ads_placement', 'ads_format'
--    Leitura pública (o rodapé/cabeçalho precisam delas); escrita só de admin.
--    A senha SMTP NUNCA é gravada aqui (o app remove antes de enviar).
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.site_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_by UUID REFERENCES auth.users ON DELETE SET NULL
);

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Configurações do portal são públicas" ON public.site_settings;
CREATE POLICY "Configurações do portal são públicas"
  ON public.site_settings FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Apenas admins alteram configurações do portal" ON public.site_settings;
CREATE POLICY "Apenas admins alteram configurações do portal"
  ON public.site_settings FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));

-- ------------------------------------------------------------------------------
-- 5. USER_AUDIT_LOGS: histórico de moderação feito pelo painel
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_audit_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id UUID,
  user_email TEXT,
  user_name TEXT,
  admin_id UUID,
  admin_email TEXT,
  admin_name TEXT,
  action TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  reason TEXT NOT NULL DEFAULT '',
  result TEXT DEFAULT 'success',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_audit_logs_user_id ON public.user_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_audit_logs_created_at ON public.user_audit_logs(created_at DESC);

ALTER TABLE public.user_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Apenas admins leem auditoria" ON public.user_audit_logs;
CREATE POLICY "Apenas admins leem auditoria"
  ON public.user_audit_logs FOR SELECT
  TO authenticated
  USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "Apenas admins registram auditoria" ON public.user_audit_logs;
CREATE POLICY "Apenas admins registram auditoria"
  ON public.user_audit_logs FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.is_admin()) AND admin_id = (SELECT auth.uid()));

-- ------------------------------------------------------------------------------
-- 6. RPCs administrativas (substituem /api/admin/users e /api/admin/confirm-email)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id UUID,
  email TEXT,
  email_confirmed_at TIMESTAMP WITH TIME ZONE,
  last_sign_in_at TIMESTAMP WITH TIME ZONE,
  auth_created_at TIMESTAMP WITH TIME ZONE,
  profile JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT u.id, u.email::text, u.email_confirmed_at, u.last_sign_in_at, u.created_at, to_jsonb(p.*)
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  ORDER BY u.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_confirm_user_email(target_user UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores.' USING ERRCODE = '42501';
  END IF;

  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, now())
  WHERE id = target_user;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_confirm_user_email(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_confirm_user_email(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 7. Notificações de novas matérias geradas no banco
--    (editores não podem ler os perfis dos leitores, então o app não conseguia
--    descobrir quem tinha interesse na categoria)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_readers_of_article()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, article_id, article_slug, article_title, category, image_url, message)
  SELECT p.id, NEW.id, NEW.slug, NEW.title, NEW.category, NEW.image_url,
         'Nova matéria em ' || NEW.category || ': "' || NEW.title || '"'
  FROM public.profiles p
  WHERE p.status = 'active'
    AND EXISTS (
      SELECT 1 FROM unnest(COALESCE(p.interests, ARRAY[]::TEXT[])) AS i(interest)
      WHERE lower(i.interest) = lower(NEW.category)
         OR (lower(i.interest) = 'vídeos' AND NEW.is_video)
    );

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_readers_of_article() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notify_readers_of_article ON public.articles;
CREATE TRIGGER notify_readers_of_article
  AFTER INSERT OR UPDATE OF status ON public.articles
  FOR EACH ROW EXECUTE FUNCTION public.notify_readers_of_article();

-- ------------------------------------------------------------------------------
-- 8. STORAGE: bucket público "media"
--    articles/...            -> editores e admins
--    ads/... e portal/...    -> admins
--    classifieds/<uid>/...   -> o próprio usuário com conta ativa
-- ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media', 'media', true, 52428800,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Equipe envia mídia de notícias" ON storage.objects;
CREATE POLICY "Equipe envia mídia de notícias"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = 'articles'
    AND (SELECT public.is_editor_or_admin())
  );

DROP POLICY IF EXISTS "Admins enviam mídia de publicidade e do portal" ON storage.objects;
CREATE POLICY "Admins enviam mídia de publicidade e do portal"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] IN ('ads', 'portal')
    AND (SELECT public.is_admin())
  );

DROP POLICY IF EXISTS "Usuários ativos enviam fotos dos seus classificados" ON storage.objects;
CREATE POLICY "Usuários ativos enviam fotos dos seus classificados"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = 'classifieds'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
    AND (SELECT public.is_active_user())
  );

DROP POLICY IF EXISTS "Donos e admins removem mídia" ON storage.objects;
CREATE POLICY "Donos e admins removem mídia"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'media'
    AND (owner_id = (SELECT auth.uid())::text OR (SELECT public.is_admin()))
  );

-- ------------------------------------------------------------------------------
-- 9. Categorias padrão dos classificados (a tabela estava vazia; o app usava
--    só a lista embutida no código)
-- ------------------------------------------------------------------------------
INSERT INTO public.classified_categories (id, name, section) VALUES
  ('cat-prod-1', 'Veículos e motos', 'produtos_servicos'),
  ('cat-prod-2', 'Imóveis para venda', 'produtos_servicos'),
  ('cat-prod-3', 'Imóveis para aluguel', 'produtos_servicos'),
  ('cat-prod-4', 'Celulares e eletrônicos', 'produtos_servicos'),
  ('cat-prod-5', 'Móveis e eletrodomésticos', 'produtos_servicos'),
  ('cat-prod-6', 'Informática', 'produtos_servicos'),
  ('cat-prod-7', 'Moda e acessórios', 'produtos_servicos'),
  ('cat-prod-8', 'Casa e construção', 'produtos_servicos'),
  ('cat-prod-9', 'Serviços profissionais', 'produtos_servicos'),
  ('cat-prod-10', 'Outros produtos e serviços', 'produtos_servicos'),
  ('cat-vaga-1', 'Administração e escritório', 'vagas_emprego'),
  ('cat-vaga-2', 'Comércio e vendas', 'vagas_emprego'),
  ('cat-vaga-3', 'Saúde', 'vagas_emprego'),
  ('cat-vaga-4', 'Educação', 'vagas_emprego'),
  ('cat-vaga-5', 'Tecnologia', 'vagas_emprego'),
  ('cat-vaga-6', 'Serviços gerais', 'vagas_emprego'),
  ('cat-vaga-7', 'Construção civil', 'vagas_emprego'),
  ('cat-vaga-8', 'Transporte e logística', 'vagas_emprego'),
  ('cat-vaga-9', 'Estágio e jovem aprendiz', 'vagas_emprego'),
  ('cat-vaga-10', 'Trabalho autônomo', 'vagas_emprego'),
  ('cat-vaga-11', 'Outras oportunidades', 'vagas_emprego'),
  ('cat-cand-1', 'Administração e escritório', 'procuro_emprego'),
  ('cat-cand-2', 'Comércio e vendas', 'procuro_emprego'),
  ('cat-cand-3', 'Saúde', 'procuro_emprego'),
  ('cat-cand-4', 'Educação', 'procuro_emprego'),
  ('cat-cand-5', 'Tecnologia', 'procuro_emprego'),
  ('cat-cand-6', 'Serviços gerais', 'procuro_emprego'),
  ('cat-cand-7', 'Construção civil', 'procuro_emprego'),
  ('cat-cand-8', 'Transporte e logística', 'procuro_emprego'),
  ('cat-cand-9', 'Estágio e jovem aprendiz', 'procuro_emprego'),
  ('cat-cand-10', 'Trabalho autônomo', 'procuro_emprego'),
  ('cat-cand-11', 'Outras oportunidades', 'procuro_emprego')
ON CONFLICT (id) DO NOTHING;

COMMIT;


-- >>>>>>>>>> 20261025000000_ads_sidebar_300x300_extra.sql
-- ==============================================================================
-- Dois painéis de publicidade 300x300 adicionais na coluna lateral
-- (sidebar_300x300_2 e sidebar_300x300_3), cada um com anúncios próprios.
--
-- Pré-requisito: 20261024000000_supabase_source_of_truth.sql aplicada.
-- Pode ser executado mais de uma vez.
-- ==============================================================================

ALTER TABLE public.ads DROP CONSTRAINT IF EXISTS ads_placement_check;
ALTER TABLE public.ads
  ADD CONSTRAINT ads_placement_check
  CHECK (placement IN (
    'header', 'feed', 'sidebar', 'article', 'footer', 'sidebar_300x900', 'sidebar_300x600',
    'sidebar_300x300_2', 'sidebar_300x300_3'
  )) NOT VALID;


-- >>>>>>>>>> 20261028000000_classifieds_staff_moderation.sql
-- ==============================================================================
-- Moderação dos classificados pela equipe e validade protegida
--
-- 1. Editores já veem todos os anúncios e têm a aba Classificados no painel, mas o
--    RLS só deixava o dono ou o admin alterar: aprovar, recusar ou pausar não fazia
--    nada e o painel não mostrava erro. Agora a equipe (admin e editor) pode moderar.
-- 2. O trigger de moderação deixa a equipe passar direto (antes só o admin).
-- 3. O anunciante não consegue mais gravar uma validade além do prazo configurado.
--
-- Pré-requisito: 20261020000000_classifieds_active_user_rls.sql aplicada.
-- Pode ser executado mais de uma vez.
-- ==============================================================================

DROP POLICY IF EXISTS "Usuários ativos ou admins podem editar seus próprios anúncios" ON public.classifieds;
DROP POLICY IF EXISTS "Usuários ativos ou equipe podem editar anúncios" ON public.classifieds;
CREATE POLICY "Usuários ativos ou equipe podem editar anúncios"
  ON public.classifieds FOR UPDATE
  TO authenticated
  USING (
    ((SELECT auth.uid()) = user_id AND (SELECT public.is_active_user()))
    OR (SELECT public.is_editor_or_admin())
  )
  WITH CHECK (
    ((SELECT auth.uid()) = user_id AND (SELECT public.is_active_user()))
    OR (SELECT public.is_editor_or_admin())
  );

-- Moderação: dono comum não pode se autoaprovar, mexer em views/rejeição,
-- transferir o anúncio nem esticar a validade. Equipe e service_role passam direto.
CREATE OR REPLACE FUNCTION public.protect_classified_moderation_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  approval_required BOOLEAN;
  validity_days INTEGER;
  max_expiry TIMESTAMPTZ;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR public.is_editor_or_admin() THEN
    RETURN NEW;
  END IF;

  SELECT s.require_approval, s.default_validity_days INTO approval_required, validity_days
  FROM public.classified_settings s WHERE s.id = 'default';
  approval_required := COALESCE(approval_required, true);
  validity_days := COALESCE(validity_days, 30);
  -- Um dia de folga para diferenças de relógio entre o navegador e o banco
  max_expiry := now() + make_interval(days => validity_days + 1);

  IF TG_OP = 'INSERT' THEN
    NEW.views_count := 0;
    NEW.rejection_reason := NULL;
    IF NEW.status IS DISTINCT FROM 'pending' AND (approval_required OR NEW.status <> 'published') THEN
      NEW.status := 'pending';
    END IF;
    IF NEW.expires_at IS NULL OR NEW.expires_at > max_expiry THEN
      NEW.expires_at := now() + make_interval(days => validity_days);
    END IF;
  ELSE
    NEW.id := OLD.id;
    NEW.code := OLD.code;
    NEW.user_id := OLD.user_id;
    NEW.views_count := OLD.views_count;
    NEW.rejection_reason := OLD.rejection_reason;
    NEW.created_at := OLD.created_at;
    -- Dono pode: pausar o que está no ar, reativar o que pausou, reenviar para
    -- análise. Publicar direto só quando a aprovação está desligada.
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
         NEW.status = 'pending'
         OR (NEW.status = 'paused' AND OLD.status = 'published')
         OR (NEW.status = 'published' AND OLD.status = 'paused')
         OR (NEW.status = 'published' AND NOT approval_required AND OLD.status IN ('pending', 'expired'))
       ) THEN
      NEW.status := CASE WHEN NEW.status = 'published' THEN 'pending' ELSE OLD.status END;
    END IF;
    IF NEW.expires_at IS DISTINCT FROM OLD.expires_at AND NEW.expires_at > max_expiry THEN
      NEW.expires_at := now() + make_interval(days => validity_days);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_classified_moderation_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_classified_moderation_fields ON public.classifieds;
CREATE TRIGGER protect_classified_moderation_fields
  BEFORE INSERT OR UPDATE ON public.classifieds
  FOR EACH ROW EXECUTE FUNCTION public.protect_classified_moderation_fields();


-- >>>>>>>>>> 20261028100000_deploy_on_publish.sql
-- ==============================================================================
-- Publicação do site logo após publicar notícia ou anúncio
--
-- A prévia do link (foto, título e link do portal) só existe depois que o GitHub
-- Pages publica de novo o site. Até aqui isso dependia do agendamento do GitHub,
-- que atrasa horas. Agora, quando uma notícia ou um anúncio publicado muda, o
-- próprio banco avisa o GitHub (repository_dispatch "publicacao") e o deploy roda
-- em seguida. Contadores de visualização não disparam deploy.
--
-- Um aviso por transação: importar ou moderar vários itens de uma vez gera um só
-- deploy. Se o aviso falhar ou o token não existir, a gravação segue normalmente.
--
-- Antes de usar, guarde no Vault um token do GitHub (fine-grained, só o repositório
-- tomsilvaconsignado-ai/noticiaem1minuto, permissão "Contents: Read and write"):
--   SELECT vault.create_secret('github_pat_...', 'github_deploy_token');
-- Para trocar o token depois:
--   SELECT vault.update_secret(id, 'github_pat_...') FROM vault.secrets WHERE name = 'github_deploy_token';
-- Para testar: SELECT public.request_site_deploy();  (veja net._http_response)
--
-- Pode ser executado mais de uma vez.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.request_site_deploy()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  token TEXT;
BEGIN
  -- Já avisado nesta transação
  IF current_setting('n1m.deploy_requested', true) = 'on' THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO token
  FROM vault.decrypted_secrets
  WHERE name = 'github_deploy_token'
  LIMIT 1;

  IF coalesce(token, '') = '' THEN
    RAISE WARNING 'Deploy não solicitado: segredo github_deploy_token ausente no Vault';
    RETURN;
  END IF;

  -- pg_net só envia depois do COMMIT: o deploy lê os dados já gravados
  PERFORM net.http_post(
    url := 'https://api.github.com/repos/tomsilvaconsignado-ai/noticiaem1minuto/dispatches',
    body := jsonb_build_object('event_type', 'publicacao'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'noticiasem1minuto-supabase',
      'Content-Type', 'application/json'
    )
  );

  PERFORM set_config('n1m.deploy_requested', 'on', true);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Deploy não solicitado: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_site_deploy() FROM PUBLIC, anon, authenticated;

-- Notícias: só o que entra na página de prévia (scripts/prerender.ts); views_count e updated_at não contam
CREATE OR REPLACE FUNCTION public.deploy_on_article_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'published' THEN
      PERFORM public.request_site_deploy();
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' THEN
      PERFORM public.request_site_deploy();
    END IF;
  ELSIF (OLD.status = 'published' OR NEW.status = 'published')
    AND (NEW.title, NEW.subtitle, NEW.slug, NEW.content, NEW.category, NEW.image_url,
         NEW.video_url, NEW.is_video, NEW.author, NEW.status)
      IS DISTINCT FROM
        (OLD.title, OLD.subtitle, OLD.slug, OLD.content, OLD.category, OLD.image_url,
         OLD.video_url, OLD.is_video, OLD.author, OLD.status) THEN
    PERFORM public.request_site_deploy();
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.deploy_on_article_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS deploy_on_article_change ON public.articles;
CREATE TRIGGER deploy_on_article_change
  AFTER INSERT OR UPDATE OR DELETE ON public.articles
  FOR EACH ROW EXECUTE FUNCTION public.deploy_on_article_change();

-- Classificados: aprovação, edição, pausa, renovação ou remoção de anúncio publicado
CREATE OR REPLACE FUNCTION public.deploy_on_classified_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'published' THEN
      PERFORM public.request_site_deploy();
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' THEN
      PERFORM public.request_site_deploy();
    END IF;
  ELSIF (OLD.status = 'published' OR NEW.status = 'published')
    AND (NEW.code, NEW.slug, NEW.title, NEW.description, NEW.section, NEW.type, NEW.category,
         NEW.price_type, NEW.price, NEW.city, NEW.state, NEW.images, NEW.status, NEW.expires_at)
      IS DISTINCT FROM
        (OLD.code, OLD.slug, OLD.title, OLD.description, OLD.section, OLD.type, OLD.category,
         OLD.price_type, OLD.price, OLD.city, OLD.state, OLD.images, OLD.status, OLD.expires_at) THEN
    PERFORM public.request_site_deploy();
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.deploy_on_classified_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS deploy_on_classified_change ON public.classifieds;
CREATE TRIGGER deploy_on_classified_change
  AFTER INSERT OR UPDATE OR DELETE ON public.classifieds
  FOR EACH ROW EXECUTE FUNCTION public.deploy_on_classified_change();


-- >>>>>>>>>> 20261031000000_print_editions.sql
-- ==============================================================================
-- MÍDIA IMPRESSA: edições mensais do jornal em PDF
--
-- 1. Tabela print_editions: ano do jornal (exibido em algarismos romanos), número
--    da edição, mês/ano de circulação, manchete principal e caminho do PDF.
--    Os dados das edições publicadas são públicos (o visitante vê o que existe e
--    é convidado a se cadastrar); rascunhos só a equipe vê.
-- 2. Bucket PRIVADO "print-editions": o PDF só abre por link temporário (assinado),
--    e só para quem tem conta ativa no portal. A equipe (editor/admin) envia e remove.
--
-- Pode ser executado mais de uma vez.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.print_editions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  volume_year INTEGER NOT NULL CHECK (volume_year BETWEEN 1 AND 3999),
  edition_number INTEGER NOT NULL CHECK (edition_number > 0),
  edition_month SMALLINT NOT NULL CHECK (edition_month BETWEEN 1 AND 12),
  edition_year SMALLINT NOT NULL CHECK (edition_year BETWEEN 1900 AND 2200),
  headline TEXT NOT NULL CHECK (char_length(btrim(headline)) BETWEEN 3 AND 300),
  pdf_path TEXT NOT NULL,
  file_size BIGINT,
  published BOOLEAN NOT NULL DEFAULT true,
  created_by UUID DEFAULT auth.uid() REFERENCES auth.users ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT print_editions_edition_number_key UNIQUE (edition_number)
);

CREATE INDEX IF NOT EXISTS print_editions_pdf_path_idx ON public.print_editions (pdf_path);

ALTER TABLE public.print_editions ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.print_editions TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.print_editions TO authenticated;

DROP POLICY IF EXISTS "Edições impressas publicadas são públicas" ON public.print_editions;
CREATE POLICY "Edições impressas publicadas são públicas"
  ON public.print_editions FOR SELECT
  TO anon
  USING (published);

DROP POLICY IF EXISTS "Leitores veem publicadas e equipe vê todas as edições" ON public.print_editions;
CREATE POLICY "Leitores veem publicadas e equipe vê todas as edições"
  ON public.print_editions FOR SELECT
  TO authenticated
  USING (published OR (SELECT public.is_editor_or_admin()));

DROP POLICY IF EXISTS "Equipe cadastra edições impressas" ON public.print_editions;
CREATE POLICY "Equipe cadastra edições impressas"
  ON public.print_editions FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.is_editor_or_admin()));

DROP POLICY IF EXISTS "Equipe edita edições impressas" ON public.print_editions;
CREATE POLICY "Equipe edita edições impressas"
  ON public.print_editions FOR UPDATE
  TO authenticated
  USING ((SELECT public.is_editor_or_admin()))
  WITH CHECK ((SELECT public.is_editor_or_admin()));

DROP POLICY IF EXISTS "Equipe exclui edições impressas" ON public.print_editions;
CREATE POLICY "Equipe exclui edições impressas"
  ON public.print_editions FOR DELETE
  TO authenticated
  USING ((SELECT public.is_editor_or_admin()));

-- ------------------------------------------------------------------------------
-- STORAGE: bucket privado "print-editions" (somente PDF, até 50 MB)
-- ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('print-editions', 'print-editions', false, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Leitura (gera o link temporário): equipe sempre; leitor com conta ativa só o PDF
-- de uma edição publicada
DROP POLICY IF EXISTS "Leitores cadastrados abrem a mídia impressa" ON storage.objects;
CREATE POLICY "Leitores cadastrados abrem a mídia impressa"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'print-editions'
    AND (
      (SELECT public.is_editor_or_admin())
      OR (
        (SELECT public.is_active_user())
        AND EXISTS (
          SELECT 1 FROM public.print_editions e
          WHERE e.pdf_path = storage.objects.name AND e.published
        )
      )
    )
  );

DROP POLICY IF EXISTS "Equipe envia a mídia impressa" ON storage.objects;
CREATE POLICY "Equipe envia a mídia impressa"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'print-editions'
    AND (SELECT public.is_editor_or_admin())
  );

DROP POLICY IF EXISTS "Equipe remove a mídia impressa" ON storage.objects;
CREATE POLICY "Equipe remove a mídia impressa"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'print-editions'
    AND (SELECT public.is_editor_or_admin())
  );


-- >>>>>>>>>> 20261118000000_api_grants_categories_rls.sql
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


-- >>>>>>>>>> 20261119000000_administradores_master.sql
-- ==============================================================================
-- Administradores master
--
-- 1. Lista de e-mails master (tabela fora do alcance da API pública).
-- 2. Quem está na lista vira administrador quando CONFIRMA o e-mail: assim ninguém
--    vira admin só por se cadastrar com o e-mail de outra pessoa.
-- 3. Pelo portal (papéis anon/authenticated), um master não pode ser rebaixado,
--    suspenso, bloqueado nem excluído — nem por outro administrador.
--    Manutenção direta no banco (postgres/service_role) continua possível.
--
-- Para incluir ou remover um master: altere a tabela public.administradores_master
-- no SQL Editor (e a lista ADMINISTRADORES_MASTER em src/lib/supabase.ts).
-- Pode ser executado mais de uma vez.
-- ==============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.administradores_master (
  email TEXT PRIMARY KEY CHECK (email = lower(trim(email))),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.administradores_master ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.administradores_master FROM anon, authenticated;

INSERT INTO public.administradores_master (email) VALUES
  ('noticiasem1minutoitabaiana@gmail.com'),
  ('tomsilvaconsignado@gmail.com'),
  ('leowander@hotmail.com.br'),
  ('wemersonnobre@outlook.com')
ON CONFLICT (email) DO NOTHING;

CREATE OR REPLACE FUNCTION public.e_admin_master(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.administradores_master WHERE email = lower(trim(p_email)));
$$;
REVOKE EXECUTE ON FUNCTION public.e_admin_master(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.e_admin_master(TEXT) TO authenticated, service_role;

-- 2. Promoção ao confirmar o e-mail (ou na criação, se já vier confirmado)
CREATE OR REPLACE FUNCTION public.promover_admin_master()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND public.e_admin_master(NEW.email) THEN
    UPDATE public.profiles
       SET role = 'admin', status = 'active', updated_at = now()
     WHERE id = NEW.id AND (role <> 'admin' OR status <> 'active');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.promover_admin_master() FROM PUBLIC, anon, authenticated;

-- Nome com "zz_" para rodar depois do gatilho que cria o perfil (on_auth_user_created)
DROP TRIGGER IF EXISTS zz_promover_admin_master ON auth.users;
CREATE TRIGGER zz_promover_admin_master
  AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.promover_admin_master();

-- 3. Proteção contra rebaixamento, bloqueio e exclusão pelo portal
-- SECURITY INVOKER (padrão): current_user precisa ser quem fez a alteração, não o dono da função
CREATE OR REPLACE FUNCTION public.proteger_admin_master()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') OR NOT public.e_admin_master(OLD.email) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A conta de um administrador master não pode ser excluída pelo portal.';
  END IF;
  IF OLD.role = 'admin' AND (NEW.role IS DISTINCT FROM 'admin' OR NEW.status IS DISTINCT FROM 'active') THEN
    RAISE EXCEPTION 'Um administrador master não pode ser rebaixado, suspenso ou bloqueado.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.proteger_admin_master() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_proteger_admin_master ON public.profiles;
CREATE TRIGGER zz_proteger_admin_master
  BEFORE UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.proteger_admin_master();

-- 4. Masters que já confirmaram o e-mail viram administradores agora
UPDATE public.profiles p
   SET role = 'admin', status = 'active', updated_at = now()
  FROM auth.users u
 WHERE u.id = p.id
   AND u.email_confirmed_at IS NOT NULL
   AND public.e_admin_master(u.email)
   AND (p.role <> 'admin' OR p.status <> 'active');

COMMIT;
