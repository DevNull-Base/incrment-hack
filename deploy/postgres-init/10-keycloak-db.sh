#!/bin/sh
# Вторая база в том же экземпляре Postgres — под Keycloak.
#
# Отдельный контейнер с базой ради одного Keycloak на стенде не нужен: это
# ещё один процесс, ещё один том и ещё одна точка отказа. Разделение по базам
# и ролям даёт то же, что и разделение по контейнерам: Keycloak не видит
# данных CRM, CRM не видит таблиц Keycloak.
#
# Скрипт выполняется ТОЛЬКО при первой инициализации тома с данными.
# На существующем стенде он не запускается — Postgres его просто не читает.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE "$KEYCLOAK_DB_USER" WITH LOGIN PASSWORD '$KEYCLOAK_DB_PASSWORD';
  CREATE DATABASE "$KEYCLOAK_DB_NAME" OWNER "$KEYCLOAK_DB_USER";
  REVOKE ALL ON DATABASE "$KEYCLOAK_DB_NAME" FROM PUBLIC;
  GRANT ALL PRIVILEGES ON DATABASE "$KEYCLOAK_DB_NAME" TO "$KEYCLOAK_DB_USER";
EOSQL

echo "База ${KEYCLOAK_DB_NAME} для Keycloak создана."
