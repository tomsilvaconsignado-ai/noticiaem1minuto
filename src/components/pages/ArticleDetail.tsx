import React, { useState, useEffect } from 'react';
import { ArrowLeft, Share2, Eye, MessageSquare, Send, Check, Link2, Play } from 'lucide-react';
import { Article, Comment, UserProfile, AdItem } from '../../types/database';
import { commentsService, newsService } from '../../lib/supabase';
import { ArticleCard, formatRelativeTime, Leitura } from '../news/ArticleCard';
import { AdSlot } from '../news/AdSlot';
import { formatarMateria } from '../../lib/assets';
import { corEditoria, tituloExibicao, idDoYoutube } from '../../lib/editorias';
import { getArticleCanonicalUrl, getArticlePathKey, getWhatsAppShareData, updateClientHeadForArticle } from '../../lib/seo';
import { hasShareablePhoto, usePreviewStatus, PREVIEW_PENDING_MESSAGE } from '../../lib/share';

interface ArticleDetailProps {
  article: Article;
  allArticles: Article[];
  currentUser: UserProfile | null;
  onOpenAuth: () => void;
  onBack: () => void;
  onSelectArticle: (article: Article) => void;
  articleAd?: AdItem;
  articleAds?: AdItem[];
}

// Vídeo que não é do YouTube não pode ser incorporado: mostra a foto e um link para a rede de origem
const redeDoVideo = (url?: string): string | null => {
  if (!url) return null;
  if (/instagram\.com/i.test(url)) return 'Instagram';
  if (/tiktok\.com/i.test(url)) return 'TikTok';
  if (/facebook\.com|fb\.watch/i.test(url)) return 'Facebook';
  return null;
};

