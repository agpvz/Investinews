import { describe, it, expect } from 'vitest';
import { titleKey, periodMarkers, isMaterial, correctionFlags, stripHtml, tokens } from '../src/core/text.ts';
import { inQuietHours, quietHoursEnd } from '../src/core/time.ts';

describe('text helpers', () => {
  it('normalizes titles and strips publisher suffixes', () => {
    expect(titleKey('Nvidia Beats Estimates - Reuters')).toBe('nvidia beats estimates');
    expect(titleKey('BREAKING: Nvidia beats estimates!')).toBe('nvidia beats estimates');
  });
  it('extracts fiscal period markers', () => {
    expect([...periodMarkers('Nvidia Q1 2025 results')].sort()).toEqual(['2025', 'q1']);
    expect([...periodMarkers('Nvidia second quarter earnings')]).toEqual(['q2']);
  });
  it('flags material headlines and forms', () => {
    expect(isMaterial('Company announces acquisition of rival')).toBe(true);
    expect(isMaterial('Company opens new cafeteria')).toBe(false);
    expect(isMaterial('anything', '8-K')).toBe(true);
    expect(isMaterial('anything', '4')).toBe(false);
  });
  it('detects corrections', () => { expect(correctionFlags('CORRECTION: Nvidia results')).toEqual(['correction']); expect(correctionFlags('Nvidia results')).toEqual([]); });
  it('strips html and entities', () => { expect(stripHtml('<p>A &amp; <b>B</b></p><script>x</script>')).toBe('A & B'); });
  it('tokenizes without stopwords', () => { expect(tokens('The Fed and the market')).toEqual(['fed', 'market']); });
});

describe('quiet hours (Africa/Johannesburg, UTC+2)', () => {
  const tz = 'Africa/Johannesburg';
  it('handles ranges crossing midnight', () => {
    const t2300 = Date.UTC(2026, 0, 10, 21, 0); // 23:00 SAST
    const t0800 = Date.UTC(2026, 0, 10, 6, 0); // 08:00 SAST
    expect(inQuietHours(t2300, '22:00', '07:00', tz)).toBe(true);
    expect(inQuietHours(t0800, '22:00', '07:00', tz)).toBe(false);
    expect(inQuietHours(t2300, null, null, tz)).toBe(false);
  });
  it('finds the end of quiet hours', () => {
    const t2300 = Date.UTC(2026, 0, 10, 21, 0);
    const end = quietHoursEnd(t2300, '22:00', '07:00', tz);
    expect(end).toBe(Date.UTC(2026, 0, 11, 5, 0)); // 07:00 SAST next day
  });
});
