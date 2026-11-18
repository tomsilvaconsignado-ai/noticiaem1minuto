// Importa do Base44 (app "Notícias em 1Minuto") para o Supabase do portal:
//   - categorias do cliente
//   - notícias (imagens copiadas para o bucket "media" do Supabase)
//   - patrocinadores, como anúncios da lateral (vídeos/imagens copiados para o bucket)
//
// Uso (PowerShell):
//   $env:BASE44_TOKEN="b44u_..."; $env:SUPABASE_ACCESS_TOKEN="sbp_..."; node scripts/importar_base44.mjs
// Opcional: BASE44_APP_ID, SUPABASE_PROJECT_REF, DRY_RUN=1 (só gera o SQL, não grava nada).
//
// Pode ser executado mais de uma vez: notícias e anúncios já importados (mesmo id) são mantidos.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const B44 = process.env.BASE44_TOKEN;
const SBP = process.env.SUPABASE_ACCESS_TOKEN;
const APP = process.env.BASE44_APP_ID || '69837c8db4823a37f6e36524';
const REF = process.env.SUPABASE_PROJECT_REF || 'aqregftcnkypoovawlmz';
const DRY = process.env.DRY_RUN === '1';
if (!B44 || !SBP) { console.error('Defina BASE44_TOKEN e SUPABASE_ACCESS_TOKEN.'); process.exit(1); }
const SUPA = `https://${REF}.supabase.co`;
const OUT = path.resolve('scripts', 'saida_importacao');
mkdirSync(OUT, { recursive: true });

// ---------- Mapeamentos ----------
const CATEGORIAS = [ // ordem do menu
  ['cat-urgente', 'Urgente', 'urgente'],
  ['cat-cidades', 'Cidades', 'cidades'],
  ['cat-politica', 'Política', 'politica'],
  ['cat-brasil', 'Brasil', 'brasil'],
  ['cat-mundo', 'Mundo', 'mundo'],
  ['cat-esporte', 'Esporte', 'esporte'],
  ['cat-entretenimento', 'Entretenimento', 'entretenimento'],
  ['cat-nutricao', 'Nutrição', 'nutricao'],
  ['cat-fe', 'Mensagem de Fé', 'mensagem-de-fe'],
  ['cat-videos', 'Vídeos', 'videos'],
  ['cat-classificados', 'Classificados', 'classificados'],
];
const CAT_B44 = {
  urgente: 'Urgente', cidade: 'Cidades', politica: 'Política', brasil: 'Brasil', mundo: 'Mundo',
  esportes: 'Esporte', entretenimento: 'Entretenimento', nutricao: 'Nutrição', mensagem_de_fe: 'Mensagem de Fé',
};

