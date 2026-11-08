// The two demo issuers and the relying party's list of trusted keys.  The keys are
// specimens with no secret in them: demo-issuers.json, private keys included, is
// public in this repository and in the site's script, as a demo needs.  The list of
// trusted keys stands in for the trust list the guide leaves out of scope (survey
// entries C-01 and C-15 in verified-id); the Lean model has no such list, and takes
// whether an issuer's signature is valid as a given field.
import file from './demo-issuers.json';
import { importSigningKey, importVerifyingKey } from './cose';
import type { SigningIssuer, TrustedKey } from './credential';

export interface DemoIssuer {
  kid: string;
  /** The name the issuer signs with, in the protected header. */
  name: string;
  /** The issuer the model's default presentations name for this kind of credential. */
  modelIssuer: string;
  /** The kind of credential it signs in the demo. */
  signs: 'photoid' | 'boardingPass';
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}

export const demoIssuers = file.issuers as DemoIssuer[];

/** The demo issuer that signs a kind of credential. */
export const issuerFor = (role: DemoIssuer['signs']): DemoIssuer => demoIssuers.find((i) => i.signs === role)!;

let trusted: Promise<TrustedKey[]> | null = null;

/** The relying party's list: the public half of each demo key. */
export function trustList(): Promise<TrustedKey[]> {
  trusted ??= Promise.all(demoIssuers.map(async (i) => ({ kid: i.kid, name: i.name, key: await importVerifyingKey(i.publicKey) })));
  return trusted;
}

const signing = new Map<string, Promise<SigningIssuer>>();

/** The demo issuer of a kind of credential, ready to sign. */
export function signingIssuer(role: DemoIssuer['signs']): Promise<SigningIssuer> {
  const i = issuerFor(role);
  let found = signing.get(i.kid);
  if (!found) {
    found = importSigningKey(i.privateKey).then((key) => ({ kid: i.kid, name: i.name, key }));
    signing.set(i.kid, found);
  }
  return found;
}
