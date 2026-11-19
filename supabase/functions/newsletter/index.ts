// Newsletter do Notícia em 1 Minuto (Supabase Edge Function, Deno).
//
// POST {acao:'inscrever', email}  -> grava como pendente e envia o link de confirmação
// GET  ?acao=confirmar&token=...   -> ativa a inscrição e volta ao site
// GET  ?acao=cancelar&token=...    -> cancela a inscrição e volta ao site
// POST {acao:'enviar'} + cabeçalho x-newsletter-secret -> envia um lote do resumo diário
//
// Segredos da função: SMTP_USER, SMTP_PASS (senha de app do Gmail), NEWSLETTER_CRON_SECRET.
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são fornecidos pelo próprio Supabase.
import nodemailer from 'npm:nodemailer@6.9.16';
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { corEditoria, tituloExibicao } from './titulos.ts';

const SITE = 'https://www.noticiaem1minuto.com.br';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const FUNCAO = `${SUPABASE_URL}/functions/v1/newsletter`;
const SMTP_USER = Deno.env.get('SMTP_USER') || '';
const LOTE = 80;
const NAVY = '#002f6c';
const CIANO = '#18b8f5';

const sb = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const smtp = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: { user: SMTP_USER, pass: Deno.env.get('SMTP_PASS') || '' },
});
const REMETENTE = `"Notícia em 1 Minuto" <${SMTP_USER}>`;

const ORIGENS = [SITE, 'https://noticiaem1minuto.com.br', 'http://localhost:3000', 'http://localhost:5173', 'http://localhost:4317', 'http://localhost:4318'];
const cors = (origem: string | null) => ({
  'Access-Control-Allow-Origin': origem && ORIGENS.includes(origem) ? origem : SITE,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
  'Vary': 'Origin',
});
const json = (corpo: unknown, status: number, origem: string | null) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors(origem), 'Content-Type': 'application/json; charset=utf-8' } });
const voltarAoSite = (resultado: string) =>
  new Response(null, { status: 302, headers: { Location: `${SITE}/?newsletter=${resultado}` } });

const EMAIL_VALIDO = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- modelos de e-mail
const moldura = (conteudo: string, rodape: string) => `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f6f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f9;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
<tr><td style="background-color:${NAVY};border-bottom:4px solid ${CIANO};padding:22px 28px;border-radius:12px 12px 0 0;">
<a href="${SITE}" style="text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:900;text-transform:uppercase;color:#ffffff;">Notícia em 1 Minuto</a>
<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#9fdcfb;padding-top:4px;">Informação rápida, confiável e sem enrolação</div>
</td></tr>
${conteudo}
<tr><td style="background-color:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 28px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#64748b;text-align:center;border-radius:0 0 12px 12px;">
${rodape}
</td></tr></table></td></tr></table></body></html>`;

const emailConfirmacao = (token: string) => {
  const link = `${FUNCAO}?acao=confirmar&token=${token}`;
  return moldura(`
<tr><td style="padding:28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#334155;">
<h1 style="margin:0 0 14px 0;font-size:20px;color:#0f172a;">Confirme sua inscrição</h1>
<p style="margin:0 0 12px 0;">Você pediu para receber o resumo diário do <strong>Notícia em 1 Minuto</strong>: as notícias de Itabaiana, Sergipe e do Brasil, todo dia às 7h.</p>
<p style="margin:0 0 22px 0;">Para começar a receber, confirme seu e-mail:</p>
<p style="margin:0 0 22px 0;text-align:center;"><a href="${link}" style="display:inline-block;background-color:#0057b8;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:8px;">Confirmar inscrição</a></p>
<p style="margin:0;font-size:12px;color:#64748b;">Se o botão não funcionar, copie este endereço no navegador:<br><a href="${link}" style="color:#0057b8;word-break:break-all;">${link}</a></p>
</td></tr>`,
    'Não pediu esta inscrição? Ignore este e-mail: sem a confirmação, você não recebe nada.<br>Notícia em 1 Minuto • Itabaiana/SE');
};

interface Materia { id: string; title: string; subtitle: string | null; slug: string; category: string; image_url: string; content: string; is_hero: boolean }

