{
  "name": "fittrack-personale",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node server.js",
    "test": "node --test",
    "migrate:railway": "node scripts/migrate-to-postgres.js"
  },
  "dependencies": {
    "pg": "8.16.3"
  },
  "engines": {
    "node": "22.x"
  }
}
