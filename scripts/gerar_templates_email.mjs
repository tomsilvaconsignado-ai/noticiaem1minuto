// Gera os modelos de e-mail de segurança do Supabase Auth em supabase/templates/,
// no mesmo visual de password_changed_notification.html.
// Uso: node scripts/gerar_templates_email.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve('supabase', 'templates');
const base = readFileSync(path.join(dir, 'password_changed_notification.html'), 'utf8');

const SUPORTE = 'fale com a gente pelo WhatsApp <strong>(79) 99963-8993</strong> ou pelo e-mail <strong>noticiasem1minutoitabaiana@gmail.com</strong>';
const p = (t) => `<p style="margin:0 0 12px 0;">${t}</p>`;

const modelos = {
  reauthentication: {
    titulo: 'Seu código de verificação',
    rotulo: 'Confirmação de identidade',
    corpo: [
      p('Olá!'),
      p('Use o código abaixo para confirmar que é você no Notícia em 1 Minuto. Ele vale por poucos minutos.'),
      `<div style="margin:20px 0;padding:18px;text-align:center;background-color:#eff6ff;border:1px dashed #0057b8;border-radius:10px;font-family:'Courier New',monospace;font-size:30px;font-weight:700;letter-spacing:8px;color:#002f6c;">{{ .Token }}</div>`,
      p('Não compartilhe este código com ninguém. Nossa equipe nunca pede esse código.'),
    ],
    alerta: `<strong>Não pediu este código?</strong> Ignore esta mensagem. Se receber vários sem ter pedido, troque sua senha e ${SUPORTE}.`,
  },
  email_changed_notification: {
    titulo: 'Seu e-mail de acesso foi alterado',
    rotulo: 'Aviso de segurança',
    corpo: [
      p('Olá!'),
      p('O e-mail da sua conta no Notícia em 1 Minuto foi alterado de <strong>{{ .OldEmail }}</strong> para <strong>{{ .Email }}</strong>.'),
      p('Se foi você, não precisa fazer nada.'),
    ],
    alerta: `<strong>Não foi você?</strong> Sua conta pode estar em risco: ${SUPORTE} imediatamente.`,
  },
  phone_changed_notification: {
    titulo: 'Seu telefone foi alterado',
    rotulo: 'Aviso de segurança',
    corpo: [
      p('Olá!'),
      p('O telefone da sua conta <strong>{{ .Email }}</strong> no Notícia em 1 Minuto foi alterado de <strong>{{ .OldPhone }}</strong> para <strong>{{ .Phone }}</strong>.'),
      p('Se foi você, não precisa fazer nada.'),
    ],
    alerta: `<strong>Não foi você?</strong> Troque sua senha pelo "Esqueci minha senha" e ${SUPORTE}.`,
  },
  identity_linked_notification: {
    titulo: 'Nova forma de entrar na sua conta',
    rotulo: 'Aviso de segurança',
    corpo: [
      p('Olá!'),
      p('Sua conta <strong>{{ .Email }}</strong> no Notícia em 1 Minuto agora também pode ser acessada com <strong>{{ .Provider }}</strong>.'),
      p('Se foi você, não precisa fazer nada.'),
    ],
    alerta: `<strong>Não foi você?</strong> Troque sua senha pelo "Esqueci minha senha" e ${SUPORTE}.`,
  },
  identity_unlinked_notification: {
    titulo: 'Uma forma de entrar foi removida',
    rotulo: 'Aviso de segurança',
    corpo: [
      p('Olá!'),
      p('O acesso com <strong>{{ .Provider }}</strong> foi removido da sua conta <strong>{{ .Email }}</strong> no Notícia em 1 Minuto.'),
      p('Se foi você, não precisa fazer nada.'),
    ],
    alerta: `<strong>Não foi você?</strong> Troque sua senha pelo "Esqueci minha senha" e ${SUPORTE}.`,
  },
  mfa_factor_enrolled_notification: {
    titulo: 'Verificação em duas etapas ativada',
    rotulo: 'Aviso de segurança',
    corpo: [
      p('Olá!'),
      p('Um novo método de verificação (<strong>{{ .FactorType }}</strong>) foi adicionado à sua conta <strong>{{ .Email }}</strong> no Notícia em 1 Minuto.'),
      p('Se foi você, sua conta ficou mais protegida e não precisa fazer mais nada.'),
    ],
    alerta: `<strong>Não foi você?</strong> Troque sua senha pelo "Esqueci minha senha" e ${SUPORTE}.`,
  },
  mfa_factor_unenrolled_notification: {
    titulo: 'Método de verificação removido',
    rotulo: 'Aviso de segurança',
    corpo: [
      p('Olá!'),
      p('O método de verificação <strong>{{ .FactorType }}</strong> foi removido da sua conta <strong>{{ .Email }}</strong> no Notícia em 1 Minuto.'),
      p('Se foi você, não precisa fazer nada.'),
    ],
    alerta: `<strong>Não foi você?</strong> Troque sua senha pelo "Esqueci minha senha" e ${SUPORTE}.`,
  },
};

// Trechos do modelo-base que mudam em cada e-mail
const reTitle = /<title>[^<]*<\/title>/;
const reRotulo = /(text-transform:uppercase;color:#94a3b8;padding-top:4px;">)[^<]*(<\/div>)/;
const reCorpo = /(<h1 [^>]*>)[^<]*(<\/h1>)[\s\S]*?(\n\s*<\/td>\n\s*<\/tr>\n\s*<tr>\n\s*<td style="padding:0 32px 28px 32px;">)/;
const reAlerta = /(color:#92400e;">)[\s\S]*?(<\/td>)/;
for (const re of [reTitle, reRotulo, reCorpo, reAlerta]) if (!re.test(base)) throw new Error('Modelo-base mudou: ' + re);

for (const [nome, m] of Object.entries(modelos)) {
  const html = base
    .replace(reTitle, `<title>${m.titulo} — Notícia em 1 Minuto</title>`)
    .replace(reRotulo, `$1${m.rotulo}$2`)
    .replace(reCorpo, (_, h1a, h1b, resto) => `${h1a}${m.titulo}${h1b}\n              ${m.corpo.join('\n              ')}${resto}`)
    .replace(reAlerta, `$1${m.alerta}$2`);
  writeFileSync(path.join(dir, `${nome}.html`), html);
  console.log('gerado:', `${nome}.html`);
}