// ---------- Utilitários ----------
const slugify = (t) => (t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').substring(0, 120) || 'materia';
const q = (v) => v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const utc = (d) => d ? (/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? d : d + 'Z') : null;

async function b44(entity) {
  const r = await fetch(`https://app.base44.com/api/apps/${APP}/entities/${entity}?limit=5000`, { headers: { Authorization: `Bearer ${B44}` } });
  if (!r.ok) throw new Error(`Base44 ${entity}: ${r.status} ${await r.text()}`);
  return r.json();
}
async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${SBP}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`SQL ${r.status}: ${t.slice(0, 500)}`);
  return JSON.parse(t);
}
async function secretKey() {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${SBP}` } });
  const keys = await r.json();
  const k = keys.find(x => x.type === 'secret') || keys.find(x => x.name === 'service_role');
  if (!k?.api_key) throw new Error('Chave secreta do Supabase não encontrada');
  return k.api_key;
}

// Conteúdo do Base44 é texto com quebras de linha e um pouco de markdown
function converterConteudo(txt) {
  return (txt || '').replace(/\r\n?/g, '\n').split('\n').map(l => {
    const esc = l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const h = esc.match(/^\s*#{1,4}\s+(.+)$/);
    const linha = (h ? `<h2>${h[1]}</h2>` : esc)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    return linha;
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Largura/altura de um MP4 lidas do box "tkhd" (sem ffmpeg)
function dimensoesMp4(buf) {
  let best = null;
  for (let i = buf.indexOf('tkhd'); i > 0; i = buf.indexOf('tkhd', i + 4)) {
    const size = buf.readUInt32BE(i - 4);
    const end = i - 4 + size;
    if (end > buf.length || size < 84) continue;
    const w = buf.readUInt32BE(end - 8) / 65536, h = buf.readUInt32BE(end - 4) / 65536;
    if (w > 0 && h > 0) best = { w: Math.round(w), h: Math.round(h) };
  }
  return best;
}

let KEY;
async function upload(objectPath, body, contentType) {
  if (DRY) return `${SUPA}/storage/v1/object/public/media/${objectPath}`;
  const r = await fetch(`${SUPA}/storage/v1/object/media/${objectPath}`, {
    method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': contentType, 'x-upsert': 'true', 'Cache-Control': 'max-age=31536000' }, body,
  });
  if (!r.ok) throw new Error(`upload ${objectPath}: ${r.status} ${await r.text()}`);
  return `${SUPA}/storage/v1/object/public/media/${objectPath}`;
}

async function baixar(url) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`download ${r.status} ${url}`);
  return { buf: Buffer.from(await r.arrayBuffer()), type: (r.headers.get('content-type') || '').split(';')[0] };
}

// Imagem de matéria: mantém JPEG/PNG/WebP pequenos; converte AVIF/JFIF/arquivos grandes para WebP (máx. 1600px)
async function migrarImagem(url, nome) {
  const { buf } = await baixar(url);
  const meta = await sharp(buf).metadata();
  const ok = ['jpeg', 'png', 'webp'].includes(meta.format) && buf.length <= 900_000 && (meta.width || 0) <= 2000;
  if (ok) {
    const ext = meta.format === 'jpeg' ? 'jpg' : meta.format;
    return upload(`base44/${nome}.${ext}`, buf, `image/${meta.format}`);
  }
  const webp = await sharp(buf).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  return upload(`base44/${nome}.webp`, webp, 'image/webp');
}

async function emLotes(itens, n, fn) {
  const res = new Array(itens.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < itens.length) { const k = i++; res[k] = await fn(itens[k], k); } }));
  return res;
}

// ---------- Execução ----------
const noticias = await b44('Noticia');
const patrocinadores = await b44('Patrocinador');
console.log(`Base44: ${noticias.length} notícias, ${patrocinadores.length} patrocinadores`);
if (!DRY) KEY = await secretKey();

const relatorio = { erros: [], noticias: 0, anuncios: 0 };
const slugs = new Set();
const artigos = await emLotes(noticias, 6, async (n) => {
  let img = null;
  if (n.imagem_url) {
    try { img = await migrarImagem(n.imagem_url, n.id); }
    catch (e) { relatorio.erros.push(`imagem ${n.id}: ${e.message}`); img = n.imagem_url; }
  }
  return { n, img };
});
const valores = artigos.map(({ n, img }) => {
  let slug = slugify(n.titulo); if (slugs.has(slug)) slug = `${slug}-${n.id.slice(-6)}`; slugs.add(slug);
  const video = n.video_url || n.video_youtube_short_url || n.video_instagram_url || n.video_tiktok_url || null;
  const cat = CAT_B44[n.categoria] || 'Cidades';
  return `(${[q(`b44-${n.id}`), q((n.titulo || '').trim()), q((n.subtitulo || '').trim() || null), q(slug), q(converterConteudo(n.conteudo)),
    q(cat), q(img || '/og-image.png'), q(video), video ? 'true' : 'false', n.destaque ? 'true' : 'false', 'false',
    Number(n.visualizacoes) || 0, q((n.autor || '').trim() || 'Redação'), q('published'), q(utc(n.created_date)), q(utc(n.updated_date || n.created_date))].join(', ')})`;
});
relatorio.noticias = valores.length;

const anuncios = await emLotes(patrocinadores, 4, async (p) => {
  try {
    const { buf, type } = await baixar(p.logo_url);
    const isVideo = /video|mp4/.test(type) || /\.mp4$/i.test(p.logo_url);
    let url, w = 300, h = 300;
    if (isVideo) {
      const d = dimensoesMp4(buf); if (d) { w = d.w; h = d.h; }
      url = await upload(`patrocinadores/${p.id}.mp4`, buf, 'video/mp4');
    } else {
      const webp = await sharp(buf).rotate().resize({ width: 900, withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
      const m = await sharp(webp).metadata(); w = m.width; h = m.height;
      url = await upload(`patrocinadores/${p.id}.webp`, webp, 'image/webp');
    }
    return { p, url, isVideo, w, h };
  } catch (e) { relatorio.erros.push(`patrocinador ${p.nome}: ${e.message}`); return null; }
});
const valoresAds = anuncios.filter(Boolean).map(({ p, url, isVideo, w, h }) => {
  const ratio = `${w} / ${h}`;
  return `(${[q(`b44-${p.id}`), q(p.nome), q(p.nome), q(p.link || null), q(url), q(isVideo ? 'video' : 'image'), q('sidebar'), q(ratio), 300,
    p.ativo ? 'true' : 'false', q('custom'), w, h, q(p.ativo ? 'active' : 'paused'), q(p.nome), Number(p.ordem) || 1, isVideo ? 15 : 8, 'true', q('Patrocinadores (Base44)')].join(', ')})`;
});
relatorio.anuncios = valoresAds.length;

const script = `BEGIN;
-- Categorias do cliente (as matérias guardam o nome da categoria)
DELETE FROM public.categories WHERE id NOT IN (${CATEGORIAS.map(c => q(c[0])).join(', ')});
INSERT INTO public.categories (id, name, slug) VALUES
${CATEGORIAS.map(c => `(${q(c[0])}, ${q(c[1])}, ${q(c[2])})`).join(',\n')}
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug;

-- Sem isto, cada matéria importada geraria notificações para os leitores
ALTER TABLE public.articles DISABLE TRIGGER notify_readers_of_article;
INSERT INTO public.articles
  (id, title, subtitle, slug, content, category, image_url, video_url, is_video, is_hero, is_secondary, views_count, author, status, created_at, updated_at)
VALUES
${valores.join(',\n')}
ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.articles ENABLE TRIGGER notify_readers_of_article;

INSERT INTO public.ads
  (id, title, sponsor_name, link_url, media_url, media_type, placement, aspect_ratio, max_width, active, ad_format, width, height, status, alt_text, display_order, duration_seconds, open_in_new_tab, campaign_name)
VALUES
${valoresAds.join(',\n')}
ON CONFLICT (id) DO NOTHING;
COMMIT;
`;
writeFileSync(path.join(OUT, 'importacao_base44.sql'), script);
if (!DRY) await sql(script);
const conf = DRY ? null : await sql(`select (select count(*) from public.articles) materias, (select count(*) from public.ads) anuncios, (select count(*) from public.categories) categorias`);
writeFileSync(path.join(OUT, 'relatorio.json'), JSON.stringify({ ...relatorio, banco: conf }, null, 2));
console.log(JSON.stringify({ ...relatorio, banco: conf }, null, 2));
