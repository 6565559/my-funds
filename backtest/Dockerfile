FROM python:3.12-slim
WORKDIR /app/backtest
COPY backtest/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backtest/ .
ENV BACKTEST_DB=/data/backtests.sqlite NUMBA_CACHE_DIR=/tmp/numba OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
CMD ["python", "worker.py"]
