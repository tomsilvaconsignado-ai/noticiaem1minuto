import { Article, AdItem, CategoryItem } from '../types/database';
import backup from './backupArticles.json';

export const INITIAL_CATEGORIES: CategoryItem[] = [
  { id: '1', name: 'Início', slug: 'todos' },
  { id: '2', name: 'Urgente', slug: 'urgente' },
  { id: '3', name: 'Cidades', slug: 'cidades' },
  { id: '4', name: 'Política', slug: 'politica' },
  { id: '5', name: 'Brasil', slug: 'brasil' },
  { id: '6', name: 'Mundo', slug: 'mundo' },
  { id: '7', name: 'Esporte', slug: 'esporte' },
  { id: '8', name: 'Entretenimento', slug: 'entretenimento' },
  { id: '9', name: 'Nutrição', slug: 'nutricao' },
  { id: '10', name: 'Mensagem de Fé', slug: 'mensagem-de-fe' },
  { id: '11', name: 'Vídeos', slug: 'videos' },
  { id: '12', name: 'Classificados', slug: 'classificados' },
  { id: '13', name: 'Mídia Impressa', slug: 'midia-impressa' },
];

export const PROJECT_ARTICLES: Article[] = [];

// Matérias do portal original que faltavam no projeto (gerado por scripts/build_articles_seed.ts).
// As matérias do projeto usam a data real de publicação quando ela consta no backup.
export const INITIAL_ARTICLES: Article[] = [
  ...PROJECT_ARTICLES.map(a => {
    const publishedAt = (backup.publishedAt as Record<string, string>)[a.slug];
    return publishedAt ? { ...a, createdAt: publishedAt, updatedAt: publishedAt } : a;
  }),
  ...(backup.articles as Article[])
].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

// Arte provisória dos painéis 300x300 adicionais, até o administrador cadastrar os anunciantes
const ANUNCIE_AQUI_300X300 = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="300" height="300" fill="#0057b8"/><rect x="12" y="12" width="276" height="276" rx="14" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2" stroke-dasharray="8 6"/><text x="150" y="92" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="13" font-weight="700" letter-spacing="3" fill="#bfdbfe">ESPAÇO DISPONÍVEL</text><text x="150" y="146" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="38" font-weight="900" fill="#ffffff">ANUNCIE</text><text x="150" y="188" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="38" font-weight="900" fill="#ffffff">AQUI</text><text x="150" y="226" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="700" fill="#ffffff">(79) 99963-8993</text><text x="150" y="252" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="11" fill="#bfdbfe">Notícia em 1 Minuto</text></svg>')}`;

export const INITIAL_ADS: AdItem[] = [
  {
    id: 'ad-side2-1',
    title: 'Anuncie Conosco — Notícia em 1 Minuto',
    sponsorName: 'Notícia em 1 Minuto',
    linkUrl: 'https://wa.me/5579999638993',
    mediaUrl: ANUNCIE_AQUI_300X300,
    mediaType: 'image',
    placement: 'sidebar_300x300_2',
    adFormat: '300x300',
    aspectRatio: '1 / 1',
    width: 300,
    height: 300,
    maxWidth: 300,
    active: true,
    status: 'active',
    displayOrder: 1,
    durationSeconds: 5,
    openInNewTab: true,
    altText: 'Anuncie no Notícia em 1 Minuto',
    campaignName: 'Espaço lateral 300x300 (2)',
    impressionsCount: 0,
    clicksCount: 0,
    createdAt: new Date().toISOString()
  },
  {
    id: 'ad-side3-1',
    title: 'Anuncie Conosco — Notícia em 1 Minuto',
    sponsorName: 'Notícia em 1 Minuto',
    linkUrl: 'https://wa.me/5579999638993',
    mediaUrl: ANUNCIE_AQUI_300X300,
    mediaType: 'image',
    placement: 'sidebar_300x300_3',
    adFormat: '300x300',
    aspectRatio: '1 / 1',
    width: 300,
    height: 300,
    maxWidth: 300,
    active: true,
    status: 'active',
    displayOrder: 1,
    durationSeconds: 5,
    openInNewTab: true,
    altText: 'Anuncie no Notícia em 1 Minuto',
    campaignName: 'Espaço lateral 300x300 (3)',
    impressionsCount: 0,
    clicksCount: 0,
    createdAt: new Date().toISOString()
  }
];
