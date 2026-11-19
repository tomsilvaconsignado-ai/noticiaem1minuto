import React from 'react';
import { Play, Timer } from 'lucide-react';
import { Article } from '../../types/database';
import { corEditoria, tituloExibicao, minutosDeLeitura } from '../../lib/editorias';

interface ArticleCardProps {
  article: Article;
  variant?: 'hero' | 'secondary' | 'feed' | 'compact';
  onSelectArticle: (article: Article) => void;
  // Manchete: notícias da mesma editoria listadas na faixa abaixo da foto
  relacionadas?: Article[];
  // Mais lidas: posição no ranking
  posicao?: number;
}

// Formatação amigável de tempo em português
export const formatRelativeTime = (isoDate: string): string => {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return 'há poucos minutos';
  if (diffHours === 1) return 'há cerca de 1 hora';
  if (diffHours < 24) return `há cerca de ${diffHours} horas`;
  if (diffDays === 1) return 'há 1 dia';
  if (diffDays < 30) return `há ${diffDays} dias`;
  return new Date(isoDate).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const Leitura: React.FC<{ article: Article; className?: string }> = ({ article, className = '' }) => (
  <span className={`inline-flex items-center gap-1 ${className}`}>
    <Timer className="w-3.5 h-3.5" aria-hidden="true" />
    {minutosDeLeitura(article)} min de leitura
  </span>
);

const SeloVideo: React.FC = () => (
  <span className="absolute left-3 bottom-3 inline-flex items-center gap-1 px-2 py-1 rounded bg-black/75 text-white text-xs font-semibold">
    <Play className="w-3 h-3 fill-current" aria-hidden="true" /> Vídeo
  </span>
);

export const ArticleCard: React.FC<ArticleCardProps> = ({
  article,
  variant = 'feed',
  onSelectArticle,
  relacionadas = [],
  posicao
}) => {
  const abrir = (a: Article) => (e: React.MouseEvent) => {
    e.preventDefault();
    onSelectArticle(a);
  };
  const cor = corEditoria(article.category);
  const titulo = tituloExibicao(article);
  const href = `/noticia/${article.slug}`;

  // 1. MANCHETE: foto grande com o título por cima e faixa de relacionadas na cor da editoria
  if (variant === 'hero') {
    return (
      <article className="overflow-hidden rounded-lg bg-gray-900">
        <a href={href} onClick={abrir(article)} className="chamada group relative block aspect-[4/3] sm:aspect-[16/11] lg:aspect-square cursor-pointer">
          <img
            alt=""
            src={article.imageUrl}
            fetchPriority="high"
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent" />
          {article.isVideo && <span className="absolute top-4 left-4"><span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-black/75 text-white text-xs font-semibold"><Play className="w-3 h-3 fill-current" aria-hidden="true" /> Vídeo</span></span>}
          <div className="absolute inset-x-0 bottom-0 p-5 md:p-7">
            <span className="rotulo-editoria inline-block mb-3 px-2 py-0.5 rounded text-sm text-white" style={{ backgroundColor: cor }}>
              {article.category}
            </span>
            <h2 className="titulo titulo-manchete text-white group-hover:underline decoration-2 underline-offset-4">
              {titulo}
            </h2>
          </div>
        </a>
        {relacionadas.length > 0 && (
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2 px-5 md:px-7 py-4 text-white" style={{ backgroundColor: cor }}>
            {relacionadas.slice(0, 2).map(r => (
              <li key={r.id} className="flex gap-2">
                <span className="mt-2 w-1.5 h-1.5 rounded-full bg-white/80 shrink-0" aria-hidden="true" />
                <a href={`/noticia/${r.slug}`} onClick={abrir(r)} className="chamada titulo text-[17px] leading-snug hover:underline cursor-pointer">
                  {tituloExibicao(r)}
                </a>
              </li>
            ))}
          </ul>
        )}
      </article>
    );
  }

  // 2. CHAMADA: foto em cima, título na cor da editoria
  if (variant === 'secondary') {
    return (
      <article>
        <a href={href} onClick={abrir(article)} className="chamada group block cursor-pointer">
          <div className="relative aspect-[16/10] overflow-hidden rounded-lg bg-gray-100">
            <img
              alt=""
              loading="lazy"
              src={article.imageUrl}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            />
            {article.isVideo && <SeloVideo />}
          </div>
          <span className="rotulo-editoria block mt-3 text-sm" style={{ color: cor }}>{article.category}</span>
          <h3 className="titulo text-[1.375rem] mt-1 group-hover:underline decoration-2 underline-offset-2" style={{ color: cor }}>
            {titulo}
          </h3>
          {article.subtitle && (
            <p className="mt-2 text-[15px] leading-relaxed text-gray-700 line-clamp-2">{article.subtitle}</p>
          )}
          <p className="mt-2 text-[13px] text-gray-500 flex flex-wrap gap-x-3">
            <span>{formatRelativeTime(article.createdAt)}</span>
            <Leitura article={article} />
          </p>
        </a>
      </article>
    );
  }

  // 3. LISTA: foto pequena à esquerda, título colorido
  if (variant === 'feed') {
    return (
      <article className="border-b border-gray-200 last:border-0">
        <a href={href} onClick={abrir(article)} className="chamada group flex gap-4 py-4 cursor-pointer">
          <div className="relative w-28 sm:w-40 aspect-[4/3] shrink-0 overflow-hidden rounded-md bg-gray-100">
            <img alt="" loading="lazy" src={article.imageUrl} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
            {article.isVideo && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                <Play className="w-6 h-6 text-white fill-current" aria-label="Vídeo" />
              </span>
            )}
          </div>
          <div className="min-w-0">
            <span className="rotulo-editoria text-[13px]" style={{ color: cor }}>{article.category}</span>
            <h3 className="titulo text-lg sm:text-xl mt-0.5 group-hover:underline decoration-2 underline-offset-2" style={{ color: cor }}>
              {titulo}
            </h3>
            <p className="mt-1.5 text-[13px] text-gray-500 flex flex-wrap gap-x-3">
              <span>{formatRelativeTime(article.createdAt)}</span>
              <Leitura article={article} />
            </p>
          </div>
        </a>
      </article>
    );
  }

  // 4. MAIS LIDAS: ranking numerado
  return (
    <article className="border-b border-gray-200 last:border-0">
      <a href={href} onClick={abrir(article)} className="chamada group flex gap-4 py-3.5 cursor-pointer">
        {posicao !== undefined && (
          <span className="titulo text-4xl leading-none text-marca-escuro/25 w-7 shrink-0 text-right" aria-hidden="true">{posicao}</span>
        )}
        <div className="min-w-0">
          <span className="rotulo-editoria text-[13px]" style={{ color: cor }}>{article.category}</span>
          <h4 className="titulo text-[17px] text-gray-900 group-hover:underline decoration-2 underline-offset-2">{titulo}</h4>
        </div>
      </a>
    </article>
  );
};
