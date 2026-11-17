import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { api, AuthRequired } from '../api';
import IndexTemperatureView from './IndexTemperatureView';

vi.mock('../api', async importOriginal => ({ ...await importOriginal(), api: {
  indexValuations: vi.fn(), indexValuationHistory: vi.fn(),
} }));
vi.mock('./Chart', () => ({ default: ({ label }) => <div role="img" aria-label={label} /> }));
const metric = (temperature, band, status = 'ok') => ({ value: 13.44, temperature, band, status, date: '2026-11-16', sampleCount: 2428, historyStart: '2016-11-16', historyEnd: '2026-11-16' });
const data = () => ({ window: '10y', metric: 'pe', source: { name: '韭圈', url: 'https://www.jiucaishuo.com/indicators?tab=index', methodology: '原始日样本分位' }, covered: 2, excluded: 1,
  distribution: { low: 1, cool: 0, warm: 1, high: 0 }, rows: [
    { code: '000300.SH', name: '沪深300', pe: metric(65.2, 'warm'), pb: metric(23, 'cool') },
    { code: '000905.SH', name: '中证500', pe: metric(12.3, 'low'), pb: metric(55, 'warm') },
    { code: '399673.SZ', name: '创业板50', pe: { ...metric(null, null, 'error'), value: null, date: null }, pb: metric(null, null, 'insufficient') },
  ] });
beforeEach(() => {
  vi.clearAllMocks();
  api.indexValuations.mockResolvedValue(data());
  api.indexValuationHistory.mockResolvedValue({ ...metric(65.2, 'warm'), series: [{ date: '2016-11-16', value: 12 }, { date: '2026-11-16', value: 13.44 }], source: data().source });
});
afterEach(cleanup);

test('按温度排序并搜索，缺失值不进入低估分布', async () => {
  render(<IndexTemperatureView active />);
  await screen.findByText('沪深300');
  const rows = within(screen.getByRole('table')).getAllByRole('row');
  expect(rows[1].textContent).toContain('中证500');
  expect(rows[3].textContent).toContain('数据不可用');
  expect(screen.getByText(/已覆盖指数估值分布/)).toBeTruthy();
  expect(screen.getByText(/2 个有效.*1 个未纳入/)).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: '搜索指数' }), { target: { value: '300' } });
  expect(screen.queryByText('中证500')).toBeNull();
  expect(screen.getByText('沪深300')).toBeTruthy();
});

test('按档位筛选，打开真实历史元数据并切换窗口', async () => {
  render(<IndexTemperatureView active />);
  await screen.findByText('沪深300');
  fireEvent.click(screen.getByRole('button', { name: /筛选低估/ }));
  expect(screen.queryByText('沪深300')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /筛选低估/ }));
  fireEvent.click(screen.getByRole('button', { name: '查看沪深300历史估值' }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByText(/2,428 个有效样本/);
  expect(within(dialog).getByText(/2016-11-16/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
  fireEvent.click(screen.getByRole('button', { name: '近5年' }));
  await screen.findByText('沪深300');
  expect(api.indexValuations).toHaveBeenLastCalledWith('5y', 'pe', false);
});

test('切换指标后慢请求不得覆盖新结果，隐藏页签不加载', async () => {
  let resolveOld;
  api.indexValuations.mockImplementation((window, metric) => metric === 'pe'
    ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ ...data(), metric: 'pb' }));
  const { rerender } = render(<IndexTemperatureView active={false} />);
  expect(api.indexValuations).not.toHaveBeenCalled();
  rerender(<IndexTemperatureView active />);
  fireEvent.click(screen.getByRole('button', { name: 'PB 市净率' }));
  await screen.findByText('沪深300');
  resolveOld({ ...data(), rows: [] });
  await screen.findByText('沪深300');
  expect(screen.getByRole('button', { name: 'PB 市净率' }).getAttribute('aria-pressed')).toBe('true');
});

test('请求失败可重试，401交回现有登录处理', async () => {
  api.indexValuations.mockRejectedValueOnce(new Error('网络中断'));
  const expire = vi.fn();
  render(<IndexTemperatureView active onAuthRequired={expire} />);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByText('沪深300');
  api.indexValuations.mockRejectedValueOnce(new AuthRequired());
  fireEvent.click(screen.getByRole('button', { name: '更新估值' }));
  await vi.waitFor(() => expect(expire).toHaveBeenCalledOnce());
});
