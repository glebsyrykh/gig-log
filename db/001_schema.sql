CREATE TABLE IF NOT EXISTS venues (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    former_names TEXT[] DEFAULT '{}',
    address     TEXT DEFAULT '',
    lat         DOUBLE PRECISION DEFAULT 0,
    lng         DOUBLE PRECISION DEFAULT 0,
    closed      BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
    id              TEXT PRIMARY KEY,
    type            TEXT NOT NULL CHECK (type IN ('gig', 'festival')),
    venue_id        TEXT NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    dates           DATE[] NOT NULL,
    artists         TEXT[] NOT NULL,
    setlist_fm_url  TEXT DEFAULT '',
    last_fm_url     TEXT DEFAULT '',
    notes           TEXT DEFAULT '',
    festival_name   TEXT DEFAULT '',
    image_url       TEXT DEFAULT '',
    tags            TEXT[] DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_venue_id ON events(venue_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_festival_name ON events(festival_name) WHERE festival_name != '';
CREATE INDEX IF NOT EXISTS idx_events_tags ON events USING GIN(tags);
