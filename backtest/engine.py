"""Deterministic, buy-only NAV simulations. No portfolio or brokerage access."""
import bisect
import calendar
from datetime import date
import sqlite3
import sys
import time
import numpy as np
import pandas as pd
import vectorbt as vbt
from numba import njit
from vectorbt.portfolio import nb
from vectorbt.portfolio.enums import SizeType, Direction, OrderStatus

METHOD_VERSION = 'dca-nav-reinvest-lag1-v1'

def rolling_temperatures(rows, years):
    result, values, active, valid_dates = {}, [], [], []
    left = 0
    first = next((r['date'] for r in rows if r['value'] is not None), None)
    for row in rows:
        d = date.fromisoformat(row['date'])
        y = d.year - years
        start = date(y, d.month, min(d.day, calendar.monthrange(y, d.month)[1])).isoformat()
        while left < len(active) and active[left][0] < start:
            values.pop(bisect.bisect_left(values, active[left][1]))
            left += 1
        value = row['value']
        if value is None or not np.isfinite(value) or value <= 0:
            continue
        bisect.insort(values, value)
        active.append((row['date'], value))
        valid_dates.append(row['date'])
        if first and first <= start and len(values) >= 200 * years and (date.fromisoformat(active[left][0])-date.fromisoformat(start)).days <= 31:
            boundaries = [date(d.year-n,d.month,min(d.day,calendar.monthrange(d.year-n,d.month)[1])).isoformat() for n in range(years+1)]
            if all(bisect.bisect_right(valid_dates,upper)-bisect.bisect_right(valid_dates,lower)>=200 for upper,lower in zip(boundaries,boundaries[1:])):
                result[row['date']] = bisect.bisect_right(values, value) / len(values) * 100
    return result

