// The issuer's signatures on the traveler's credentials.  The Lean model has no
// cryptography: in it, whether an issuer's signature is valid is a field of what a
// relying party receives (Presented.issuerSignatureValid).  Here that field comes
// from a real check, made on receipt with WebCrypto (signing/), before the model's
// checks run.  The format is this project's own; the keys are demo keys; the list
// of trusted keys stands in for the trust list the guide leaves out.
//
// On one device only the trip passes between tabs, so each screen signs the
// traveler's credentials with the demo issuers' keys, as the issuers would have,
// and checks what the wallet would send.  Between devices the relay carries the
// signed credentials: the boarding pass the website signs, and each credential the
// wallet presents.
import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, type Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { LeanModel } from '../lean-model';
import { credentialOf, fill, type Scenario, wording } from './data';
import { hasRef, mdocRefs, type Presented, type WalletResponse } from './rules/support/exchange';
import { boardingPassDocType, photoidDocType } from './rules/support/identifiers';
import type { Mdoc } from './rules/support/types';
import { check, type CheckedCredential, flipPayloadByte, fromBase64Url, issue, present, presentAll, type SignatureState, toBase64Url } from './signing/credential';
import { signingIssuer, trustList } from './signing/issuers';

export type Role = 'photoid' | 'boardingPass';

/** A signature as a screen shows it. */
export interface SignatureView {
  role: Role | null;
  docType: string;
  state: SignatureState;
  /** The issuer's name and the key's id from the protected header, when they can be read. */
  issuer: string | null;
  kid: string | null;
}

/** What a relying party received, after the signature checks. */
export interface CheckedResponse {
  /** The response the model's checks read: each document's data from its signed credential, and its signature's outcome in issuerSignatureValid. */
  response: WalletResponse;
  signatures: SignatureView[];
}

export const roleOf = (docType: string): Role | null => (docType === photoidDocType ? 'photoid' : docType === boardingPassDocType ? 'boardingPass' : null);

const view = (docType: string, c: CheckedCredential): SignatureView => ({ role: roleOf(docType), docType, state: c.state, issuer: c.issuer, kid: c.kid });

/** A document as the model's checks read it: its data from the signed credential when the signature checked, and the outcome either way. */
export function withSignature(d: Presented, c: CheckedCredential): Presented {
  return c.state === 'checked' && c.mdoc ? { ...d, mdoc: c.mdoc, issuerSignatureValid: true } : { ...d, issuerSignatureValid: false };
}

/** How long a phone keeps a credential the relay brought: SESSION_SECONDS in infra/verified_airline_infra/one_id_stack.py. */
const KEPT_MS = 10 * 60 * 1000;
const KEPT = 'verified-airline-one-id-credentials';

/** The words for a signature, from content/one-id.json. */
export function signatureWords(s: SignatureView): { state: string; signer: string | null } {
  const w = wording.traveler.signature;
  const signer = s.issuer ? fill(s.state === 'checked' ? w.signedBy : w.names, { issuer: s.issuer }) : null;
  return { state: w.states[s.state], signer };
}

/** The reason a refusal gives, when a signature failed: the first failed one, by the credential it is on. */
export function signatureReason(signatures: readonly SignatureView[]): string | null {
  const failed = signatures.find((s) => s.state !== 'checked');
  if (!failed) return null;
  const labels = wording.traveler.labels;
  const credential = (failed.role === 'photoid' ? labels.photoid : failed.role === 'boardingPass' ? labels.boardingPass : failed.docType).toLowerCase();
  return fill(wording.traveler.signature.reasons[failed.state as Exclude<SignatureState, 'checked'>], { credential });
}

@Injectable({ providedIn: 'root' })
export class Signatures {
  private readonly lean = inject(LeanModel);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  /** The credentials this device holds, by traveler and kind. */
  private readonly held = new Map<string, Promise<Uint8Array>>();
  private readonly tamperSwitch = signal(false);
  /** The presenter's tamper control.  It is behind the model toggle, so it applies only with the model shown. */
  readonly tampered = computed(() => this.lean.shown() && this.tamperSwitch());

  setTampered(on: boolean): void {
    this.tamperSwitch.set(on);
  }

  /**
   * The signed credential this device holds for one of a traveler's credentials: one
   * the relay brought, or else one signed here by its demo issuer, as it was issued.
   */
  holding(scenarioId: string, role: Role, m: Mdoc): Promise<Uint8Array> {
    const key = `${scenarioId} ${role}`;
    let found = this.held.get(key);
    if (!found) {
      const kept = this.recall(key);
      found = kept ? Promise.resolve(kept) : signingIssuer(role).then((issuer) => issue(m, issuer));
      this.held.set(key, found);
      // A failed signing is not kept, so the next screen tries again.
      found.catch(() => this.held.delete(key));
    }
    return found;
  }