const emailResumo = (materias: Materia[], token: string, dataTexto: string) => {
  const cancelar = `${FUNCAO}?acao=cancelar&token=${token}`;
  const itens = materias.map((m, i) => {
    const link = `${SITE}/noticia/${encodeURIComponent(m.slug)}/`;
    const cor = corEditoria(m.category);
    const titulo = esc(tituloExibicao({ id: m.id, title: m.title, subtitle: m.subtitle || '', content: m.content || '' }));
    const destaque = i === 0;
    const imagem = m.image_url && /^https?:\/\//.test(m.image_url)
      ? (destaque
        ? `<a href="${link}"><img src="${esc(m.image_url)}" alt="" width="544" style="display:block;width:100%;max-width:544px;height:auto;border-radius:8px;margin:0 0 12px 0;"></a>`
        : `<a href="${link}"><img src="${esc(m.image_url)}" alt="" width="120" style="display:block;width:120px;height:90px;object-fit:cover;border-radius:6px;"></a>`)
      : '';
    const textos = `<div style="font-size:12px;font-weight:bold;color:${cor};">${esc(m.category)}</div>
<a href="${link}" style="display:block;margin-top:2px;font-size:${destaque ? 22 : 17}px;line-height:1.25;font-weight:bold;color:${destaque ? '#0f172a' : cor};text-decoration:none;">${titulo}</a>
${m.subtitle ? `<div style="margin-top:6px;font-size:14px;line-height:1.5;color:#475569;">${esc(m.subtitle)}</div>` : ''}`;
    return destaque
      ? `<tr><td style="padding:24px 28px 18px 28px;font-family:Arial,Helvetica,sans-serif;border-bottom:1px solid #e2e8f0;">${imagem}${textos}</td></tr>`
      : `<tr><td style="padding:16px 28px;font-family:Arial,Helvetica,sans-serif;border-bottom:1px solid #e2e8f0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="top" style="padding-right:14px;">${textos}</td>
${imagem ? `<td valign="top" width="120">${imagem}</td>` : ''}
</tr></table></td></tr>`;
  }).join('\n');
  return moldura(`
<tr><td style="padding:22px 28px 0 28px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#475569;">
<strong style="color:#0f172a;">Resumo de ${esc(dataTexto)}</strong> — ${materias.length === 1 ? '1 notícia' : `${materias.length} notícias`} em poucos minutos de leitura.
</td></tr>
${itens}
<tr><td style="padding:22px 28px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
<a href="${SITE}" style="display:inline-block;background-color:#0057b8;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:8px;">Ver todas as notícias</a>
</td></tr>`,
    `Você recebe este e-mail porque se inscreveu em noticiaem1minuto.com.br.<br>
<a href="${cancelar}" style="color:#64748b;">Cancelar inscrição</a> • Notícia em 1 Minuto • Itabaiana/SE`);
};

// ---------------------------------------------------------------- ações
async function inscrever(emailBruto: string, origem: string | null) {
  const email = (emailBruto || '').trim().toLowerCase();
  if (!EMAIL_VALIDO.test(email)) return json({ ok: false, mensagem: 'Digite um e-mail válido.' }, 400, origem);

  const { data: atual, error } = await sb.from('newsletter_subscribers').select('id, status, token, confirmacao_enviada_em').eq('email', email).maybeSingle();
  if (error) return json({ ok: false, mensagem: 'Não foi possível concluir a inscrição agora. Tente novamente em instantes.' }, 500, origem);

  if (atual?.status === 'ativo') {
    return json({ ok: true, mensagem: 'Este e-mail já recebe a newsletter. Até amanhã às 7h!' }, 200, origem);
  }
  if (atual?.status === 'pendente' && atual.confirmacao_enviada_em && Date.now() - new Date(atual.confirmacao_enviada_em).getTime() < 10 * 60 * 1000) {
    return json({ ok: true, mensagem: `Já enviamos o link de confirmação para ${email}. Veja também a caixa de spam.` }, 200, origem);
  }

  let token = atual?.token as string | undefined;
  if (atual) {
    const { error: e2 } = await sb.from('newsletter_subscribers').update({ status: 'pendente', cancelado_em: null }).eq('id', atual.id);
    if (e2) return json({ ok: false, mensagem: 'Não foi possível concluir a inscrição agora.' }, 500, origem);
  } else {
    const { data: novo, error: e3 } = await sb.from('newsletter_subscribers').insert({ email, status: 'pendente' }).select('token').single();
    if (e3) return json({ ok: false, mensagem: 'Não foi possível concluir a inscrição agora.' }, 500, origem);
    token = novo.token;
  }

  try {
    await smtp.sendMail({
      from: REMETENTE,
      to: email,
      subject: 'Confirme sua inscrição na newsletter do Notícia em 1 Minuto',
      html: emailConfirmacao(token!),
      text: `Confirme sua inscrição no resumo diário do Notícia em 1 Minuto: ${FUNCAO}?acao=confirmar&token=${token}`,
    });
  } catch (err) {
    console.error('newsletter: falha ao enviar confirmação', err);
    return json({ ok: false, mensagem: 'Não conseguimos enviar o e-mail de confirmação. Tente novamente mais tarde.' }, 502, origem);
  }
  await sb.from('newsletter_subscribers').update({ confirmacao_enviada_em: new Date().toISOString() }).eq('email', email);
  return json({ ok: true, mensagem: `Quase lá! Enviamos um link de confirmação para ${email}. Veja também a caixa de spam.` }, 200, origem);
}

