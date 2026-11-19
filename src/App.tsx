/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import { ArticleCard } from './components/news/ArticleCard';
import { AdSlot } from './components/news/AdSlot';
import { AuthModal } from './components/auth/AuthModal';
import { EmailConfirmationModal } from './components/auth/EmailConfirmationModal';
import { ResetPasswordModal } from './components/auth/ResetPasswordModal';

import { ArticleDetail } from './components/pages/ArticleDetail';
import { InstitutionalPage } from './components/pages/InstitutionalPage';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { AdminLoginModal } from './components/admin/AdminLoginModal';
import { ClassifiedList } from './components/classifieds/ClassifiedList';
import { ClassifiedDetail } from './components/classifieds/ClassifiedDetail';
import { ClassifiedFormModal } from './components/classifieds/ClassifiedFormModal';
import { MyClassifiedsModal } from './components/classifieds/MyClassifiedsModal';
import { PrintEditionsPage } from './components/print/PrintEditionsPage';
import { Article, AdItem, CategorySlug, UserProfile, ClassifiedItem, isExtraSidebarSquare } from './types/database';
import { 
  newsService, adsService, authService, newsletterService,
  siteSettingsService, supabase, isSupabaseConfigured, classifiedsService, getStored, STORAGE_KEYS
} from './lib/supabase';
import { HomeSkeleton } from './components/news/HomeSkeleton';
import { INITIAL_ARTICLES, INITIAL_ADS, INITIAL_CATEGORIES } from './data/initialData';
import { corEditoria, slugEditoria } from './lib/editorias';
import { Sparkles, CheckCircle2 } from 'lucide-react';
import { updateClientHeadForArticle, updateClientHeadForClassified, getAppBasePath, getArticlePathKey } from './lib/seo';

