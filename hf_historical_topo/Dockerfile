FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends gdal-bin libgdal-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
ENV PORT=7860 CSV_DIR=/data/csv CACHE_DIR=/data/cache
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "7860"]