async function mudarStatus(acao: 'confirmar' | 'cancelar', token: string | null) {
  if (!token || !UUID.test(token)) return voltarAoSite('invalido');
  const { data } = await sb.from('newsletter_subscribers').select('id, status').eq('token', token).maybeSingle();
  if (!data) return voltarAoSite('invalido');
  if (acao === 'confirmar') {
    if (data.status !== 'ativo') {
      await sb.from('newsletter_subscribers').update({ status: 'ativo', confirmado_em: new Date().toISOString(), cancelado_em: null }).eq('id', data.id);
    }
    return voltarAoSite('confirmada');
  }
  await sb.from('newsletter_subscribers').update({ status: 'cancelado', cancelado_em: new Date().toISOString() }).eq('id', data.id);
  return voltarAoSite('cancelada');
}

// Corte do dia: 10:00 UTC (07:00 em Itabaiana). Todos os lotes do dia usam a mesma janela.
function janelaDoDia(agora = new Date()) {
  const corte = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 10, 0, 0));
  if (agora < corte) corte.setUTCDate(corte.getUTCDate() - 1);
  const inicio = new Date(corte.getTime() - 24 * 60 * 60 * 1000);
  return { inicio, corte };
}

async function enviarLote(origem: string | null, somentePara?: string) {
  const { inicio, corte } = janelaDoDia();
  let busca = sb.from('articles')
    .select('id, title, subtitle, slug, category, image_url, content, is_hero, views_count, created_at')
    .eq('status', 'published');
  // Envio de teste (um único endereço): usa as notícias mais recentes, sem o recorte das 24 horas
  busca = somentePara
    ? busca.order('created_at', { ascending: false }).limit(8)
    : busca.gte('created_at', inicio.toISOString()).lt('created_at', corte.toISOString())
        .order('is_hero', { ascending: false }).order('created_at', { ascending: false }).limit(10);
  const { data: materias, error: eM } = await busca;
  if (eM) return json({ ok: false, erro: eM.message }, 500, origem);
  if (!materias || materias.length === 0) {
    return json({ ok: true, materias: 0, enviados: 0, observacao: 'Nenhuma notícia publicada nas últimas 24 horas: nada enviado.' }, 200, origem);
  }

  let consulta = sb.from('newsletter_subscribers').select('id, email, token').eq('status', 'ativo');
  if (somentePara) consulta = consulta.eq('email', somentePara.toLowerCase());
  else consulta = consulta.or(`ultimo_envio_em.is.null,ultimo_envio_em.lt.${corte.toISOString()}`);
  const { data: inscritos, error: eI } = await consulta.limit(LOTE);
  if (eI) return json({ ok: false, erro: eI.message }, 500, origem);
  if (!inscritos || inscritos.length === 0) return json({ ok: true, materias: materias.length, enviados: 0, observacao: 'Todos os inscritos já receberam o resumo de hoje.' }, 200, origem);

  const dataTexto = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bahia' }).format(corte);
  let enviados = 0, falhas = 0;
  for (const p of inscritos) {
    try {
      await smtp.sendMail({
        from: REMETENTE,
        to: p.email,
        subject: `${tituloExibicao({ id: materias[0].id, title: materias[0].title, subtitle: materias[0].subtitle || '', content: materias[0].content || '' })} e mais notícias de hoje`,
        html: emailResumo(materias as Materia[], p.token, dataTexto),
        text: materias.map(m => `${m.title}\n${SITE}/noticia/${m.slug}/`).join('\n\n') + `\n\nCancelar inscrição: ${FUNCAO}?acao=cancelar&token=${p.token}`,
        headers: {
          'List-Unsubscribe': `<${FUNCAO}?acao=cancelar&token=${p.token}>`,
        },
      });
      enviados++;
      if (!somentePara) await sb.from('newsletter_subscribers').update({ ultimo_envio_em: new Date().toISOString() }).eq('id', p.id);
    } catch (err) {
      falhas++;
      console.error('newsletter: falha ao enviar para um inscrito', err);
    }
  }
  await sb.from('newsletter_envios').insert({
    materias: materias.length, destinatarios: inscritos.length, enviados, falhas,
    observacao: somentePara ? `teste para ${somentePara}` : null,
  });
  return json({ ok: true, materias: materias.length, enviados, falhas }, 200, origem);
}

Deno.serve(async (req) => {
  const origem = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origem) });

  const url = new URL(req.url);
  if (req.method === 'GET') {
    const acao = url.searchParams.get('acao');
    if (acao === 'confirmar' || acao === 'cancelar') return mudarStatus(acao, url.searchParams.get('token'));
    return voltarAoSite('invalido');
  }

  if (req.method === 'POST') {
    let corpo: any = {};
    try { corpo = await req.json(); } catch { /* corpo vazio */ }
    if (corpo.acao === 'inscrever') return inscrever(corpo.email, origem);
    if (corpo.acao === 'enviar') {
      const segredo = Deno.env.get('NEWSLETTER_CRON_SECRET');
      if (!segredo || req.headers.get('x-newsletter-secret') !== segredo) return json({ ok: false }, 401, origem);
      return enviarLote(origem, typeof corpo.somentePara === 'string' ? corpo.somentePara : undefined);
    }
  }
  return json({ ok: false, mensagem: 'Ação inválida.' }, 400, origem);
});
