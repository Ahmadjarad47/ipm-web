import { describe, expect, it } from 'vitest';
import { hmacSha256, sha256 } from './hash';

const hex = (s: string): Uint8Array => new Uint8Array((s.match(/../g) ?? []).map((b) => parseInt(b, 16)));
const rep = (byte: number, n: number): Uint8Array => new Uint8Array(n).fill(byte);

describe('hmacSha256 (RFC 4231)', () => {
  it('case 1', () => {
    expect(hmacSha256(rep(0x0b, 20), 'Hi There')).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  });
  it('case 2', () => {
    expect(hmacSha256('Jefe', 'what do ya want for nothing?')).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });
  it('case 3', () => {
    expect(hmacSha256(rep(0xaa, 20), rep(0xdd, 50))).toBe('773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe');
  });
  it('case 4', () => {
    expect(hmacSha256(hex('0102030405060708090a0b0c0d0e0f10111213141516171819'), rep(0xcd, 50))).toBe('82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b');
  });
  it('case 6 (key longer than block)', () => {
    expect(hmacSha256(rep(0xaa, 131), 'Test Using Larger Than Block-Size Key - Hash Key First')).toBe('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
  });
  it('case 7 (long key and data)', () => {
    expect(hmacSha256(rep(0xaa, 131), 'This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.')).toBe('9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2');
  });
  it('sha256 still matches the known vector', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
