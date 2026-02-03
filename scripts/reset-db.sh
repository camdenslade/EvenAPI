#!/bin/sh

echo "Stopping Docker containers..."
docker compose down

echo "Listing volumes..."
docker volume ls

echo "Deleting DB volume: backend_postgres_data"
docker volume rm backend_postgres_data

echo "Rebuilding containers..."
docker compose up -d --build

echo "Database reset complete."
