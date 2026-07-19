// App shell: sidebar (collections nav) + topbar (search trigger, actions).
import { useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { CollectionDot } from './bits';
import { Kbd } from './ui';
import { useCollections } from '../api/hooks';
import { useIsElectron, useMediaQuery } from '../lib/hooks';

interface LayoutProps {
  children: ReactNode;
  onOpenSearch: () => void;
  onNewCollection: () => void;
  title?: ReactNode;
}

export function Layout({ children, onOpenSearch, onNewCollection, title }: LayoutProps) {
  const { data: collections } = useCollections();
  const isElectron = useIsElectron();
  const isMobile = useMediaQuery('(max-width: 899px)');
  const [sheetOpen, setSheetOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const closeSheet = () => setSheetOpen(false);

  const navItem = (to: string, icon: string, label: string, exact = false) => (
    <NavLink
      to={to}
      end={exact}
      className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
      onClick={closeSheet}
    >
      <Icon name={icon} size={18} className="nav-icon" />
      <span>{label}</span>
    </NavLink>
  );

  return (
    <div className="app-shell">
      {isMobile && <div className={`sidebar-backdrop ${sheetOpen ? 'open' : ''}`} onClick={closeSheet} />}

      <aside className={`sidebar ${sheetOpen ? 'open' : ''}`}>
        {isElectron && <div className="drag-strip" />}
        <div className="sidebar-head">
          <div className="brand">
            <span className="brand-mark">
              <Icon name="archive" size={18} />
            </span>
            Collectory
          </div>
        </div>

        <div className="sidebar-scroll">
          <div className="nav-group">
            {navItem('/', 'home', 'Dashboard', true)}
            {navItem('/search', 'search', 'Search')}
          </div>

          <div className="nav-group">
            <div className="nav-group-label">
              <span className="eyebrow">Collections</span>
              <button className="btn-icon btn-ghost btn-sm" onClick={onNewCollection} aria-label="New collection" title="New collection">
                <Icon name="plus" size={16} />
              </button>
            </div>
            {(collections ?? []).map((c) => {
              const active = location.pathname.startsWith(`/c/${c.id}`);
              return (
                <button
                  key={c.id}
                  className={`nav-item ${active ? 'active' : ''}`}
                  onClick={() => {
                    navigate(`/c/${c.id}`);
                    closeSheet();
                  }}
                >
                  <CollectionDot color={c.color} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  <span className="nav-count">{c.itemCount ?? 0}</span>
                </button>
              );
            })}
            {collections && collections.length === 0 && (
              <button className="nav-item" onClick={onNewCollection} style={{ color: 'var(--ink-4)' }}>
                <Icon name="plus" size={18} className="nav-icon" />
                <span>Add your first</span>
              </button>
            )}
          </div>

          <div className="nav-group">
            {navItem('/import', 'upload', 'Import CSV')}
            {navItem('/report', 'print', 'Insurance Report')}
            {navItem('/trash', 'trash', 'Trash')}
          </div>
        </div>

        <div className="sidebar-foot">{navItem('/settings', 'settings', 'Settings')}</div>
      </aside>

      <main className="main">
        <header className="topbar">
          {isMobile && (
            <button className="btn-icon btn-ghost hamburger" onClick={() => setSheetOpen(true)} aria-label="Open menu">
              <Icon name="grid" size={18} />
            </button>
          )}
          {title && (
            <div className="topbar-title">
              <span className="tt-name">{title}</span>
            </div>
          )}
          <div className="spacer" />
          <button className="topbar-search" onClick={onOpenSearch} aria-label="Search (Command K)">
            <Icon name="search" size={16} />
            <span className="search-placeholder">Search…</span>
            <Kbd>⌘K</Kbd>
          </button>
        </header>
        {children}
      </main>
    </div>
  );
}
