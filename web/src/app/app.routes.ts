import { ResolveFn, Routes } from '@angular/router';
import { NOT_FOUND_TITLE, oneIdWording, pages, site } from './content';
import { NotFound } from './not-found';
import { Page } from './page';

const title: ResolveFn<string> = (route) =>
  pages[route.data['slug'] ?? route.paramMap.get('slug') ?? '']?.title ?? NOT_FOUND_TITLE;

export const routes: Routes = [
  { path: '', component: Page, data: { slug: 'index' }, title },
  { path: 'policies', component: Page, data: { slug: 'policies' }, title },
  { path: 'policies/:slug', component: Page, title },
  { path: 'check-in', loadComponent: () => import('./one-id/check-in').then((m) => m.CheckIn), title: `${oneIdWording.traveler.checkIn.documentTitle}: ${site.airline}` },
  { path: 'wallet', loadComponent: () => import('./one-id/wallet').then((m) => m.Wallet), title: `${oneIdWording.traveler.wallet.documentTitle}: ${site.airline}` },
  { path: 'gate', loadComponent: () => import('./one-id/gate').then((m) => m.Gate), title: `${oneIdWording.traveler.gate.documentTitle}: ${site.airline}` },
  { path: '**', component: NotFound, title: NOT_FOUND_TITLE },
];
