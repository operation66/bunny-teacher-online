# syntax=docker/dockerfile:1

FROM python:3.10-slim AS base

# Prevent Python from writing .pyc files and enable unbuffered logs
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 

WORKDIR /app

# Install system deps only if needed (kept minimal for slim image)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
 && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy backend application code
COPY backend/ /app/backend/

# Expose the application port
EXPOSE 8000

# Use uvicorn to serve FastAPI (Render will set PORT at runtime)
WORKDIR /app/backend
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT}
