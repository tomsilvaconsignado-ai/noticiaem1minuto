-- ==============================================================================
-- Segundo espaço 300x600 na coluna lateral (sidebar_300x600_2)
--
-- 1. Libera o novo espaço na validação da tabela ads.
-- 2. Distribui os anúncios verticais existentes entre o 300x600 (1) e o (2),
--    alternando pela ordem de exibição, e grava o formato de cada anúncio
--    (antes ele era deduzido pela altura do arquivo).
-- Pode ser executado mais de uma vez: a distribuição só mexe em anúncios que ainda
-- estão no espaço genérico "sidebar".
-- ==============================================================================

BEGIN;

ALTER TABLE public.ads DROP CONSTRAINT IF EXISTS ads_placement_check;
ALTER TABLE public.ads ADD CONSTRAINT ads_placement_check CHECK (placement = ANY (ARRAY[
  'header', 'feed', 'sidebar', 'article', 'footer',
  'sidebar_300x900', 'sidebar_300x600', 'sidebar_300x600_2',
  'sidebar_300x300_2', 'sidebar_300x300_3'
])) NOT VALID;

-- Verticais: anúncios do espaço genérico com altura 600 (vídeos dos patrocinadores)
WITH verticais AS (
  SELECT id, row_number() OVER (ORDER BY display_order, created_at, id) AS n
  FROM public.ads
  WHERE placement = 'sidebar' AND (height = 600 OR ad_format IN ('300x600', '300x900'))
)
UPDATE public.ads a
   SET placement = CASE WHEN v.n % 2 = 1 THEN 'sidebar_300x900' ELSE 'sidebar_300x600_2' END,
       ad_format = '300x600',
       updated_at = now()
  FROM verticais v
 WHERE a.id = v.id;

-- Quadrados: o que sobrou no espaço genérico passa a ter o formato gravado
UPDATE public.ads
   SET ad_format = '300x300', updated_at = now()
 WHERE placement = 'sidebar' AND (ad_format IS NULL OR ad_format = 'custom');

COMMIT;