export default function App() {
  // Começam vazios: a página mostra o esqueleto até as notícias e banners atuais chegarem,
  // em vez de exibir por um instante a cópia antiga embutida no site
  const [articles, setArticles] = useState<Article[]>([]);
  const [ads, setAds] = useState<AdItem[]>([]);
  const [contentReady, setContentReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  
  // Roteamento interno
  const [viewMode, setViewMode] = useState<'home' | 'article' | 'institutional' | 'admin' | 'classifieds' | 'classified-detail' | 'print-editions'>('home');
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [selectedClassified, setSelectedClassified] = useState<ClassifiedItem | null>(null);
  const [currentCategory, setCurrentCategory] = useState<CategorySlug>('todos');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [institutionalPage, setInstitutionalPage] = useState<'sobre-nos' | 'expediente' | 'privacidade' | 'anuncie-conosco'>('sobre-nos');
  
  // Modais de Classificados
  const [isClassifiedFormOpen, setIsClassifiedFormOpen] = useState(false);
  const [isMyClassifiedsOpen, setIsMyClassifiedsOpen] = useState(false);
  const [editingClassified, setEditingClassified] = useState<ClassifiedItem | null>(null);
  
  // Modal de Autenticação Pública
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');
  const [authReasonMessage, setAuthReasonMessage] = useState<string | undefined>(undefined);
  const [pendingActionAfterAuth, setPendingActionAfterAuth] = useState<'create_classified' | null>(null);

  // Modal de Autenticação Administrativa Exclusiva (Acesso Restrito)
  const [isAdminLoginOpen, setIsAdminLoginOpen] = useState(false);
  
  // Modais de Segurança (Confirmação de E-mail e Redefinição de Senha)
  const [emailConfirmToken, setEmailConfirmToken] = useState<string | null>(null);
  const [resetPasswordToken, setResetPasswordToken] = useState<string | null>(null);

  // Paginação de notícias
  const [visibleCount, setVisibleCount] = useState(7);
  
  // Newsletter Sidebar
  const [sidebarEmail, setSidebarEmail] = useState('');
  const [sidebarSubscribed, setSidebarSubscribed] = useState(false);

  // Slug de anúncio dos classificados no endereço (/classificado/slug, página estática ou ?p= do 404.html)
  const extractClassifiedSlug = (): string | null => {
    if (typeof window === 'undefined') return null;
    const windowSlug = (window as any).__INITIAL_CLASSIFIED_SLUG__;
    if (windowSlug) return windowSlug;
    const re = /(?:^|\/)classificados?\/([^/?#]+)/i;
    const pathMatch = window.location.pathname.match(re);
    if (pathMatch && pathMatch[1]) return decodeURIComponent(pathMatch[1]);
    const pParam = new URLSearchParams(window.location.search).get('p');
    const pMatch = pParam ? pParam.match(re) : null;
    return pMatch && pMatch[1] ? decodeURIComponent(pMatch[1]) : null;
  };

  // Volta a barra de endereço para a raiz do portal (ao sair de uma notícia ou anúncio)
  const resetPathToBase = () => {
    const basePath = getAppBasePath();
    if (window.location.pathname !== basePath) {
      window.history.pushState({}, '', basePath);
    }
  };

  // Abre um anúncio com link próprio (/classificado/slug) para copiar e compartilhar
  const openClassified = (item: ClassifiedItem, updateUrl: 'push' | 'replace' | 'none' = 'push') => {
    setSelectedClassified(item);
    setSelectedArticle(null);
    setCurrentCategory('classificados');
    setViewMode('classified-detail');
    if (updateUrl !== 'none' && item.slug) {
      const basePath = getAppBasePath();
      const cleanBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
      const targetUrl = `${cleanBase}classificado/${encodeURIComponent(item.slug)}/`;
      if (window.location.pathname !== targetUrl) {
        window.history[updateUrl === 'push' ? 'pushState' : 'replaceState']({ classifiedSlug: item.slug }, '', targetUrl);
      }
    }
    updateClientHeadForClassified(item);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openClassifiedBySlug = async (slug: string, updateUrl: 'replace' | 'none') => {
    try {
      const found = await classifiedsService.getClassifiedBySlug(slug);
      if (found && found.status === 'published') {
        openClassified(found, updateUrl);
        return true;
      }
    } catch (err) {
      console.warn('Não foi possível abrir o anúncio do link:', err);
    }
    return false;
  };

  // Carregar dados iniciais e sessão
  const loadData = async () => {
    // Sessão e configurações seguem em paralelo, sem atrasar a exibição das notícias
    authService.getCurrentUser().then(setCurrentUser).catch(() => {});
    siteSettingsService.hydrate().catch(() => {});

    // Conexão muito lenta: depois de 8 s usa a última cópia salva neste navegador
    // e troca pelas notícias atuais quando elas chegarem
    const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T | null> =>
      Promise.race([promise, new Promise<null>(resolve => setTimeout(() => resolve(null), ms))]);
    const articlesRequest = newsService.getArticles();
    const adsRequest = adsService.getAds();
    const [fetchedArts, fetchedAds] = await Promise.all([withTimeout(articlesRequest, 8000), withTimeout(adsRequest, 8000)]);
    const arts = fetchedArts ?? getStored<Article[]>(STORAGE_KEYS.ARTICLES, INITIAL_ARTICLES);
    const currentAds = fetchedAds ?? getStored<AdItem[]>(STORAGE_KEYS.ADS, INITIAL_ADS);
    if (!fetchedArts) articlesRequest.then(setArticles).catch(() => {});
    if (!fetchedAds) adsRequest.then(setAds).catch(() => {});
    setArticles(arts);
    setAds(currentAds);
    setContentReady(true);

    // Extrai slug de notícia considerando SSR, rotas diretas, subdiretórios no GitHub Pages e fallback 404
    const extractSlug = (): string | null => {
      if (typeof window === 'undefined') return null;
      const windowSlug = (window as any).__INITIAL_ARTICLE_SLUG__;
      if (windowSlug) return windowSlug;

      // 1. Procura no pathname em qualquer profundidade (ex: /noticia/slug ou /repo/noticia/slug)
      const pathMatch = window.location.pathname.match(/(?:^|\/)(?:noticia|noticias|artigo|artigos)\/([^/?#]+)/i);
      if (pathMatch && pathMatch[1]) {
        return decodeURIComponent(pathMatch[1]);
      }

      // 2. Procura em query parameters diretos (?noticia=, ?slug=)
      const params = new URLSearchParams(window.location.search);
      const qNoticia = params.get('noticia') || params.get('slug');
      if (qNoticia) return decodeURIComponent(qNoticia);

      // 3. Suporte ao parâmetro p vindo do redirecionamento do 404.html do GitHub Pages (?p=/noticia/slug)
      const pParam = params.get('p');
      if (pParam) {
        const pMatch = pParam.match(/(?:^|\/)(?:noticia|noticias|artigo|artigos)\/([^/?#]+)/i);
        if (pMatch && pMatch[1]) {
          return decodeURIComponent(pMatch[1]);
        }
      }

      return null;
    };

    const initialClassifiedSlug = extractClassifiedSlug();
    if (initialClassifiedSlug) {
      await openClassifiedBySlug(initialClassifiedSlug, 'replace');
      return;
    }

    const initialSlug = extractSlug();
    if (initialSlug) {
      const found = arts.find(a => a.slug.toLowerCase() === initialSlug.toLowerCase() || a.id === initialSlug);
      if (found && found.status !== 'draft') {
        setSelectedArticle(found);
        setViewMode('article');
        updateClientHeadForArticle(found);
      }
    }
  };

  useEffect(() => {
    loadData();

    // 1. Processa rotas e links de confirmação de e-mail e recuperação de senha
    const handleUrlAuthTokens = () => {
      if (typeof window === 'undefined') return;

      const searchParams = new URLSearchParams(window.location.search);
      const hash = window.location.hash || '';

      // Verifica se a URL retornou erro de autenticação (ex: link expirado pelo Supabase)
      const errorParam = searchParams.get('error') || (hash.includes('error=') ? new URLSearchParams(hash.substring(1)).get('error') : null);
      const errorDesc = searchParams.get('error_description') || (hash.includes('error_description=') ? new URLSearchParams(hash.substring(1)).get('error_description') : null);
      if (errorDesc || errorParam) {
        console.warn('Erro retornado na URL de autenticação:', errorParam, errorDesc);
        const decoded = errorDesc ? decodeURIComponent(errorDesc.replace(/\+/g, ' ')) : 'O link de recuperação ou confirmação é inválido ou expirou.';
        alert(decoded);
        return;
      }

      // Suporte a fluxo PKCE (?code=xxxx)
      const code = searchParams.get('code');
      if (code && isSupabaseConfigured() && supabase) {
        supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
          if (!error && (data?.session || searchParams.get('action') === 'reset-password')) {
            setResetPasswordToken('supabase_recovery');
          }
        }).catch(err => {
          console.warn('Falha ao trocar código PKCE por sessão:', err);
        });
      }

      // A) Confirmação de E-mail e Recuperação via parâmetros de busca
      const action = searchParams.get('action');
      const queryToken = searchParams.get('token');
      const queryEmail = searchParams.get('email');
      const queryType = searchParams.get('type');
      const tokenHash = searchParams.get('token_hash');

      // token_hash precisa ser verificado antes de abrir o modal, senão updateUser roda sem sessão
      if (tokenHash && queryType === 'recovery') {
        if (isSupabaseConfigured() && supabase) {
          supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' }).then(({ error }) => {
            if (!error) {
              setResetPasswordToken('supabase_recovery');
            }
          });
        }
      } else if (action === 'reset-password' || queryType === 'recovery') {
        setResetPasswordToken(queryToken || 'supabase_recovery');
      } else if (action === 'confirm-email') {
        // O Supabase valida o link e devolve a sessão no fragmento da URL
        setEmailConfirmToken(queryToken || 'supabase_verified');
      } else if (queryToken && queryEmail) {
        setEmailConfirmToken(queryToken);
      }

      // B) Confirmação de E-mail e Recuperação via hash (#confirm-email, #reset-password, #access_token)
      if (hash.startsWith('#confirm-email')) {
        const hashParams = new URLSearchParams(hash.replace('#confirm-email', '').replace(/^[?&]/, ''));
        const hashToken = hashParams.get('token');
        if (hashToken) {
          setEmailConfirmToken(hashToken);
        } else {
          setEmailConfirmToken('supabase_verified');
        }
      } else if (hash.startsWith('#reset-password')) {
        const hashParams = new URLSearchParams(hash.replace('#reset-password', '').replace(/^[?&]/, ''));
        const hashToken = hashParams.get('token');
        setResetPasswordToken(hashToken || 'supabase_recovery');
      } else if (hash.includes('type=recovery')) {
        setResetPasswordToken('supabase_recovery');
      } else if (hash.includes('type=signup') || hash.includes('type=email_change')) {
        setEmailConfirmToken('supabase_verified');
      }
    };

    handleUrlAuthTokens();

    // 2. Escuta eventos oficiais de autenticação do Supabase caso conectado
    let supabaseSub: any = null;
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
          if (event === 'PASSWORD_RECOVERY') {
            setResetPasswordToken('supabase_recovery');
          } else if (event === 'SIGNED_IN' && session?.user) {
            authService.getCurrentUser().then(u => {
              if (u) setCurrentUser(u);
            });
          }
        });
        supabaseSub = authListener?.subscription;
      } catch (e) {
        console.warn('Aviso: Falha ao registrar onAuthStateChange do Supabase', e);
      }
    }

    const handleAuthChange = () => {
      authService.getCurrentUser().then(setCurrentUser);
    };

    const handleDirectReset = () => {
      setResetPasswordToken('supabase_recovery');
    };

    window.addEventListener('n1m_auth_changed', handleAuthChange);
    window.addEventListener('n1m_direct_reset_password', handleDirectReset);

    return () => {
      window.removeEventListener('n1m_auth_changed', handleAuthChange);
      window.removeEventListener('n1m_direct_reset_password', handleDirectReset);
      if (supabaseSub) supabaseSub.unsubscribe();
    };
  }, []);

  // Monitora navegação pelo histórico do navegador (botões Voltar e Avançar)
  useEffect(() => {
    const handlePopState = () => {
      const classifiedSlug = extractClassifiedSlug();
      if (classifiedSlug) {
        openClassifiedBySlug(classifiedSlug, 'none');
        return;
      }

      const pathMatch = window.location.pathname.match(/(?:^|\/)(?:noticia|noticias|artigo|artigos)\/([^/?#]+)/i);
      const params = new URLSearchParams(window.location.search);
      const searchSlug = params.get('noticia') || params.get('slug');
      const pParam = params.get('p');
      const pMatch = pParam ? pParam.match(/(?:^|\/)(?:noticia|noticias|artigo|artigos)\/([^/?#]+)/i) : null;
      const slug = (pathMatch ? decodeURIComponent(pathMatch[1]) : (pMatch ? decodeURIComponent(pMatch[1]) : searchSlug));

      if (slug && articles.length > 0) {
        const found = articles.find(a => a.slug.toLowerCase() === slug.toLowerCase() || a.id === slug);
        if (found && found.status !== 'draft') {
          setSelectedArticle(found);
          setViewMode('article');
          updateClientHeadForArticle(found);
          return;
        }
      }

      const basePath = getAppBasePath();
      const currentPath = window.location.pathname;
      if (currentPath === '/' || currentPath === basePath || currentPath === basePath.replace(/\/$/, '') || !slug) {
        setSelectedArticle(null);
        setSelectedClassified(null);
        setViewMode(prev => (prev === 'classified-detail' ? 'classifieds' : 'home'));
        document.title = 'Notícia em 1 Minuto - Informação rápida, confiável e sem enrolação';
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [articles]);

  const handleSelectArticle = (art: Article) => {
    setSelectedArticle(art);
    setViewMode('article');
    // Atualiza a URL canônica na barra de endereços do navegador preservando a base da aplicação
    const basePath = getAppBasePath();
    const cleanBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
    const targetUrl = `${cleanBase}noticia/${encodeURIComponent(getArticlePathKey(art))}/`;
    if (window.location.pathname !== targetUrl) {
      window.history.pushState({ articleSlug: art.slug }, '', targetUrl);
    }
    updateClientHeadForArticle(art);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleGoHome = () => {
    setViewMode('home');
    setSelectedArticle(null);
    setSelectedClassified(null);
    setCurrentCategory('todos');
    setSearchQuery('');
    const basePath = getAppBasePath();
    if (window.location.pathname !== basePath) {
      window.history.pushState({}, '', basePath);
    }
    document.title = 'Notícia em 1 Minuto - Informação rápida, confiável e sem enrolação';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectCategory = (cat: CategorySlug) => {
    setCurrentCategory(cat);
    setSearchQuery('');
    setSelectedArticle(null);
    setSelectedClassified(null);
    resetPathToBase();
    if (cat === 'classificados') {
      setViewMode('classifieds');
    } else if (cat === 'midia-impressa') {
      setViewMode('print-editions');
    } else {
      setViewMode('home');
      setVisibleCount(7);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectClassified = (item: ClassifiedItem) => {
    openClassified(item);
  };

  const handleOpenCreateClassified = () => {
    if (!currentUser) {
      setAuthReasonMessage('Para publicar anúncios nos Classificados com segurança jurídica e credibilidade, você precisa estar cadastrado e conectado.');
      setPendingActionAfterAuth('create_classified');
      handleOpenAuth('login');
      return;
    }
    setEditingClassified(null);
    setIsClassifiedFormOpen(true);
  };

  const handleOpenMyClassifieds = () => {
    if (!currentUser) {
      handleOpenAuth('login');
      return;
    }
    setIsMyClassifiedsOpen(true);
  };

  const handleEditClassified = (item: ClassifiedItem) => {
    setIsMyClassifiedsOpen(false);
    setEditingClassified(item);
    setIsClassifiedFormOpen(true);
  };

  const handleViewClassified = (item: ClassifiedItem) => {
    setIsMyClassifiedsOpen(false);
    openClassified(item);
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setViewMode('home');
    setSelectedArticle(null);
  };

  const handleOpenInstitutional = (page: 'sobre-nos' | 'expediente' | 'privacidade' | 'anuncie-conosco') => {
    setInstitutionalPage(page);
    setViewMode('institutional');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenAuth = (mode: 'login' | 'register' = 'login') => {
    setAuthModalMode(mode);
    setIsAuthModalOpen(true);
  };

  const handleOpenAdminLogin = () => {
    if (currentUser?.role === 'admin' || currentUser?.role === 'editor') {
      setViewMode('admin');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      setIsAdminLoginOpen(true);
    }
  };

  const handleSignOut = async () => {
    await authService.signOut();
    setCurrentUser(null);
    setIsMyClassifiedsOpen(false);
    setIsClassifiedFormOpen(false);
    if (viewMode === 'admin') {
      setViewMode('home');
    }
  };

  const handleSidebarNewsletter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sidebarEmail.trim() || !sidebarEmail.includes('@')) return;
    await newsletterService.subscribe(sidebarEmail);
    setSidebarSubscribed(true);
    setSidebarEmail('');
    setTimeout(() => setSidebarSubscribed(false), 5000);
  };

  // Filtragem de notícias
  let filteredArticles = [...articles];

  // Compara pelo slug: "Política" (nome gravado na matéria) corresponde a "politica" (menu)
  if (currentCategory !== 'todos') {
    filteredArticles = filteredArticles.filter(
      a => slugEditoria(a.category) === currentCategory ||
      (currentCategory === 'videos' && a.isVideo)
    );
  }

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filteredArticles = filteredArticles.filter(
      a => a.title.toLowerCase().includes(q) ||
      (a.subtitle && a.subtitle.toLowerCase().includes(q)) ||
      a.content.toLowerCase().includes(q)
    );
  }

  // Destaques
  const filtrando = !!searchQuery.trim() || currentCategory !== 'todos';
  const heroArticle = filteredArticles.find(a => a.isHero) || filteredArticles[0];
  const heroRelacionadas = heroArticle
    ? filteredArticles.filter(a => a.id !== heroArticle.id && a.category === heroArticle.category).slice(0, 2)
    : [];
  const jaExibidas = new Set<string>([heroArticle?.id, ...heroRelacionadas.map(a => a.id)].filter(Boolean) as string[]);
  const secondaryArticles = filteredArticles.filter(a => !jaExibidas.has(a.id)).slice(0, 4);
  secondaryArticles.forEach(a => jaExibidas.add(a.id));

  // Página inicial: um bloco por editoria com as 3 notícias mais recentes ainda não exibidas
  const blocosEditoria = filtrando ? [] : INITIAL_CATEGORIES
    .filter(c => !['todos', 'videos', 'classificados', 'midia-impressa'].includes(c.slug))
    .map(c => {
      const itens = filteredArticles.filter(a => slugEditoria(a.category) === c.slug && !jaExibidas.has(a.id)).slice(0, 3);
      itens.forEach(a => jaExibidas.add(a.id));
      return { editoria: c, itens };
    })
    .filter(b => b.itens.length > 0);

  const feedArticles = filtrando
    ? filteredArticles.filter(a => searchQuery.trim() ? true : a.id !== heroArticle?.id)
    : filteredArticles.filter(a => !jaExibidas.has(a.id));
  const visibleFeed = feedArticles.slice(0, visibleCount);
  const nomeEditoriaAtual = INITIAL_CATEGORIES.find(c => c.slug === currentCategory)?.name || currentCategory;

  // Mais Lidas (Ordenadas por viewsCount)
  const mostReadArticles = [...articles].sort((a, b) => (b.viewsCount || 0) - (a.viewsCount || 0)).slice(0, 5);

  // Anúncios específicos
  const isAdActive = (a: AdItem) => a.status === 'active' || (a.status === undefined && a.active);
  const headerAds = ads.filter(a => a.placement === 'header');
  const feedAds = ads.filter(a => a.placement === 'feed');
  const sidebarAds = ads.filter(a => a.placement === 'sidebar');
  const articleAds = ads.filter(a => a.placement === 'article');
  const footerAds = ads.filter(a => a.placement === 'footer');
  const ads300x300 = ads.filter(a => (a.adFormat === '300x300' || a.aspectRatio === '1 / 1') && a.placement !== 'sidebar_300x900' && a.placement !== 'sidebar_300x600' && !isExtraSidebarSquare(a.placement));
  const ads300x300Second = ads.filter(a => a.placement === 'sidebar_300x300_2');
  const ads300x300Third = ads.filter(a => a.placement === 'sidebar_300x300_3');
  const ads300x900 = ads.filter(a => a.adFormat === '300x900' || a.placement === 'sidebar_300x900' || a.aspectRatio === '1 / 3' || a.adFormat === '300x600' || a.placement === 'sidebar_300x600' || a.aspectRatio === '1 / 2');

  return (
    <div className="min-h-screen bg-gray-50 font-sans selection:bg-marca selection:text-white flex flex-col">
      {/* Header Fixo */}
      <Header
        currentCategory={currentCategory}
        onSelectCategory={handleSelectCategory}
        onSearch={handleSearch}
        onOpenAuth={handleOpenAuth}
        onOpenAdmin={handleOpenAdminLogin}
        currentUser={currentUser}
        onSignOut={handleSignOut}
        headerAds={headerAds}
        reserveAdSpace={!contentReady}
        onGoHome={handleGoHome}
        onSelectArticleSlug={(slug) => {
          const found = articles.find(a => a.slug === slug);
          if (found) {
            handleSelectArticle(found);
          }
        }}
        onOpenMyClassifieds={handleOpenMyClassifieds}
      />

      {/* Conteúdo Principal */}
      <main className="flex-1">
        {/* VISUALIZAÇÃO: PAINEL ADMINISTRATIVO */}
        {viewMode === 'admin' && currentUser && (
          <AdminDashboard
            currentUser={currentUser}
            articles={articles}
            ads={ads}
            onRefreshData={loadData}
            onBackToPortal={() => setViewMode('home')}
          />
        )}

        {/* VISUALIZAÇÃO: ARTIGO COMPLETO */}
        {viewMode === 'article' && selectedArticle && (
          <ArticleDetail
            article={selectedArticle}
            allArticles={articles}
            currentUser={currentUser}
            onOpenAuth={() => handleOpenAuth('login')}
            onBack={handleGoHome}
            onSelectArticle={handleSelectArticle}
            articleAds={articleAds}
          />
        )}

        {/* VISUALIZAÇÃO: CLASSIFICADOS (PÁGINA EXCLUSIVA) */}
        {viewMode === 'classifieds' && (
          <ClassifiedList
            currentUser={currentUser}
            onOpenAuth={() => {
              setAuthReasonMessage('Para publicar anúncios nos Classificados com credibilidade e segurança jurídica, faça login ou cadastre-se abaixo.');
              setPendingActionAfterAuth('create_classified');
              handleOpenAuth('login');
            }}
            onOpenCreateModal={handleOpenCreateClassified}
            onOpenMyClassifieds={handleOpenMyClassifieds}
            onSelectClassified={handleSelectClassified}
          />
        )}

        {/* VISUALIZAÇÃO: MÍDIA IMPRESSA (EDIÇÕES EM PDF PARA LEITORES CADASTRADOS) */}
        {viewMode === 'print-editions' && (
          <PrintEditionsPage
            currentUser={currentUser}
            onOpenAuth={(mode) => {
              setAuthReasonMessage('A Mídia Impressa é exclusiva para leitores cadastrados. Entre ou crie sua conta gratuita para visualizar e baixar as edições do jornal.');
              handleOpenAuth(mode);
            }}
          />
        )}

        {/* VISUALIZAÇÃO: PÁGINA INDIVIDUAL DO ANÚNCIO */}
        {viewMode === 'classified-detail' && selectedClassified && (
          <ClassifiedDetail
            classified={selectedClassified}
            onBack={() => {
              setViewMode('classifieds');
              setSelectedClassified(null);
              resetPathToBase();
              document.title = 'Notícia em 1 Minuto - Informação rápida, confiável e sem enrolação';
            }}
          />
        )}

        {/* VISUALIZAÇÃO: PÁGINAS INSTITUCIONAIS */}
        {viewMode === 'institutional' && (
          <InstitutionalPage
            page={institutionalPage}
            onBack={() => setViewMode('home')}
          />
        )}

        {/* VISUALIZAÇÃO: PÁGINA INICIAL / FEED */}
        {viewMode === 'home' && !contentReady && <HomeSkeleton />}
        {viewMode === 'home' && contentReady && (
          <div className="container mx-auto px-4 pt-2 pb-14">
            {/* Título da editoria ou da busca */}
            {filtrando && (
              <div className="mb-6 pb-4 border-b border-gray-200 flex flex-wrap justify-between items-end gap-3">
                <div>
                  <h1
                    className="titulo text-3xl md:text-4xl"
                    style={{ color: searchQuery ? undefined : corEditoria(currentCategory) }}
                  >
                    {searchQuery ? `Resultados para “${searchQuery}”` : nomeEditoriaAtual}
                  </h1>
                  <p className="mt-1 text-sm text-gray-500">
                    {filteredArticles.length === 1 ? '1 notícia' : `${filteredArticles.length} notícias`}
                  </p>
                </div>
                <button
                  onClick={() => { setCurrentCategory('todos'); setSearchQuery(''); }}
                  className="text-sm font-semibold text-marca hover:underline cursor-pointer"
                >
                  Voltar para a página inicial
                </button>
              </div>
            )}

            {filteredArticles.length === 0 && (
              <div className="py-16 text-center max-w-md mx-auto">
                <p className="titulo text-2xl text-gray-900">Nenhuma notícia encontrada</p>
                <p className="mt-2 text-gray-600">
                  {searchQuery ? 'Tente outra palavra ou um termo mais curto.' : 'Esta editoria ainda não tem notícias publicadas.'}
                </p>
              </div>
            )}

            {/* Topo: manchete com relacionadas e quatro chamadas em duas colunas */}
            {heroArticle && !searchQuery && (
              <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-0 pb-10 mb-10 border-b border-gray-200">
                <div className="lg:col-span-6 lg:pr-8">
                  <ArticleCard
                    article={heroArticle}
                    variant="hero"
                    relacionadas={filtrando ? [] : heroRelacionadas}
                    onSelectArticle={handleSelectArticle}
                  />
                </div>
                {!filtrando && [0, 2].map(inicio => secondaryArticles.slice(inicio, inicio + 2).length > 0 && (
                  <div key={inicio} className="lg:col-span-3 lg:px-8 lg:border-l border-gray-200 grid sm:grid-cols-2 lg:grid-cols-1 gap-8 content-start">
                    {secondaryArticles.slice(inicio, inicio + 2).map(art => (
                      <ArticleCard key={art.id} article={art} variant="secondary" onSelectArticle={handleSelectArticle} />
                    ))}
                  </div>
                ))}
              </section>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
              {/* COLUNA PRINCIPAL */}
              <div className="lg:col-span-8 space-y-12">
                {/* Um bloco por editoria */}
                {blocosEditoria.map(({ editoria, itens }, i) => (
                  <React.Fragment key={editoria.slug}>
                    <section aria-labelledby={`bloco-${editoria.slug}`}>
                      <div className="flex items-baseline justify-between gap-4 mb-5 pb-2 border-b-[3px]" style={{ borderColor: corEditoria(editoria.slug) }}>
                        <h2 id={`bloco-${editoria.slug}`} className="titulo text-[1.75rem]" style={{ color: corEditoria(editoria.slug) }}>
                          {editoria.name}
                        </h2>
                        <button
                          onClick={() => handleSelectCategory(editoria.slug)}
                          className="text-sm font-semibold hover:underline cursor-pointer shrink-0"
                          style={{ color: corEditoria(editoria.slug) }}
                        >
                          Ver todas
                        </button>
                      </div>
                      <div className="grid sm:grid-cols-3 gap-6">
                        {itens.map(art => (
                          <ArticleCard key={art.id} article={art} variant="secondary" onSelectArticle={handleSelectArticle} />
                        ))}
                      </div>
                    </section>
                    {i === 1 && (
                      <div className="flex justify-center w-full">
                        <AdSlot placement="feed" ads={feedAds} />
                      </div>
                    )}
                  </React.Fragment>
                ))}

                {/* Demais notícias, da mais recente para a mais antiga */}
                {visibleFeed.length > 0 && (
                  <section aria-labelledby="mais-noticias">
                    {!filtrando && (
                      <h2 id="mais-noticias" className="titulo text-[1.75rem] text-gray-900 mb-2 pb-2 border-b-[3px] border-gray-900">
                        Mais notícias
                      </h2>
                    )}
                    <div>
                      {visibleFeed.map((art, idx) => (
                        <React.Fragment key={art.id}>
                          <ArticleCard article={art} variant="feed" onSelectArticle={handleSelectArticle} />
                          {filtrando && idx === 2 && (
                            <div className="py-4 border-b border-gray-200 flex justify-center w-full">
                              <AdSlot placement="feed" ads={feedAds} />
                            </div>
                          )}
                        </React.Fragment>
                      ))}
                    </div>

                    {visibleFeed.length < feedArticles.length && (
                      <button
                        onClick={() => setVisibleCount(prev => prev + 8)}
                        className="w-full mt-6 py-3.5 rounded-lg border-2 border-marca text-marca hover:bg-marca hover:text-white font-semibold transition-colors cursor-pointer"
                      >
                        Mostrar mais notícias
                      </button>
                    )}
                  </section>
                )}
              </div>

              {/* COLUNA LATERAL (4 Colunas) */}
              <aside className="lg:col-span-4 space-y-8">
                {/* Espaço Publicitário Formato 300x300 (Quadrado - Carrossel Independente) */}
                <div className="flex justify-center w-full">
                  <AdSlot format="300x300" placement="sidebar" ads={ads300x300} />
                </div>

                {/* Espaços Publicitários 300x300 adicionais (carrosséis independentes) */}
                <div className="flex justify-center w-full">
                  <AdSlot format="300x300" placement="sidebar_300x300_2" ads={ads300x300Second} />
                </div>
                <div className="flex justify-center w-full">
                  <AdSlot format="300x300" placement="sidebar_300x300_3" ads={ads300x300Third} />
                </div>

                {/* Widget Mais Lidas */}
                <section aria-labelledby="mais-lidas">
                  <h2 id="mais-lidas" className="titulo text-2xl text-gray-900 pb-2 border-b-[3px] border-gray-900">
                    Mais lidas
                  </h2>
                  <ol>
                    {mostReadArticles.map((art, i) => (
                      <li key={art.id}>
                        <ArticleCard article={art} variant="compact" posicao={i + 1} onSelectArticle={handleSelectArticle} />
                      </li>
                    ))}
                  </ol>
                </section>

                {/* Espaço Publicitário Formato 300x600 (Vertical - Carrossel Independente) */}
                <div className="flex justify-center w-full">
                  <AdSlot format="300x600" placement="sidebar_300x900" ads={ads300x900} />
                </div>

                {/* Widget Newsletter 1 Minuto News */}
                <section className="bg-marca-escuro text-white p-6 md:p-7 rounded-lg relative overflow-hidden">
                  <div className="relative z-10">
                    <h2 className="titulo text-2xl mb-2">
                      As notícias do dia no seu e-mail
                    </h2>
                    <p className="text-blue-100 text-sm mb-5 leading-relaxed">
                      Um resumo rápido de Itabaiana, Sergipe e do Brasil, uma vez por dia.
                    </p>

                    {sidebarSubscribed ? (
                      <div className="p-3 bg-emerald-950 border border-emerald-800 rounded-lg flex items-center gap-2 text-xs text-emerald-300">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>Inscrição confirmada com sucesso!</span>
                      </div>
                    ) : (
                      <form onSubmit={handleSidebarNewsletter} className="space-y-2">
                        <input
                          type="email"
                          required
                          placeholder="Seu melhor e-mail"
                          value={sidebarEmail}
                          onChange={(e) => setSidebarEmail(e.target.value)}
                          aria-label="Seu e-mail"
                          className="w-full bg-white/10 border border-white/25 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-marca-ciano outline-none text-white placeholder:text-blue-200"
                        />
                        <button
                          type="submit"
                          className="w-full bg-marca-ciano hover:bg-white text-marca-escuro font-semibold py-3 rounded-lg transition-colors cursor-pointer"
                        >
                          Receber o resumo
                        </button>
                      </form>
                    )}
                  </div>
                </section>
              </aside>
            </div>
          </div>
        )}
      </main>

      {/* Footer Fixo (Publicidade integrada internamente imediatamente acima dos direitos reservados e área administrativa) */}
      <Footer
        onOpenInstitutional={handleOpenInstitutional}
        onOpenAdmin={handleOpenAdminLogin}
        onGoHome={handleGoHome}
        footerAds={footerAds}
        onOpenClassifieds={() => {
          setCurrentCategory('classificados');
          setViewMode('classifieds');
          setSelectedArticle(null);
          setSelectedClassified(null);
          resetPathToBase();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />

      {/* Modal de Autenticação (Login / Cadastro / Recuperação) */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => {
          setIsAuthModalOpen(false);
          setAuthReasonMessage(undefined);
          setPendingActionAfterAuth(null);
        }}
        initialMode={authModalMode}
        reasonMessage={authReasonMessage}
        onSuccess={(user) => {
          setCurrentUser(user);
          if (pendingActionAfterAuth === 'create_classified') {
            setPendingActionAfterAuth(null);
            setAuthReasonMessage(undefined);
            setEditingClassified(null);
            setTimeout(() => {
              setIsClassifiedFormOpen(true);
            }, 300);
          }
        }}
      />

      {/* Modal Exclusivo de Login Administrativo (Acesso Restrito) */}
      <AdminLoginModal
        isOpen={isAdminLoginOpen}
        onClose={() => setIsAdminLoginOpen(false)}
        onSuccess={(adminUser) => {
          setCurrentUser(adminUser);
          setIsAdminLoginOpen(false);
          setViewMode('admin');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />

      {/* Modais de Gestão e Criação de Classificados */}
      {currentUser && (
        <>
          <ClassifiedFormModal
            isOpen={isClassifiedFormOpen}
            onClose={() => {
              setIsClassifiedFormOpen(false);
              setEditingClassified(null);
            }}
            currentUser={currentUser}
            initialData={editingClassified}
            onSuccess={(saved) => {
              setIsClassifiedFormOpen(false);
              setEditingClassified(null);
              openClassified(saved);
            }}
          />

          <MyClassifiedsModal
            isOpen={isMyClassifiedsOpen}
            onClose={() => setIsMyClassifiedsOpen(false)}
            currentUser={currentUser}
            onOpenCreateModal={handleOpenCreateClassified}
            onEditClassified={handleEditClassified}
            onViewClassified={handleViewClassified}
          />
        </>
      )}

      {/* Modal de Confirmação de E-mail */}
      {emailConfirmToken && (
        <EmailConfirmationModal
          isOpen={Boolean(emailConfirmToken)}
          token={emailConfirmToken}
          onClose={() => {
            setEmailConfirmToken(null);
            if (window.location.search.includes('action=confirm-email') || window.location.hash.includes('confirm-email')) {
              window.history.replaceState({}, '', window.location.pathname);
            }
          }}
          onGoToLogin={() => {
            setEmailConfirmToken(null);
            if (window.location.search.includes('action=confirm-email') || window.location.hash.includes('confirm-email')) {
              window.history.replaceState({}, '', window.location.pathname);
            }
            handleOpenAuth('login');
          }}
        />
      )}

      {/* Modal de Redefinição de Senha */}
      {resetPasswordToken && (
        <ResetPasswordModal
          isOpen={Boolean(resetPasswordToken)}
          token={resetPasswordToken}
          onClose={() => {
            setResetPasswordToken(null);
            if (window.location.search.includes('action=reset-password') || window.location.hash.includes('reset-password') || window.location.hash.includes('type=recovery')) {
              window.history.replaceState({}, '', window.location.pathname);
            }
          }}
          onSuccessGoToLogin={() => {
            setResetPasswordToken(null);
            if (window.location.search.includes('action=reset-password') || window.location.hash.includes('reset-password') || window.location.hash.includes('type=recovery')) {
              window.history.replaceState({}, '', window.location.pathname);
            }
            handleOpenAuth('login');
          }}
        />
      )}
    </div>
  );
}
