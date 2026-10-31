import { RenderMode, ServerRoute } from '@angular/ssr';
import { policySlugs } from './content';

/** Every page is rendered to HTML at build time; any other address gets the app's shell, which shows the not-found page. */
export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'policies', renderMode: RenderMode.Prerender },
  {
    path: 'policies/:slug',
    renderMode: RenderMode.Prerender,
    getPrerenderParams: async () => policySlugs.map((slug) => ({ slug })),
  },
  { path: '**', renderMode: RenderMode.Client },
];
