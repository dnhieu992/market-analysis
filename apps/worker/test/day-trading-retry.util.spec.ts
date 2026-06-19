import { withRetry } from '../src/modules/day-trading/retry.util';

const noSleep = () => Promise.resolve();

describe('withRetry', () => {
  it('returns immediately on first success (no retries)', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { label: 'test', sleep: noSleep });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries up to the limit then throws the last error', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(withRetry(fn, { label: 'test', retries: 3, sleep: noSleep })).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('succeeds on a later attempt and stops retrying', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('recovered');
    const result = await withRetry(fn, { label: 'test', retries: 3, sleep: noSleep });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry when isRetryable returns false (fail fast)', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('permanent'));
    await expect(
      withRetry(fn, { label: 'test', retries: 3, sleep: noSleep, isRetryable: () => false }),
    ).rejects.toThrow('permanent');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('applies exponential backoff delays between attempts', async () => {
    const delays: number[] = [];
    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(
      withRetry(fn, {
        label: 'test',
        retries: 3,
        baseDelayMs: 500,
        sleep: (ms) => { delays.push(ms); return Promise.resolve(); },
      }),
    ).rejects.toThrow('boom');
    // Two sleeps between three attempts: 500, then 1000.
    expect(delays).toEqual([500, 1000]);
  });
});
