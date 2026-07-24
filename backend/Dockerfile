FROM python:3.11-slim

WORKDIR /app

# Dipendenze sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Dipendenze Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Codice applicazione
COPY . .

# Porta esposta
EXPOSE 8500

# Avvio server
CMD ["uvicorn", "main_pg:app", "--host", "0.0.0.0", "--port", "8500"]
