# The nightly backup (feature 18c): the database's own PostgreSQL image, so
# pg_dump matches the server, plus OpenSSL to encrypt each file.
FROM postgres:18-alpine
RUN apk add --no-cache openssl
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod 755 /usr/local/bin/backup.sh
# Not the image's database server entrypoint: this container only runs backups.
ENTRYPOINT []
CMD ["backup.sh", "schedule"]