  /** A credential the relay brought, kept for this traveler, and in localStorage for a session's length so a tab a code opens finds it. */
  keep(scenarioId: string, role: Role, credential: Uint8Array): void {
    const key = `${scenarioId} ${role}`;
    this.held.set(key, Promise.resolve(credential));
    try {
      const all = this.keptAll();
      all[key] = { credential: toBase64Url(credential), at: Date.now() };
      localStorage.setItem(KEPT, JSON.stringify(all));
    } catch {
      // private browsing
    }
  }

  private keptAll(): Record<string, { credential: string; at: number }> {
    try {
      const all: unknown = JSON.parse(localStorage.getItem(KEPT) ?? '{}');
      return all && typeof all === 'object' && !Array.isArray(all) ? (all as Record<string, { credential: string; at: number }>) : {};
    } catch {
      return {};
    }
  }

  private recall(key: string): Uint8Array | null {
    if (!this.browser) return null;
    const entry = this.keptAll()[key];
    if (!entry || typeof entry.credential !== 'string' || typeof entry.at !== 'number' || Date.now() - entry.at > KEPT_MS) return null;
    return fromBase64Url(entry.credential);
  }

  /** A held credential as base64url, for the relay. */
  async held64(scenario: Scenario, role: Role): Promise<string | null> {
    const m = credentialOf(scenario, role);
    return m ? toBase64Url(await this.holding(scenario.id, role, m)) : null;
  }

  /** What the wallet sends with a response: each document's signed credential, narrowed to the data elements the document holds. */
  async present(scenario: Scenario, response: WalletResponse): Promise<(string | null)[]> {
    return Promise.all(
      response.documents.map(async (d) => {
        const role = roleOf(d.mdoc.docType);
        const m = role && credentialOf(scenario, role);
        if (!role || !m) return null;
        const refs = mdocRefs(d.mdoc);
        const held = await this.holding(scenario.id, role, m);
        return toBase64Url(present(held, (nameSpace, identifier) => hasRef(refs, { docType: d.mdoc.docType, nameSpace, identifier })));
      }),
    );
  }

  /**
   * A relying party's check of what it received: each document's signed credential
   * against the trusted keys.  `tamper` flips one byte of that kind of credential
   * first, for the presenter's control.
   */
  async check(response: WalletResponse, credentials: readonly (string | null)[] | null | undefined, tamper: Role | null = null): Promise<CheckedResponse> {
    // Without WebCrypto there is no list to check against, and every credential is refused.
    const trusted = await trustList().catch(() => []);
    const checked = await Promise.all(
      response.documents.map(async (d, i) => {
        const text = credentials?.[i];
        let bytes = typeof text === 'string' ? fromBase64Url(text) : null;
        if (bytes && tamper && roleOf(d.mdoc.docType) === tamper) {
          try {
            bytes = flipPayloadByte(bytes);
          } catch {
            // Bytes that do not read are refused as they are.
          }
        }
        return check(bytes, trusted);
      }),
    );
    return {
      response: { documents: response.documents.map((d, i) => withSignature(d, checked[i])) },
      signatures: response.documents.map((d, i) => view(d.mdoc.docType, checked[i])),
    };
  }

  /** The wallet's check of a credential it holds, on receipt. */
  async checkHeld(scenario: Scenario, role: Role): Promise<SignatureView | null> {
    const m = credentialOf(scenario, role);
    if (!m) return null;
    const held = await this.holding(scenario.id, role, m);
    return view(m.docType, await check(presentAll(held), await trustList()));
  }
}

/**
 * The latest result of an async job, as a signal for a component: null while the job
 * for the current inputs runs, when `inputs` gives undefined, and before the page has
 * left the server.  A result for older inputs is dropped.  Call it in an injection
 * context.
 */
export function latest<P, T>(inputs: () => P | undefined, job: (p: P) => Promise<T>): Signal<T | null> {
  const browser = isPlatformBrowser(inject(PLATFORM_ID));
  const current = computed(() => (browser ? inputs() : undefined));
  const done = signal<{ for: P; value: T } | null>(null);
  effect(() => {
    const p = current();
    if (p === undefined) return;
    job(p).then(
      (value) => {
        if (untracked(current) === p) done.set({ for: p, value });
      },
      () => undefined,
    );
  });
  return computed(() => {
    const d = done();
    const p = current();
    return d && p !== undefined && d.for === p ? d.value : null;
  });
}
