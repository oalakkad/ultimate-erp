import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BarChart, LineChart, niceScale } from './charts.js';
import { UiProvider } from './shell.js';

const months = [
  { label: 'Jan', values: { fees: 1200, costs: 800 } },
  { label: 'Feb', values: { fees: 1500, costs: 900 } },
  { label: 'Mar', values: { fees: 900, costs: 950 } },
];
const common = {
  title: 'Fees and costs',
  data: months,
  format: (v: number) => `${v.toFixed(3)} KWD`,
  showTableLabel: 'Show table',
  showChartLabel: 'Show chart',
};
const two = [
  { key: 'fees', label: 'Fees' },
  { key: 'costs', label: 'Costs' },
];

const inProvider = (ui: React.ReactNode, dir: 'ltr' | 'rtl' = 'ltr') =>
  render(
    <UiProvider dir={dir} closeLabel="Close">
      {ui}
    </UiProvider>,
  );

describe('niceScale', () => {
  it('rounds the axis to clean steps', () => {
    expect(niceScale(1500)).toEqual([0, 500, 1000, 1500, 2000]);
    expect(niceScale(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceScale(0)).toEqual([0, 1]);
  });
});

describe('BarChart', () => {
  it('names every bar with its category, series and value (keyboard reachable)', () => {
    inProvider(<BarChart {...common} series={two} />);
    const bar = document.querySelector('[aria-label="Feb, Fees: 1500.000 KWD"]');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute('tabindex')).toBe('0');
  });

  it('shows a legend for two series and none for one', () => {
    const { unmount } = inProvider(<BarChart {...common} series={two} />);
    expect(screen.getByText('Costs')).toBeInTheDocument();
    unmount();
    inProvider(<BarChart {...common} series={[two[0] ?? { key: 'fees', label: 'Fees' }]} />);
    expect(screen.queryByText('Fees')).toBeNull();
  });

  it('offers the same numbers as a table', async () => {
    inProvider(<BarChart {...common} series={two} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show table' }));
    const table = screen.getByRole('table', { name: 'Fees and costs' });
    const feb = within(table).getByRole('row', { name: /Feb/ });
    expect(within(feb).getByText('1500.000 KWD')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show chart' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('shows a tooltip when a bar gets keyboard focus', () => {
    inProvider(<BarChart {...common} series={two} />);
    const bar = document.querySelector('[aria-label="Mar, Costs: 950.000 KWD"]');
    if (!bar) throw new Error('bar missing');
    fireEvent.focus(bar);
    expect(screen.getByRole('status')).toHaveTextContent('950.000 KWD');
  });

  it('mirrors category order right-to-left in Arabic', () => {
    const xOf = (label: string) =>
      Number(
        [...document.querySelectorAll('svg text')]
          .find((t) => t.textContent === label)
          ?.getAttribute('x'),
      );
    const { unmount } = inProvider(<BarChart {...common} series={two} />);
    expect(xOf('Jan')).toBeLessThan(xOf('Mar'));
    unmount();
    inProvider(<BarChart {...common} series={two} />, 'rtl');
    expect(xOf('Jan')).toBeGreaterThan(xOf('Mar'));
  });
});

describe('LineChart', () => {
  it('lists every series at the focused point, moving with the arrow keys', () => {
    inProvider(<LineChart {...common} series={two} />);
    const overlay = document.querySelector('rect[tabindex="0"]');
    if (!(overlay instanceof SVGElement)) throw new Error('overlay missing');
    fireEvent.focus(overlay);
    const tip = screen.getByRole('status');
    expect(tip).toHaveTextContent('Mar');
    expect(tip).toHaveTextContent('900.000 KWD');
    expect(tip).toHaveTextContent('950.000 KWD');
    fireEvent.keyDown(overlay, { key: 'ArrowLeft' });
    expect(screen.getByRole('status')).toHaveTextContent('1500.000 KWD');
  });
});
