-- Full-text search over headlines and descriptions (SQLite FTS5; supported by D1 and node:sqlite).
CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(headline, description, content='articles', content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, headline, description) VALUES (new.rowid, new.headline, new.description);
END;
CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, headline, description) VALUES ('delete', old.rowid, old.headline, old.description);
END;
CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, headline, description) VALUES ('delete', old.rowid, old.headline, old.description);
  INSERT INTO articles_fts(rowid, headline, description) VALUES (new.rowid, new.headline, new.description);
END;
