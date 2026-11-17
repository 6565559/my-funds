import unittest
import sqlite3
from pathlib import Path
import pandas as pd
from engine import rolling_temperatures, simulate, prepare_inputs, run_job

class EngineTest(unittest.TestCase):
    def test_no_lookahead_and_warmup(self):
        rows=[{'date':'2021-01-01','value':1},{'date':'2026-01-01','value':2}]
        self.assertEqual(rolling_temperatures(rows,5),{})

    def test_sparse_year_is_not_compensated_by_other_years(self):
        rows=[{'date':d.date().isoformat(),'value':3.0} for d in pd.bdate_range('2015-01-01','2022-01-03') if d.year != 2019 or d.month <= 4]
        self.assertNotIn('2022-01-03',rolling_temperatures(rows,5))

    def test_actual_fill_anchor_lag_budget_and_fees(self):
        dates=['2022-01-03','2022-01-04','2022-01-05','2022-01-06','2022-01-07']
        result=simulate(dates,[1,.95,.96,.91,.90],[1,1,.95,.96,.91],[10]*5,10000,3,20,4,.01,'dip')
        self.assertEqual([o['date'] for o in result['orders']],['2022-01-03','2022-01-05','2022-01-07'])
        self.assertLessEqual(sum(o['amount'] for o in result['orders']),100.000001)
        self.assertAlmostEqual(result['summary']['cash'],0,places=6)
        self.assertGreater(result['summary']['fees'],0)

    def test_missing_signals_do_not_buy_and_cash_has_no_return(self):
        result=simulate(['2022-01-03','2022-01-04'],[1,.9],[1,1],[None,None],10000,10,20,4,0,'dip')
        self.assertEqual(result['orders'],[])
        self.assertEqual(result['summary']['returnPct'],0)

    def test_rolling_window_never_uses_future_and_dividend_does_not_fake_a_drop(self):
        rows=[{'date':d.date().isoformat(),'value':3.0} for d in pd.bdate_range('2015-01-01','2022-01-07')]
        rows[-3]['value']=1.0
        prefix=rolling_temperatures(rows[:-2],5)
        self.assertEqual(prefix, {k:v for k,v in rolling_temperatures(rows,5).items() if k <= rows[-3]['date']})
        self.assertNotIn('2019-12-31',prefix)
        prices=[{'date':'2022-01-05','nav':1,'pct':0},{'date':'2022-01-06','nav':.9,'pct':0},{'date':'2022-01-07','nav':.9,'pct':0}]
        adjusted,signals,temps=prepare_inputs(prices,rows,5)
        self.assertEqual(adjusted,[1,1])
        self.assertEqual(simulate(['2022-01-06','2022-01-07'],adjusted,signals,temps,10000,10,100,4,0,'dip')['summary']['buys'],1)

    def test_baselines_and_transactional_database_results(self):
        db=sqlite3.connect(':memory:')
        db.executescript((Path(__file__).parent/'schema.sql').read_text())
        db.execute("INSERT INTO runs(id,request_hash,created_at,status,fund_code,index_code,metric,window_years,start_date,end_date,budget_cents,parts,buy_below,fee_pct) VALUES ('run','h',0,'running','110020','000300.SH','pe',5,'2022-01-06','2022-02-07',10001,2,50,.15)")
        db.executemany("INSERT INTO variants VALUES ('run',?,?,?)", [('月定投','monthly',0),('一次买入','lump',0),('4%','dip',4)])
        db.executemany("INSERT INTO input_prices VALUES ('run',?,?,?)", [('2022-01-05',1,0),('2022-01-06',1,0),('2022-01-07',.9,-10),('2022-02-07',1,100/9)])
        db.executemany("INSERT INTO input_valuations VALUES ('run',?,?)",[(d.date().isoformat(),3.0) for d in pd.bdate_range('2015-01-01','2022-02-07')])
        db.commit();run_job(db,'run')
        self.assertEqual(db.execute("SELECT status FROM runs").fetchone()[0],'completed')
        self.assertEqual(db.execute('SELECT COUNT(*) FROM summaries').fetchone()[0],3)
        rows={r['name']:r for r in db.execute('SELECT * FROM summaries')}
        self.assertEqual(rows['一次买入']['buys'],1)
        self.assertEqual(rows['月定投']['buys'],2)
        self.assertAlmostEqual(rows['月定投']['spent'],100.01)
        self.assertEqual(rows['4%']['spent'],0)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM equity').fetchone()[0],9)
        db.close()

if __name__=='__main__': unittest.main()
