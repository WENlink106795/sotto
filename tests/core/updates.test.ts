import { describe, expect, it } from 'vitest';
import { compareVersions } from '@core/updates';

describe('compareVersions', () => {
  it('compares normal semantic versions', () => {
    expect(compareVersions('0.1.1', '0.1.0')).toBeGreaterThan(0);
    expect(compareVersions('v0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-beta')).toBeGreaterThan(0);
    expect(compareVersions('0.1.3b', '0.1.3')).toBeGreaterThan(0);
    expect(compareVersions('0.1.3b', '0.1.4')).toBeLessThan(0);
    expect(compareVersions('0.1.3b', '0.1.1')).toBeGreaterThan(0);
  });
});
