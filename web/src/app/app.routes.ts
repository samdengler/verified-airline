import { ResolveFn, Routes } from '@angular/router';
import { NOT_FOUND_TITLE, pages } from './content';
import { NotFound } from './not-found';
import { Page } from './page';

const title: ResolveFn<string> = (route) =>
  pages[route.data['slug'] ?? route.paramMap.get('slug') ?? '']?.title ?? NOT_FOUND_TITLE;

export const routes: Routes = [
  { path: '', component: Page, data: { slug: 'index' }, title },
  { path: 'policies', component: Page, data: { slug: 'policies' }, title },
  { path: 'policies/:slug', component: Page, title },
  { path: '**', component: NotFound, title: NOT_FOUND_TITLE },
];
