import React, { useEffect, useRef, useState } from 'react';
import { Search, Menu, X, User, Shield, LogOut, ChevronDown, Tag, Newspaper } from 'lucide-react';
import { TopBar } from './TopBar';
import { AdSlot } from '../news/AdSlot';
import { NotificationBell } from '../notifications/NotificationBell';
import { AdItem, CategorySlug, UserProfile, PortalSettings } from '../../types/database';
import { INITIAL_CATEGORIES } from '../../data/initialData';
import { portalSettingsService } from '../../lib/supabase';
import { getAssetUrl } from '../../lib/assets';
import { corEditoria } from '../../lib/editorias';
import { InstallAppButton } from '../common/InstallAppButton';

interface HeaderProps {
  currentCategory: CategorySlug;
  onSelectCategory: (cat: CategorySlug) => void;
  onSearch: (query: string) => void;
  onOpenAuth: (mode: 'login' | 'register') => void;
  onOpenAdmin: () => void;
  currentUser: UserProfile | null;
  onSignOut: () => void;
  headerAd?: AdItem;
  headerAds?: AdItem[];
  // Enquanto os banners carregam, reserva a altura do banner do topo para a página não pular
  reserveAdSpace?: boolean;
  onGoHome: () => void;
  onSelectArticleSlug: (slug: string) => void;
  onOpenMyClassifieds?: () => void;
}

// "Início" não aparece na faixa de editorias: o logo já leva para a página inicial
const EDITORIAS = INITIAL_CATEGORIES.filter(c => c.slug !== 'todos');

