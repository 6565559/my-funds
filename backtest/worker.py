"""One worker per database, bounded child lifetime, no network listener."""
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parent
DB=Path(os.environ.get('BACKTEST_DB','/data/backtests.sqlite'))
DB.parent.mkdir(parents=True,exist_ok=True)
db=sqlite3.connect(DB,timeout=5,isolation_level=None)
db.executescript((ROOT/'schema.sql').read_text())
db.execute("UPDATE runs SET status='failed',error='计算进程重启，请重新运行',finished_at=? WHERE status='running'",(int(time.time()*1000),))
child=None
def stop(*_):
    if child is not None and child.poll() is None:
        child.terminate()
        try: child.wait(timeout=5)
        except subprocess.TimeoutExpired: child.kill()
    sys.exit(0)
signal.signal(signal.SIGTERM,stop)
signal.signal(signal.SIGINT,stop)
def heartbeat():
    db.execute('INSERT INTO worker_health VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET heartbeat=excluded.heartbeat,version=excluded.version',(int(time.time()*1000),'1.2.1'))
while True:
    heartbeat()
    db.execute('BEGIN IMMEDIATE')
    row=db.execute("SELECT id FROM runs WHERE status='queued' ORDER BY created_at LIMIT 1").fetchone()
    if row: db.execute("UPDATE runs SET status='running' WHERE id=?",row)
    db.commit()
    if not row:
        time.sleep(2)
        continue
    child=subprocess.Popen([sys.executable,str(ROOT/'engine.py'),str(DB),row[0]])
    deadline=time.monotonic()+180
    while child.poll() is None and time.monotonic()<deadline:
        heartbeat()
        time.sleep(2)
    if child.poll() is None:
        child.kill()
        child.wait()
    db.execute("UPDATE runs SET status='failed',error='计算异常退出或超过三分钟，请缩短区间后重试',finished_at=? WHERE id=? AND status='running'",(int(time.time()*1000),row[0]))
    child=None
