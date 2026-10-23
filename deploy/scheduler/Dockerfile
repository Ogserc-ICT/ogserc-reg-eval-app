# Scheduler: nightly encrypted backups (pg_dump 16, matching the database) and the 06:00 daily review.
FROM postgres:16.6-alpine
RUN apk add --no-cache curl openssl rclone tzdata
COPY --chmod=755 backup.sh restore.sh daily-review.sh healthcheck.sh entrypoint.sh /usr/local/bin/
COPY crontab /etc/crontabs/root
ENV TZ=Africa/Lagos
HEALTHCHECK --interval=10m --timeout=10s --start-period=1m CMD /usr/local/bin/healthcheck.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
