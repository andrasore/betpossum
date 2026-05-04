FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml .
RUN pip install --no-cache-dir .
COPY docsrc/ src/
#TODO fix
COPY proto/ proto/
RUN python -m grpc_tools.protoc -Iproto --python_out=src proto/events.proto
WORKDIR /app/src
EXPOSE 8000
CMD ["gunicorn", "main:app", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "2"]
