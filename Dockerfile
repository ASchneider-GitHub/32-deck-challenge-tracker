# 32 Deck Challenge Tracker
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DECK32_DB=/data/deck32.db \
    DECK32_BACKUP_DIR=/backups

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --root-user-action=ignore -r requirements.txt

COPY app.py manage.py ./
COPY static ./static
COPY deploy/backup.sh ./deploy/backup.sh

# Run as an unprivileged user. The database lives in /data (a volume), so it
# survives rebuilding or replacing the container.
RUN groupadd --system --gid 10001 deck32 \
    && useradd --system --uid 10001 --gid 10001 --no-create-home deck32 \
    && mkdir -p /data /backups && chown deck32:deck32 /data /backups
USER deck32
VOLUME ["/data"]

EXPOSE 8032
# No access log: request paths contain secret edit links. The control socket
# (gunicorn's runtime admin interface) isn't used, and needs a home directory.
CMD ["gunicorn", "--workers", "2", "--bind", "0.0.0.0:8032", "--no-control-socket", "app:app"]
