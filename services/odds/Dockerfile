FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml .
RUN pip install --no-cache-dir .
COPY src/ src/
WORKDIR /app/src
EXPOSE 8000
CMD ["gunicorn", "main:app", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "2"]
