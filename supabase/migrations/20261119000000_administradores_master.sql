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
