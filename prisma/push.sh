#!/bin/sh
set -e
npm install -g prisma@5 --silent
prisma db push --schema /app/prisma/schema.prisma --accept-data-loss
echo DONE