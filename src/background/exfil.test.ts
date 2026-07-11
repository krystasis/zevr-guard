import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  buildHaystack,
  computeEntry,
  isThirdPartySend,
  maskValue,
  scan,
  base64Of,
} from './exfil';

const EMAIL = 'Taro.Yamada@Example.com';
const NORM = 'taro.yamada@example.com';

async function entry() {
  const e = await computeEntry({ id: '1', kind: 'email', value: EMAIL });
  if (!e) throw new Error('entry was null');
  return e;
}

describe('exfil: token computation', () => {
  it('normalizes case/whitespace before hashing (matches ad-tech)', async () => {
    const e = await entry();
    expect(e.tokensLower).toContain(NORM);
    expect(e.tokensLower).toContain(createHash('sha256').update(NORM).digest('hex'));
    expect(e.tokensLower).toContain(createHash('sha1').update(NORM).digest('hex'));
    expect(e.tokensLower).toContain(createHash('md5').update(NORM).digest('hex'));
    expect(e.tokensRaw).toContain(base64Of(NORM));
  });

  it('rejects values that are too short to watch safely', async () => {
    expect(await computeEntry({ id: 'x', kind: 'custom', value: 'abc' })).toBeNull();
  });

  it('masks the value for display and never exposes the raw form', async () => {
    expect(maskValue('email', EMAIL)).toBe('Ta*********@Example.com');
    expect(maskValue('phone', '09012345678')).toBe('09*******78');
    const e = await entry();
    expect(e.display).not.toContain('yamada');
  });
});

describe('exfil: scan', () => {
  it('catches cleartext sends', async () => {
    const e = await entry();
    const hay = buildHaystack('https://tracker.net/collect', `email=${NORM}`);
    expect(scan(hay, [e]).map((h) => h.id)).toEqual(['1']);
  });

  it('catches url-encoded sends', async () => {
    const e = await entry();
    const hay = buildHaystack(
      'https://tracker.net/p?u=taro.yamada%40example.com',
      '',
    );
    expect(scan(hay, [e])).toHaveLength(1);
  });

  it('catches sha256-hashed sends (Enhanced Conversions style)', async () => {
    const e = await entry();
    const sha = createHash('sha256').update(NORM).digest('hex');
    const hay = buildHaystack('https://ads.example-adtech.com/px', `em=${sha}`);
    expect(scan(hay, [e])).toHaveLength(1);
  });

  it('catches md5-hashed sends', async () => {
    const e = await entry();
    const md5 = createHash('md5').update(NORM).digest('hex');
    const hay = buildHaystack('https://pixel.net/x', JSON.stringify({ h: md5 }));
    expect(scan(hay, [e])).toHaveLength(1);
  });

  it('catches base64-encoded sends', async () => {
    const e = await entry();
    const hay = buildHaystack('https://t.co/x', `d=${base64Of(NORM)}`);
    expect(scan(hay, [e])).toHaveLength(1);
  });

  it('does not fire when the value is absent', async () => {
    const e = await entry();
    const hay = buildHaystack('https://tracker.net/collect', 'email=someone@else.com');
    expect(scan(hay, [e])).toHaveLength(0);
  });
});

describe('exfil: first-party exclusion', () => {
  it('treats a send to the page\'s own registrable domain as first-party', () => {
    expect(isThirdPartySend('https://shop.example.com', 'https://api.example.com/x')).toBe(false);
  });

  it('flags a send to a different registrable domain', () => {
    expect(isThirdPartySend('https://shop.example.com', 'https://tracker.net/collect')).toBe(true);
  });

  it('stays quiet when there is no page context', () => {
    expect(isThirdPartySend(undefined, 'https://tracker.net/x')).toBe(false);
  });
});
