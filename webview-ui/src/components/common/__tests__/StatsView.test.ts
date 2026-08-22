import { describe, it, expect, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import StatsView from '../StatsView.svelte';
import { i18n } from '../../../lib/i18n/index.svelte';

function deliverStats(byAuthor: Array<{ author: string; email: string; count: number }>, byWeekdayHour: Array<{ weekday: number; hour: number; count: number }> = []) {
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: 'statsData', payload: { byAuthor, byWeekdayHour } },
  }));
}

beforeEach(() => {
  i18n.setLocale('en');
  globalThis.__postedMessages = [];
});

describe('StatsView', () => {
  it('requests stats data on mount', () => {
    render(StatsView);
    const req = globalThis.__postedMessages.find(
      (m) => (m.data as { type?: string }).type === 'getStats'
    );
    expect(req).toBeDefined();
  });

  it('shows spinner before data arrives', () => {
    const { container } = render(StatsView);
    expect(container.querySelector('.loading')).not.toBeNull();
    expect(container.querySelector('.spinner')).not.toBeNull();
  });

  it('renders author rows when data arrives', async () => {
    const { container } = render(StatsView);
    deliverStats(
      [
        { author: 'Alice', email: 'a@x.com', count: 30 },
        { author: 'Bob', email: 'b@x.com', count: 10 },
      ],
      [{ weekday: 1, hour: 9, count: 5 }],
    );
    await waitFor(() => {
      expect(container.querySelectorAll('.author-row').length).toBe(2);
    });
    const text = container.textContent ?? '';
    expect(text).toContain('Alice');
    expect(text).toContain('Bob');
  });

  it('renders the 7×24 heatmap grid (7 rows + 1 header row, 24 cells per row)', async () => {
    const { container } = render(StatsView);
    deliverStats([{ author: 'A', email: 'a@x.com', count: 1 }], [{ weekday: 0, hour: 0, count: 1 }]);
    await waitFor(() => {
      expect(container.querySelectorAll('.heatmap-row').length).toBe(7);
    });
    const firstRow = container.querySelector('.heatmap-row')!;
    expect(firstRow.querySelectorAll('.heatmap-cell').length).toBe(24);
  });

  it('renders the 5-step legend', async () => {
    const { container } = render(StatsView);
    deliverStats([{ author: 'A', email: 'a@x.com', count: 1 }]);
    await waitFor(() => container.querySelector('.heatmap-legend'));
    expect(container.querySelectorAll('.heatmap-legend-cell').length).toBe(5);
  });

  it('repoChanged clears stale stats and requests fresh data', async () => {
    const { container } = render(StatsView);
    deliverStats([{ author: 'Old Repo', email: 'old@example.com', count: 3 }]);
    await waitFor(() => {
      expect(container.textContent).toContain('Old Repo');
    });
    globalThis.__postedMessages = [];

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'repoChanged', payload: { what: 'repo' } } }));

    await waitFor(() => {
      expect(container.querySelector('.spinner')).not.toBeNull();
      expect(container.textContent).not.toContain('Old Repo');
      expect(globalThis.__postedMessages.some(
        (m) => (m.data as { type?: string }).type === 'getStats'
      )).toBe(true);
    });
  });
});
