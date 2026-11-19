import type { Article } from '../types/database';

// Cor de cada editoria. Todas têm contraste de pelo menos 4,5:1 sobre branco,
// então servem para o título da notícia (texto) e como fundo de faixas com texto branco.
const CORES: Record<string, string> = {
  urgente: '#c40d2e',
  cidades: '#0057b8',
  cidade: '#0057b8',
  politica: '#7a2e8e',
  brasil: '#00695c',
  mundo: '#3d4f7a',
  esporte: '#127a3a',
  esportes: '#127a3a',
  entretenimento: '#c2410c',
  nutricao: '#4d7c0f',
  'mensagem-de-fe': '#92400e',
  videos: '#be123c',
  classificados: '#b45309',
  'midia-impressa': '#b91c1c',
};
const COR_PADRAO = '#0057b8';

export const slugEditoria = (nome: string): string =>
  (nome || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

export const corEditoria = (nomeOuSlug: string): string => CORES[slugEditoria(nomeOuSlug)] || COR_PADRAO;

// ---------------------------------------------------------------------------
// Títulos escritos em CAIXA ALTA viram frase normal na exibição. Nomes próprios e
// siglas são recuperados do próprio texto da matéria (ex.: "Léo Wander", "STJ").
// O título salvo no banco não muda.
// ---------------------------------------------------------------------------
const LETRA = /\p{L}/u;
const MAIUSCULA = /\p{Lu}/u;

const estaEmCaixaAlta = (texto: string): boolean => {
  const letras = [...texto].filter(c => LETRA.test(c));
  if (letras.length < 8) return false;
  const maiusculas = letras.filter(c => MAIUSCULA.test(c)).length;
  return maiusculas / letras.length > 0.8;
};

const semTags = (html: string) => (html || '').replace(/<[^>]+>/g, ' ');

// Reserva para nomes que o texto da matéria nem sempre traz com maiúscula
const NOMES_CONHECIDOS = [
  // Só nomes que não são também palavras comuns (nada de "Dias", "São", "Campo", "Rio")
  'Itabaiana', 'Itabaianense', 'Aracaju', 'Sergipe', 'Lagarto', 'Estância', 'Propriá', 'Malhador', 'Macambira',
  'Ribeirópolis', 'Brasil', 'Brasília', 'Bahia', 'Alagoas', 'Pernambuco', 'Paraíba', 'Ceará', 'Piauí', 'Maranhão',
  'Goiás', 'Paraná', 'Salvador', 'Recife', 'Maceió', 'Nordeste', 'Amazonas', 'Irã', 'Israel', 'Gaza', 'Ucrânia',
  'Rússia', 'China', 'Venezuela', 'Argentina', 'Europa', 'Deus', 'Jesus', 'Cristo', 'Páscoa', 'Lula', 'Bolsonaro', 'Trump',
].reduce((m, n) => m.set(n.toLocaleLowerCase('pt-BR'), n), new Map<string, string>());
// Preposições que não ganham maiúscula mesmo quando aparecem assim no texto
const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'no', 'na']);

// Mapa palavra minúscula -> grafia preferida no texto (só guarda nomes próprios e siglas)
function grafiasDoTexto(texto: string): Map<string, string> {
  const contagem = new Map<string, Map<string, number>>();
  // Divide em frases para ignorar a palavra que só está maiúscula por abrir a frase
  for (const frase of texto.split(/[.!?\n:]+/)) {
    const palavras = frase.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
    palavras.forEach((p, i) => {
      if (i === 0) return;
      const chave = p.toLocaleLowerCase('pt-BR');
      const formas = contagem.get(chave) || new Map<string, number>();
      formas.set(p, (formas.get(p) || 0) + 1);
      contagem.set(chave, formas);
    });
  }
  const resultado = new Map<string, string>();
  for (const [chave, formas] of contagem) {
    let melhor = '', max = 0;
    for (const [forma, n] of formas) if (n > max) { melhor = forma; max = n; }
    if (melhor !== chave && MAIUSCULA.test(melhor[0])) resultado.set(chave, melhor);
  }
  return resultado;
}

const cacheTitulos = new Map<string, string>();

export function tituloExibicao(article: Pick<Article, 'id' | 'title' | 'subtitle' | 'content'>): string {
  const titulo = (article.title || '').trim();
  if (!estaEmCaixaAlta(titulo)) return titulo;
  const chaveCache = `${article.id}|${titulo}`;
  const emCache = cacheTitulos.get(chaveCache);
  if (emCache) return emCache;

  const grafias = grafiasDoTexto(`${article.subtitle || ''}\n${semTags(article.content).slice(0, 6000)}`);
  let inicioDeFrase = true;
  const convertido = titulo.replace(/[\p{L}\p{N}][\p{L}\p{N}'’-]*|[^\p{L}\p{N}]+/gu, (trecho) => {
    if (!LETRA.test(trecho) && !/\p{N}/u.test(trecho)) {
      if (/[.!?]/.test(trecho)) inicioDeFrase = true;
      return trecho;
    }
    const minuscula = trecho.toLocaleLowerCase('pt-BR');
    // Siglas curtas sem vogal (PGR, STJ) ou com número (AL-220) ficam como estão
    const pareceSigla = /\d/.test(trecho) || (trecho.length <= 4 && !/[aeiouáéíóúâêôãõ]/i.test(minuscula));
    let saida = grafias.get(minuscula)
      || (MINUSCULAS.has(minuscula) ? minuscula : NOMES_CONHECIDOS.get(minuscula))
      || (pareceSigla ? trecho : minuscula);
    if (inicioDeFrase) saida = saida.charAt(0).toLocaleUpperCase('pt-BR') + saida.slice(1);
    inicioDeFrase = false;
    return saida;
  });
  cacheTitulos.set(chaveCache, convertido);
  return convertido;
}

// Tempo de leitura (200 palavras por minuto), no mínimo 1 minuto
export function minutosDeLeitura(article: Pick<Article, 'content'>): number {
  const palavras = semTags(article.content).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(palavras / 200));
}

// ID de vídeo do YouTube a partir de qualquer formato de link (watch?v=, youtu.be, shorts, embed)
export function idDoYoutube(url?: string): string | null {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
