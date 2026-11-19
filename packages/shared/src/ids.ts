import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford-ish base32, lowercase

export function randomToken(length = 24): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % 32];
  return out;
}

export type IdPrefix =
  | "usr" | "ses" | "tok" | "org" | "inv" | "app" | "env" | "agt" | "eus" | "asn" | "cnv" | "msg"
  | "src" | "doc" | "chk" | "syn" | "man" | "onb" | "onp" | "lsn" | "trs" | "act" | "axe" | "use"
  | "sub" | "aud" | "evt" | "sag" | "job" | "whk" | "ten" | "crt";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomToken(20)}`;
}
