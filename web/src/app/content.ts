// The pages, written by `scripts/render_airline.py --content` (`npm run
// content`).  Each page's band and body are HTML the renderer built from
// content/ and model/ and checked: every amount comes from facts.json and every
// status from model.json.
import content from '../generated/content.json';

export interface PageContent {
  path: string;
  title: string;
  band: string;
  body: string;
}

export const site = {
  airline: content.airline,
  footer: content.footer,
  modelSite: content.source.site,
};

/** The Lean model's repository, which commits link into. */
export const modelRepository = content.source.repository;

export const pages: Readonly<Record<string, PageContent>> = content.pages;

/** The support chat's wording, from content/chat.json, which the renderer checks as it checks the pages. */
export const chatWording = content.chat;

/** The check-in, wallet and gate screens' wording, from content/one-id.json, which the renderer checks against the One ID model. */
export const oneIdWording = content.oneId;

/** The six policy pages, under /policies/. */
export const policySlugs = Object.keys(pages).filter((slug) => slug !== 'index' && slug !== 'policies');

export const NOT_FOUND_TITLE = `Page not found: ${site.airline}`;
