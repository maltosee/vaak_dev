# runpod_tts/Dockerfile
FROM runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    wget \
    curl \
    build-essential \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Install additional WebSocket dependencies
RUN pip install --no-cache-dir \
    fastapi[all]==0.104.1 \
    uvicorn[standard]==0.24.0 \
    websockets==12.0 \
    python-multipart==0.0.6

# Copy application code
COPY . .

# Create model cache directory
RUN mkdir -p /app/models

# Set environment variables
ENV PYTHONPATH=/app
ENV TORCH_HOME=/app/models
ENV HF_HOME=/app/models
ENV TRANSFORMERS_CACHE=/app/models

# Expose WebSocket port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Start the WebSocket service
CMD ["python", "runpod_ws_service.py"]