export const ArticleDetail: React.FC<ArticleDetailProps> = ({
  article,
  allArticles,
  currentUser,
  onOpenAuth,
  onBack,
  onSelectArticle,
  articleAd,
  articleAds
}) => {
  const [fontSize, setFontSize] = useState<'normal' | 'large' | 'xlarge'>('normal');
  const [copied, setCopied] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  useEffect(() => {
    // Rola para o topo ao abrir notícia
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Atualiza metadados dinâmicos e título no cliente
    updateClientHeadForArticle(article);
    // Incrementa contagem de visualizações
    newsService.incrementViews(article.id);
    // Carrega comentários
    commentsService.getComments(article.id).then(setComments);
  }, [article.id]);

  // Só compartilha matéria publicada, com foto e título, cuja página do link já mostra a prévia completa
  const shareBlockReason =
    article.status === 'draft' ? 'Esta matéria é um rascunho e ainda não pode ser compartilhada.'
    : !article.title?.trim() ? 'A matéria precisa de um título para ser compartilhada.'
    : !hasShareablePhoto(article.imageUrl) ? 'A matéria precisa de uma foto para ser compartilhada.'
    : null;
  const preview = usePreviewStatus(getArticleCanonicalUrl(getArticlePathKey(article)), article.title ? tituloExibicao(article) : '', !shareBlockReason);

  const handleShare = async (platform: 'whatsapp' | 'facebook' | 'twitter' | 'copy') => {
    if (shareBlockReason) {
      alert(shareBlockReason);
      return;
    }
    if (preview.status !== 'ready') {
      // Confere de novo: o deploy pode ter terminado desde a abertura da matéria
      if (!(await preview.recheck())) {
        alert(PREVIEW_PENDING_MESSAGE);
        return;
      }
    }

    const canonicalUrl = getArticleCanonicalUrl(getArticlePathKey(article));
    const title = article.title.trim();

    if (platform === 'whatsapp') {
      const shareData = getWhatsAppShareData(article);
      window.open(shareData.whatsappUrl, '_blank', 'noopener,noreferrer');
    } else if (platform === 'facebook') {
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(canonicalUrl)}`, '_blank', 'noopener,noreferrer');
    } else if (platform === 'twitter') {
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(canonicalUrl)}`, '_blank', 'noopener,noreferrer');
    } else if (platform === 'copy') {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(canonicalUrl);
        } else {
          const input = document.createElement('input');
          input.value = canonicalUrl;
          document.body.appendChild(input);
          input.select();
          document.execCommand('copy');
          document.body.removeChild(input);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 3500);
      } catch (err) {
        console.warn('Erro ao copiar link da notícia:', err);
      }
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || !currentUser) return;

    setSubmittingComment(true);
    try {
      const created = await commentsService.addComment(article.id, newComment.trim(), currentUser);
      setComments([created, ...comments]);
      setNewComment('');
    } catch (err: any) {
      alert(err?.message || 'Não foi possível publicar o comentário.');
    } finally {
      setSubmittingComment(false);
    }
  };

  const relatedArticles = allArticles
    .filter(a => a.id !== article.id && a.category === article.category)
    .slice(0, 3);

  const formattedDate = new Date(article.createdAt).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const cor = corEditoria(article.category);
  const titulo = tituloExibicao(article);
  const youtubeId = idDoYoutube(article.videoUrl);
  const rede = youtubeId ? null : redeDoVideo(article.videoUrl);

  return (
    <div className="container mx-auto px-4 pt-6 pb-16">
      <div className="max-w-3xl mx-auto">
        {/* Voltar e tamanho do texto */}
        <div className="flex items-center justify-between gap-4 mb-8">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-marca cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </button>
          <div className="flex items-center gap-1" role="group" aria-label="Tamanho do texto">
            {([['normal', 'A', 'text-sm'], ['large', 'A', 'text-base'], ['xlarge', 'A', 'text-lg']] as const).map(([valor, letra, tamanho], i) => (
              <button
                key={valor}
                onClick={() => setFontSize(valor)}
                aria-pressed={fontSize === valor}
                aria-label={['Texto normal', 'Texto grande', 'Texto maior'][i]}
                className={`w-8 h-8 rounded-md font-semibold cursor-pointer ${tamanho} ${fontSize === valor ? 'bg-marca text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                {letra}
              </button>
            ))}
          </div>
        </div>

        <article>
          <header>
            <p className="rotulo-editoria text-base" style={{ color: cor }}>
              {article.category}
            </p>
            <h1 className="titulo text-[2rem] md:text-5xl leading-[1.05] text-gray-950 mt-2">
              {titulo}
            </h1>
            {article.subtitle && (
              <p className="mt-4 text-lg md:text-xl leading-relaxed text-gray-600">
                {article.subtitle}
              </p>
            )}

            <div className="mt-6 pt-4 border-t border-gray-200 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-sm text-gray-600">
              <div>
                <p className="font-semibold text-gray-900">{article.author}</p>
                <p className="flex flex-wrap gap-x-3">
                  <time dateTime={article.createdAt}>{formattedDate}</time>
                  <Leitura article={article} />
                  <span className="inline-flex items-center gap-1"><Eye className="w-3.5 h-3.5" aria-hidden="true" />{article.viewsCount.toLocaleString('pt-BR')}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleShare('whatsapp')}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#1f8f4e] hover:bg-[#177a41] text-white font-semibold cursor-pointer"
                >
                  <Share2 className="w-4 h-4" /> WhatsApp
                </button>
                <button
                  onClick={() => handleShare('copy')}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full border font-medium cursor-pointer ${copied ? 'border-emerald-600 text-emerald-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
                  aria-live="polite"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
                  {copied ? 'Link copiado' : 'Copiar link'}
                </button>
              </div>
            </div>
            {(shareBlockReason || preview.status === 'pending') && (
              <p className="mt-2 text-sm text-amber-800">
                {shareBlockReason || 'A prévia com foto e título ainda está sendo gerada. O compartilhamento é liberado em alguns minutos.'}
              </p>
            )}
          </header>
        </article>
      </div>

      {/* Foto ou vídeo, um pouco mais largo que o texto */}
      <figure className="max-w-4xl mx-auto mt-8">
        {youtubeId ? (
          <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${youtubeId}`}
              title={titulo}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-lg bg-gray-100">
            <img src={article.imageUrl} alt="" className="w-full h-auto max-h-[560px] object-cover" />
            {rede && article.videoUrl && (
              <a
                href={article.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute inset-0 flex items-center justify-center bg-black/35 hover:bg-black/45 transition-colors"
              >
                <span className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white text-gray-900 font-semibold shadow-lg">
                  <Play className="w-5 h-5 fill-current" /> Assistir no {rede}
                </span>
              </a>
            )}
          </div>
        )}
      </figure>

      <div className="max-w-3xl mx-auto">
        {/* Texto da matéria */}
        <div
          className={`materia-texto mt-8 ${
            fontSize === 'large' ? 'text-xl' : fontSize === 'xlarge' ? 'text-2xl' : 'text-lg'
          }`}
          dangerouslySetInnerHTML={{ __html: formatarMateria(article.content) }}
        />

        {/* Compartilhar no fim da leitura */}
        <div className="mt-10 py-5 border-y border-gray-200 flex flex-wrap items-center gap-3">
          <span className="font-semibold text-gray-900 mr-2">Compartilhe</span>
          <button onClick={() => handleShare('whatsapp')} className="px-4 py-2 rounded-full bg-[#1f8f4e] hover:bg-[#177a41] text-white text-sm font-semibold cursor-pointer">WhatsApp</button>
          <button onClick={() => handleShare('facebook')} className="px-4 py-2 rounded-full bg-[#1877f2] hover:bg-[#1465d0] text-white text-sm font-semibold cursor-pointer">Facebook</button>
          <button onClick={() => handleShare('twitter')} className="px-4 py-2 rounded-full bg-gray-900 hover:bg-black text-white text-sm font-semibold cursor-pointer">X</button>
          <button onClick={() => handleShare('copy')} className="px-4 py-2 rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-semibold cursor-pointer">
            {copied ? 'Link copiado' : 'Copiar link'}
          </button>
        </div>

        {/* Publicidade dentro da matéria */}
        <div className="my-10 flex justify-center">
          <AdSlot placement="article" ads={articleAds} ad={articleAd} />
        </div>

        {/* Comentários */}
        <section className="mt-4" aria-labelledby="comentarios">
          <h2 id="comentarios" className="titulo text-2xl text-gray-900 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-marca" aria-hidden="true" />
            Comentários{comments.length > 0 ? ` (${comments.length})` : ''}
          </h2>

          {currentUser ? (
            <form onSubmit={handleAddComment} className="mt-5">
              <label htmlFor="novo-comentario" className="text-sm text-gray-600">
                Comentando como <strong className="text-gray-900">{currentUser.fullName}</strong>
              </label>
              <textarea
                id="novo-comentario"
                required
                rows={3}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="O que você achou desta notícia?"
                className="mt-2 w-full p-3 bg-white border border-gray-300 rounded-lg text-base text-gray-900 outline-none focus:border-marca focus:ring-2 focus:ring-marca/15 resize-y"
              />
              <div className="flex justify-end mt-2">
                <button
                  type="submit"
                  disabled={submittingComment || !newComment.trim()}
                  className="px-5 py-2.5 bg-marca hover:bg-marca-escuro text-white font-semibold rounded-lg inline-flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  {submittingComment ? 'Publicando...' : 'Publicar comentário'}
                </button>
              </div>
            </form>
          ) : (
            <div className="mt-5 p-5 rounded-lg bg-gray-50 border border-gray-200 flex flex-wrap items-center justify-between gap-3">
              <p className="text-gray-700">Entre na sua conta para comentar.</p>
              <button
                onClick={onOpenAuth}
                className="px-5 py-2.5 bg-marca hover:bg-marca-escuro text-white font-semibold rounded-lg cursor-pointer"
              >
                Entrar ou criar conta
              </button>
            </div>
          )}

          <div className="mt-6 divide-y divide-gray-200">
            {comments.length === 0 ? (
              <p className="text-gray-500 py-2">Ainda não há comentários.</p>
            ) : (
              comments.map((comment) => (
                <div key={comment.id} className="py-4">
                  <div className="flex items-center gap-2">
                    <img
                      src={comment.userAvatar || `https://api.dicebear.com/7.x/initials/svg?seed=${comment.userName}`}
                      alt=""
                      className="w-7 h-7 rounded-full object-cover"
                    />
                    <span className="font-semibold text-sm text-gray-900">{comment.userName}</span>
                    <span className="text-xs text-gray-500">{formatRelativeTime(comment.createdAt)}</span>
                  </div>
                  <p className="mt-2 text-[15px] text-gray-800 leading-relaxed pl-9">{comment.content}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Mais notícias da mesma editoria */}
      {relatedArticles.length > 0 && (
        <section className="max-w-5xl mx-auto mt-16" aria-labelledby="mais-editoria">
          <h2
            id="mais-editoria"
            className="titulo text-[1.75rem] pb-2 mb-6 border-b-[3px]"
            style={{ color: cor, borderColor: cor }}
          >
            Mais em {article.category}
          </h2>
          <div className="grid sm:grid-cols-3 gap-6">
            {relatedArticles.map((rel) => (
              <ArticleCard key={rel.id} article={rel} variant="secondary" onSelectArticle={onSelectArticle} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
