CREATE TABLE IF NOT EXISTS restaurants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  address TEXT,
  lat REAL,
  lng REAL,
  genre TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  vision_summary TEXT,
  photo_id TEXT,
  price_range TEXT,
  atmosphere TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_restaurants_area ON restaurants(area);
CREATE INDEX IF NOT EXISTS idx_restaurants_genre ON restaurants(genre);