export const Header: React.FC<HeaderProps> = ({
  currentCategory,
  onSelectCategory,
  onSearch,
  onOpenAuth,
  onOpenAdmin,
  currentUser,
  onSignOut,
  headerAd,
  headerAds,
  reserveAdSpace,
  onGoHome,
  onSelectArticleSlug,
  onOpenMyClassifieds
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [portalSettings, setPortalSettings] = useState<PortalSettings>(() => portalSettingsService.getSettingsSync());
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleUpdate = () => setPortalSettings(portalSettingsService.getSettingsSync());
    window.addEventListener('n1m_portal_settings_updated', handleUpdate);
    return () => window.removeEventListener('n1m_portal_settings_updated', handleUpdate);
  }, []);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  // Esc fecha menu e busca
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMenuOpen(false); setSearchOpen(false); setUserDropdownOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      onSearch(searchQuery.trim());
      setSearchOpen(false);
      setMenuOpen(false);
    }
  };

  const selecionar = (slug: CategorySlug) => {
    onSelectCategory(slug);
    setMenuOpen(false);
  };

  const nomePortal = portalSettings.officialName || 'Notícia em 1 Minuto';

  return (
    <header className="w-full bg-white">
      {/* Linha principal: menu, logo centralizado, conta e busca */}
      <div className="border-b border-gray-200">
        <div className="container mx-auto px-4 h-16 md:h-[92px] grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex items-center">
            <button
              onClick={() => { setMenuOpen(o => !o); setSearchOpen(false); }}
              className="inline-flex items-center gap-2.5 -ml-2 px-2 py-2 rounded-lg text-gray-800 hover:bg-gray-100 cursor-pointer"
              aria-expanded={menuOpen}
              aria-controls="menu-portal"
            >
              {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              <span className="hidden md:inline text-[15px] font-medium">Menu</span>
            </button>
          </div>

          <button
            onClick={onGoHome}
            className="justify-self-center cursor-pointer"
            title={`${nomePortal}: página inicial`}
            aria-label={`${nomePortal}: ir para a página inicial`}
          >
            <img
              src={getAssetUrl(portalSettings.customLogoUrl || 'logo.png')}
              alt={nomePortal}
              className="h-12 md:h-[76px] w-auto max-w-[150px] md:max-w-[260px] object-contain select-none"
              referrerPolicy="no-referrer"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                const fallbackUrl = getAssetUrl('logo.png');
                if (target.src !== fallbackUrl) target.src = fallbackUrl;
              }}
            />
          </button>

          <div className="flex items-center justify-end gap-1 md:gap-3">
            <div className="hidden lg:block"><InstallAppButton variant="compact" /></div>

            {currentUser ? (
              <>
                <NotificationBell currentUser={currentUser} onSelectArticleSlug={onSelectArticleSlug} />
                <div className="relative">
                  <button
                    onClick={() => setUserDropdownOpen(o => !o)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-full hover:bg-gray-100 text-gray-800 cursor-pointer"
                    aria-expanded={userDropdownOpen}
                  >
                    <img
                      src={currentUser.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${currentUser.fullName}`}
                      alt=""
                      className="w-7 h-7 rounded-full object-cover"
                    />
                    <span className="hidden md:inline text-sm font-medium max-w-[120px] truncate">{currentUser.fullName.split(' ')[0]}</span>
                    <ChevronDown className="hidden md:inline w-3.5 h-3.5" />
                  </button>
                  {userDropdownOpen && (
                    <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-lg py-2 z-50 text-sm">
                      <div className="px-4 py-2 border-b border-gray-100">
                        <p className="font-semibold text-gray-900 truncate">{currentUser.fullName}</p>
                        <p className="text-xs text-gray-500">{currentUser.role === 'admin' ? 'Administrador' : currentUser.role === 'editor' ? 'Jornalista' : 'Leitor'}</p>
                      </div>
                      {(currentUser.role === 'admin' || currentUser.role === 'editor') && (
                        <button onClick={() => { setUserDropdownOpen(false); onOpenAdmin(); }} className="w-full text-left px-4 py-2 text-gray-700 hover:bg-gray-50 flex items-center gap-2 cursor-pointer">
                          <Shield className="w-4 h-4 text-marca" /> Painel de controle
                        </button>
                      )}
                      {onOpenMyClassifieds && (
                        <button onClick={() => { setUserDropdownOpen(false); onOpenMyClassifieds(); }} className="w-full text-left px-4 py-2 text-gray-700 hover:bg-gray-50 flex items-center gap-2 cursor-pointer">
                          <Tag className="w-4 h-4 text-amber-600" /> Meus classificados
                        </button>
                      )}
                      <button onClick={() => { setUserDropdownOpen(false); onSignOut(); }} className="w-full text-left px-4 py-2 text-red-700 hover:bg-red-50 flex items-center gap-2 cursor-pointer">
                        <LogOut className="w-4 h-4" /> Sair da conta
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <button
                onClick={() => onOpenAuth('login')}
                className="inline-flex items-center gap-2 px-2 py-2 rounded-lg text-gray-800 hover:bg-gray-100 cursor-pointer"
              >
                <span className="hidden md:inline text-[15px] font-medium">Entrar</span>
                <User className="w-6 h-6 text-marca" />
              </button>
            )}

            <span className="hidden md:block w-px h-8 bg-gray-200" aria-hidden="true" />
            <button
              onClick={() => { setSearchOpen(o => !o); setMenuOpen(false); }}
              className="inline-flex items-center gap-2 px-2 py-2 rounded-lg text-gray-800 hover:bg-gray-100 cursor-pointer"
              aria-expanded={searchOpen}
              aria-controls="busca-portal"
            >
              <span className="hidden md:inline text-[15px] font-medium">Busca</span>
              {searchOpen ? <X className="w-6 h-6 text-marca" /> : <Search className="w-6 h-6 text-marca" />}
            </button>
          </div>
        </div>

        {/* Busca expandida */}
        {searchOpen && (
          <form id="busca-portal" onSubmit={handleSearchSubmit} className="container mx-auto px-4 pb-4">
            <label className="flex items-center gap-3 border-b-2 border-marca py-2">
              <Search className="w-5 h-5 text-gray-400 shrink-0" />
              <span className="sr-only">Buscar notícias</span>
              <input
                ref={searchInputRef}
                type="search"
                placeholder="Buscar notícias"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-transparent outline-none text-lg text-gray-900 placeholder:text-gray-400"
              />
              <button type="submit" className="px-4 py-1.5 rounded-lg bg-marca hover:bg-marca-escuro text-white text-sm font-semibold cursor-pointer">Buscar</button>
            </label>
          </form>
        )}
      </div>

      {/* Faixa de editorias: cada uma na sua cor */}
      <nav aria-label="Editorias" className="border-b border-gray-200">
        <ul className="container mx-auto px-4 flex items-center gap-6 md:gap-8 lg:justify-between overflow-x-auto no-scrollbar whitespace-nowrap">
          {EDITORIAS.map((cat) => {
            const ativa = currentCategory === cat.slug;
            const cor = corEditoria(cat.slug);
            return (
              <li key={cat.id}>
                <button
                  onClick={() => selecionar(cat.slug)}
                  aria-current={ativa ? 'page' : undefined}
                  className="rotulo-editoria text-[15px] md:text-base inline-flex items-center gap-1.5 py-3 border-b-[3px] cursor-pointer transition-colors"
                  style={{ color: cor, borderColor: ativa ? cor : 'transparent' }}
                >
                  {cat.slug === 'classificados' && <Tag className="w-4 h-4" />}
                  {cat.slug === 'midia-impressa' && <Newspaper className="w-4 h-4" />}
                  {cat.name}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Data, clima de Itabaiana e dólar */}
      <div className="border-b border-gray-200">
        <TopBar />
      </div>

      {/* Menu completo */}
      {menuOpen && (
        <div id="menu-portal" className="border-b border-gray-200 bg-white shadow-sm">
          <div className="container mx-auto px-4 py-6 grid gap-8 md:grid-cols-[2fr_1fr]">
            <div>
              <p className="text-sm text-gray-500 mb-3">Editorias</p>
              <ul className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1">
                <li>
                  <button onClick={() => { onGoHome(); setMenuOpen(false); }} className="titulo text-lg py-1.5 text-gray-900 hover:underline cursor-pointer">Início</button>
                </li>
                {EDITORIAS.map(cat => (
                  <li key={cat.id}>
                    <button
                      onClick={() => selecionar(cat.slug)}
                      className="titulo text-lg py-1.5 hover:underline cursor-pointer text-left"
                      style={{ color: corEditoria(cat.slug) }}
                    >
                      {cat.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-4 text-sm">
              <InstallAppButton variant="menu" />
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {portalSettings.showInstagram && portalSettings.instagramUrl && (
                  <a href={portalSettings.instagramUrl} target="_blank" rel="noopener noreferrer" className="text-gray-700 hover:text-marca underline-offset-2 hover:underline">Instagram</a>
                )}
                {portalSettings.showYoutube && portalSettings.youtubeUrl && (
                  <a href={portalSettings.youtubeUrl} target="_blank" rel="noopener noreferrer" className="text-gray-700 hover:text-marca underline-offset-2 hover:underline">YouTube</a>
                )}
                {portalSettings.showFacebook && portalSettings.facebookUrl && (
                  <a href={portalSettings.facebookUrl} target="_blank" rel="noopener noreferrer" className="text-gray-700 hover:text-marca underline-offset-2 hover:underline">Facebook</a>
                )}
                {portalSettings.showWhatsapp && portalSettings.whatsappLink && (
                  <a href={portalSettings.whatsappLink} target="_blank" rel="noopener noreferrer" className="text-gray-700 hover:text-marca underline-offset-2 hover:underline">WhatsApp da redação</a>
                )}
              </div>
              {!currentUser && (
                <div className="flex gap-3">
                  <button onClick={() => { onOpenAuth('login'); setMenuOpen(false); }} className="px-4 py-2 rounded-lg bg-marca hover:bg-marca-escuro text-white font-semibold cursor-pointer">Entrar</button>
                  <button onClick={() => { onOpenAuth('register'); setMenuOpen(false); }} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 font-semibold cursor-pointer">Criar conta</button>
                </div>
              )}
              <button
                onClick={() => { onOpenAdmin(); setMenuOpen(false); }}
                className="inline-flex items-center gap-1.5 text-gray-500 hover:text-marca cursor-pointer"
                title="Acesso exclusivo para administradores e editores"
              >
                <Shield className="w-4 h-4" /> Acesso da redação
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Banner do topo, em largura total abaixo do cabeçalho */}
      <div className={`container mx-auto px-4 flex justify-center ${reserveAdSpace ? 'min-h-[112px]' : ''}`}>
        <div className="w-full flex justify-center py-4 empty:hidden">
          <AdSlot placement="header" ads={headerAds} ad={headerAd} />
        </div>
      </div>
    </header>
  );
};
