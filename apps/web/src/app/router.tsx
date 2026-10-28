import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { UiProvider } from '@ultimate-erp/ui';
import { GalleryPage } from '../routes/gallery.js';
import { HomePage } from '../routes/home.js';
import { useI18n } from './i18n.js';

function RootLayout() {
  const { dir, t } = useI18n();
  return (
    <UiProvider dir={dir} closeLabel={t('ui.common.close')}>
      <Outlet />
    </UiProvider>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage });
const galleryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/gallery',
  component: GalleryPage,
});

export const router = createRouter({ routeTree: rootRoute.addChildren([homeRoute, galleryRoute]) });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
