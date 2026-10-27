-- One table holds every document of every collection (JSON text), keyed like Firestore: collection + id.
-- WITHOUT ROWID keeps (col, id) as the primary key, so listing one collection reads only that collection's rows.
CREATE TABLE IF NOT EXISTS docs (
  col  TEXT    NOT NULL,
  id   TEXT    NOT NULL,
  data TEXT    NOT NULL,                 -- the document, as JSON
  v    INTEGER NOT NULL DEFAULT 1,       -- version: +1 on every write (lets transactions detect that a document changed)
  u    INTEGER NOT NULL,                 -- when it was last written (ms)
  PRIMARY KEY (col, id)
) WITHOUT ROWID;

-- One tiny row per collection: "last changed at". Other devices ask this (1 row read) instead of re-reading the collection.
CREATE TABLE IF NOT EXISTS colstamp (
  col TEXT PRIMARY KEY,
  u   INTEGER NOT NULL
) WITHOUT ROWID;

-- Sign-in accounts: the app's own login (uid = the id of the person's document in the users collection).
CREATE TABLE IF NOT EXISTS accounts (
  email        TEXT PRIMARY KEY,           -- lower-case login email
  uid          TEXT NOT NULL UNIQUE,
  salt         TEXT,                       -- PBKDF2 salt (hex); null until the person sets a password
  hash         TEXT,
  iter         INTEGER,
  setup_hash   TEXT,                       -- SHA-256 of the one-time setup-link token
  setup_exp    INTEGER NOT NULL DEFAULT 0,
  fails        INTEGER NOT NULL DEFAULT 0, -- wrong passwords in a row
  locked_until INTEGER NOT NULL DEFAULT 0,
  created      INTEGER NOT NULL
) WITHOUT ROWID;
