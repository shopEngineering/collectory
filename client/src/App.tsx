import { useCallback, useEffect, useState } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CommandPalette } from './components/CommandPalette';
import { NewCollectionModal } from './components/NewCollectionModal';
import { PinScreen } from './components/PinScreen';
import { PIN_REQUIRED_EVENT } from './api/client';
import { useHotkey } from './lib/hooks';
import { useSettings } from './api/hooks';
import { setCurrency } from './lib/format';

import { DashboardPage } from './pages/DashboardPage';
import { BrowsePage } from './pages/BrowsePage';
import { ItemFormPage } from './pages/ItemFormPage';
import { ItemDetailPage } from './pages/ItemDetailPage';
import { CollectionSettingsPage } from './pages/CollectionSettingsPage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { ImportPage } from './pages/ImportPage';
import { ReportPage } from './pages/ReportPage';
import { TrashPage } from './pages/TrashPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newCollOpen, setNewCollOpen] = useState(false);
  const [pinRequired, setPinRequired] = useState(false);
  const navigate = useNavigate();

  // Currency setting → global formatter.
  const { data: settings } = useSettings();
  useEffect(() => {
    if (settings?.currency) setCurrency(settings.currency);
  }, [settings?.currency]);

  // PIN gate: listen for 401 PIN_REQUIRED signals from the api client.
  useEffect(() => {
    const onPin = () => setPinRequired(true);
    window.addEventListener(PIN_REQUIRED_EVENT, onPin);
    return () => window.removeEventListener(PIN_REQUIRED_EVENT, onPin);
  }, []);

  // ⌘K opens the command palette.
  useHotkey('mod+k', (e) => {
    e.preventDefault();
    setPaletteOpen((o) => !o);
  });

  // Electron menu navigation bridge.
  useEffect(() => {
    const bridge = (window as unknown as { collectory?: { onNavigate?: (cb: (path: string) => void) => void } }).collectory;
    if (bridge?.onNavigate) {
      bridge.onNavigate((path: string) => navigate(path));
    }
  }, [navigate]);

  const openSearch = useCallback(() => setPaletteOpen(true), []);
  const openNewColl = useCallback(() => setNewCollOpen(true), []);

  if (pinRequired) {
    return <PinScreen onSuccess={() => setPinRequired(false)} />;
  }

  return (
    <>
      <Layout onOpenSearch={openSearch} onNewCollection={openNewColl}>
        <Routes>
          <Route path="/" element={<DashboardPage onNewCollection={openNewColl} />} />
          <Route path="/c/:collectionId" element={<BrowsePage />} />
          <Route path="/c/:collectionId/new" element={<ItemFormPage mode="create" />} />
          <Route path="/c/:collectionId/settings" element={<CollectionSettingsPage />} />
          <Route path="/items/:itemId" element={<ItemDetailPage />} />
          <Route path="/items/:itemId/edit" element={<ItemFormPage mode="edit" />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/report" element={<ReportPage />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Layout>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNewCollection={openNewColl} />
      <NewCollectionModal open={newCollOpen} onClose={() => setNewCollOpen(false)} />
    </>
  );
}