@njit(cache=True)
def order_func(c, signal_nav, temperatures, monthly, mode, budget_cents, parts, buy_below, drop, fee, anchor, count):
    if count[0] >= parts:
        return nb.order_nothing_nb()
    if mode == 0:
        if np.isnan(temperatures[c.i]) or temperatures[c.i] > buy_below:
            return nb.order_nothing_nb()
        if count[0] > 0 and signal_nav[c.i] > anchor[0] * (1 - drop / 100) + 1e-12:
            return nb.order_nothing_nb()
    elif mode == 1 and not monthly[c.i]:
        return nb.order_nothing_nb()
    elif mode == 2 and c.i != 0:
        return nb.order_nothing_nb()
    if mode == 2:
        gross = budget_cents / 100
    elif count[0] == parts - 1:
        gross = (budget_cents - (budget_cents // parts) * (parts - 1)) / 100
    else:
        gross = (budget_cents // parts) / 100
    # Value sizing uses the previous valuation price, which is missing on the first bar.
    return nb.order_nb(size=gross / (1 + fee) / c.close[c.i, c.col], price=c.close[c.i, c.col], size_type=SizeType.Amount,
                       direction=Direction.LongOnly, fees=fee, allow_partial=False)

@njit(cache=True)
def post_order(c, anchor, count):
    if c.order_result.status == OrderStatus.Filled:
        anchor[0] = c.order_result.price
        count[0] += 1

def simulate(dates, prices, signal_prices, temperatures, budget_cents, parts, buy_below, drop, fee, mode):
    close = pd.Series(prices, index=pd.to_datetime(dates), dtype=float)
    months = np.array([i == 0 or d[:7] != dates[i-1][:7] for i, d in enumerate(dates)])
    anchor, count = np.zeros(1), np.zeros(1, dtype=np.int64)
    temps = np.array([np.nan if t is None else t for t in temperatures], dtype=float)
    pf = vbt.Portfolio.from_order_func(close, order_func, np.asarray(signal_prices,dtype=float), temps,
         months, {'dip':0,'monthly':1,'lump':2}[mode], budget_cents, parts, buy_below, drop, fee,
         anchor, count, post_order_func_nb=post_order, post_order_args=(anchor,count), init_cash=budget_cents/100, freq='1D')
    values, cash = pf.value().to_numpy(), pf.cash().to_numpy()
    orders = []
    for o in pf.orders.records_arr:
        i = int(o['idx'])
        orders.append({'date':dates[i], 'price':float(o['price']), 'units':float(o['size']),
                       'amount':float(o['price']*o['size']+o['fees']), 'fees':float(o['fees']),
                       'temperature':temperatures[i] if mode == 'dip' else None})
    initial = budget_cents / 100
    final = float(values[-1])
    days = (date.fromisoformat(dates[-1])-date.fromisoformat(dates[0])).days
    # Include initial cash so a first-day fee is part of drawdown.
    peaks = np.maximum.accumulate(np.r_[initial,values])[1:]
    return {'summary':{'finalValue':final,'returnPct':(final/initial-1)*100,
        'annualizedPct':((final/initial)**(365.25/max(1,days))-1)*100,
        'drawdownPct':float(np.min(values/peaks-1)*100),'spent':sum(o['amount'] for o in orders),
        'cash':float(cash[-1]),'fees':sum(o['fees'] for o in orders),'buys':len(orders)},
        'orders':orders,'equity':[{'date':d,'value':float(v),'cash':float(c)} for d,v,c in zip(dates,values,cash)]}

def prepare_inputs(prices, valuations, years):
    temps = rolling_temperatures(valuations, years)
    adjusted = [prices[0]['nav']]
    for p in prices[1:]:
        if p['pct'] is None or not np.isfinite(p['pct']) or p['pct'] <= -100 or abs(p['pct']) > 50:
            raise ValueError('日收益率缺失或异常，无法复权')
        adjusted.append(adjusted[-1]*(1+p['pct']/100))
    signal_temps = []
    for prev, current in zip(prices,prices[1:]):
        gap = (date.fromisoformat(current['date'])-date.fromisoformat(prev['date'])).days
        signal_temps.append(temps.get(prev['date']) if gap <= 7 else None)
    if not signal_temps or signal_temps[0] is None:
        raise ValueError('起始日之前缺少完整估值窗口或同日信号，请后移开始日期')
    return adjusted[1:], adjusted[:-1], signal_temps

def run_job(db, run_id):
    db.row_factory = sqlite3.Row
    run = dict(db.execute('SELECT * FROM runs WHERE id=?',(run_id,)).fetchone())
    if run['status'] != 'running':
        raise ValueError('任务状态无效')
    prices = [dict(r) for r in db.execute('SELECT date,nav,pct FROM input_prices WHERE run_id=? ORDER BY date',(run_id,))]
    valuations = [dict(r) for r in db.execute('SELECT date,value FROM input_valuations WHERE run_id=? ORDER BY date',(run_id,))]
    adjusted, signals, temperatures = prepare_inputs(prices, valuations, run['window_years'])
    dates = [p['date'] for p in prices[1:]]
    variants = list(db.execute('SELECT * FROM variants WHERE run_id=? ORDER BY rowid',(run_id,)))
    results = [(v['name'],simulate(dates,adjusted,signals,temperatures,run['budget_cents'],run['parts'],
                run['buy_below'],v['drop_pct'],run['fee_pct']/100,v['mode'])) for v in variants]
    with db:
        for name,result in results:
            s = result['summary']
            db.execute('INSERT INTO summaries VALUES (?,?,?,?,?,?,?,?,?,?)',
                       (run_id,name,s['finalValue'],s['returnPct'],s['annualizedPct'],s['drawdownPct'],s['spent'],s['cash'],s['fees'],s['buys']))
            db.executemany('INSERT INTO equity VALUES (?,?,?,?,?)',[(run_id,name,r['date'],r['value'],r['cash']) for r in result['equity']])
            by_date = {d:prices[i]['date'] for i,d in enumerate(dates)}
            db.executemany('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?)',[(run_id,name,o['date'],by_date[o['date']],o['temperature'],o['price'],o['units'],o['amount'],o['fees']) for o in result['orders']])
        db.execute("UPDATE runs SET status='completed',engine_version=?,method_version=?,actual_start=?,actual_end=?,skipped_days=?,finished_at=? WHERE id=?",
                   (vbt.__version__,METHOD_VERSION,dates[0],dates[-1],sum(t is None for t in temperatures),int(time.time()*1000),run_id))

if __name__ == '__main__':
    connection = sqlite3.connect(sys.argv[1],timeout=5)
    try:
        run_job(connection,sys.argv[2])
    except Exception as error:
        connection.rollback()
        with connection:
            connection.execute("UPDATE runs SET status='failed',error=?,finished_at=? WHERE id=?",(str(error)[:400],int(time.time()*1000),sys.argv[2]))
        raise
    finally:
        connection.close()
