import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

class WorkerTest(unittest.TestCase):
    def test_restart_marks_interrupted_job_and_persists_health(self):
        root=Path(__file__).parent
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'backtests.sqlite'
            db=sqlite3.connect(file)
            db.executescript((root/'schema.sql').read_text())
            db.execute("INSERT INTO runs(id,request_hash,created_at,status,fund_code,index_code,metric,window_years,start_date,end_date,budget_cents,parts,buy_below,fee_pct) VALUES ('interrupted','h',0,'running','110020','000300.SH','pe',5,'2022-01-01','2022-01-31',10000,10,20,0)")
            db.commit()
            process=subprocess.Popen([sys.executable,str(root/'worker.py')],env={**os.environ,'BACKTEST_DB':str(file)})
            try:
                deadline=time.monotonic()+10
                while not db.execute('SELECT 1 FROM worker_health').fetchone() and time.monotonic()<deadline:
                    time.sleep(.05)
                self.assertEqual(db.execute('SELECT status FROM runs').fetchone()[0],'failed')
                self.assertGreater(db.execute('SELECT heartbeat FROM worker_health').fetchone()[0],0)
            finally:
                process.terminate();process.wait(timeout=10);db.close()
            db=sqlite3.connect(file)
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            self.assertEqual(db.execute('SELECT status FROM runs').fetchone()[0],'failed')
            db.close()

if __name__=='__main__': unittest.main()
