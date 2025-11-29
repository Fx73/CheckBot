import Database from "better-sqlite3";

export enum VideoBucket {
    HOT = "hot",
    MEDIUM = "medium",
    COLD = "cold",
    FROZEN = "frozen",
}


export class VideoInfo {
    id: string;
    channelId: string;
    title: string;
    publishedAt: Date;
    bucket: VideoBucket;
    lastScannedAt: Date | null;

    constructor(id: string, channelId: string, publishedAt: Date, title?: string, bucket?: VideoBucket) {
        this.id = id;
        this.channelId = channelId;
        this.publishedAt = publishedAt;
        this.title = title ?? "";
        this.lastScannedAt = null;
        this.bucket = bucket ?? VideoBucket.COLD;
    }
}

export class VideoTable {
    private db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
        this.db.exec(`
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  channelId TEXT NOT NULL,
  title TEXT,
  publishedAt TEXT NOT NULL,
  bucket TEXT CHECK(bucket IN ('hot','medium','cold','frozen')),
  lastScannedAt TEXT,
  FOREIGN KEY(channelId) REFERENCES channels(id)
);
    `);
    }

    addVideo(video: VideoInfo) {
        const stmt = this.db.prepare(`
    INSERT INTO videos (id, channelId, title, publishedAt, bucket)
    VALUES (@id, @channelId, @title, @publishedAt, @bucket)
    ON CONFLICT(id) DO UPDATE SET
      channelId = excluded.channelId,
      title = excluded.title,
      publishedAt = excluded.publishedAt,
      bucket = excluded.bucket
      -- lastScannedAt not updated here
  `);

        stmt.run({
            id: video.id,
            channelId: video.channelId,
            title: video.title,
            publishedAt: video.publishedAt.toISOString(),
            bucket: video.bucket,
        });
    }


    freezeVideo(id: string) {
        const stmt = this.db.prepare(`UPDATE videos SET bucket = ? WHERE id = ?`);
        stmt.run(VideoBucket.FROZEN, id);
    }
    deleteVideo(id: string) {
        const stmt = this.db.prepare(`DELETE FROM videos WHERE id = ?`);
        stmt.run(id);
    }
    updateBucket(id: string, bucket: VideoBucket) {
        const stmt = this.db.prepare(`UPDATE videos SET bucket = ? WHERE id = ?`);
        stmt.run(bucket, id);
    }
    updateLastScanned(id: string, date: Date) {
        const stmt = this.db.prepare(`UPDATE videos SET lastScannedAt = ? WHERE id = ?`);
        stmt.run(date.toISOString(), id);
    }


    getVideosByChannel(channelId: string): VideoInfo[] {
        const stmt = this.db.prepare(`SELECT * FROM videos WHERE channelId = ?`);
        const rows = stmt.all(channelId);
        return rows.map((row: any) => {
            const v = new VideoInfo(row.id, row.channelId, new Date(row.publishedAt), row.title, row.bucket as VideoBucket);
            if (row.lastScannedAt) v.lastScannedAt = new Date(row.lastScannedAt);
            return v;
        });
    }

    getVideosByBucket(bucket: VideoBucket): VideoInfo[] {
        const stmt = this.db.prepare(`SELECT * FROM videos WHERE bucket = ?`);
        const rows = stmt.all(bucket);
        return rows.map((row: any) => {
            const v = new VideoInfo(row.id, row.channelId, new Date(row.publishedAt), row.title, row.bucket as VideoBucket);
            if (row.lastScannedAt) v.lastScannedAt = new Date(row.lastScannedAt);
            return v;
        });
    }

    resetScanTime(videoId: string) {
        const stmt = this.db.prepare(`
      UPDATE videos
      SET lastScannedAt = NULL
      WHERE id = ?
    `);
        stmt.run(videoId);
    }
}

