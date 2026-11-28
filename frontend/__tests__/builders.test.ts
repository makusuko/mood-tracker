/**
 * testing/builders time helpers — the defaults must actually apply (a missing
 * time part is undefined, not NaN) and localIso must refuse datetimes instead
 * of silently returning noon.
 */
import { localDateTimeIso, localIso } from '@/testing/builders';

describe('localDateTimeIso', () => {
    it('defaults a missing time part to local noon', () => {
        expect(localDateTimeIso('2026-06-15')).toBe(localIso('2026-06-15'));
    });

    it('defaults missing minutes/seconds, not just the hour', () => {
        // '2026-06-15T09:00' used to throw: Number(undefined) = NaN defeated ?? 0.
        expect(localDateTimeIso('2026-06-15T09:00')).toBe(localIso('2026-06-15', 9, 0));
    });

    it('keeps explicit seconds', () => {
        expect(localDateTimeIso('2026-06-15T09:00:30')).toBe(
            new Date(2026, 5, 15, 9, 0, 30).toISOString(),
        );
    });
});

describe('localIso', () => {
    it('throws on a datetime string instead of quietly returning noon', () => {
        expect(() => localIso('2026-02-02T09:00:00')).toThrow(/localDateTimeIso/);
    });
});
