import Database from "better-sqlite3";

export class ChannelInfo {
    id: string;
    isActive: boolean = true;
    lastCheckedAt: Date | null = null;

    constructor(id: string) {
        this.id = id;
    }
}


export class ChannelTable {
    private db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        isActive INTEGER DEFAULT 1,
        lastCheckedAt TEXT
      )
    `);
    }



    getChannel(id: string): ChannelInfo | null {
        const stmt = this.db.prepare(`SELECT * FROM channels WHERE id = ?`);
        const row = stmt.get(id) as any;
        if (!row) return null;

        const channel = new ChannelInfo(row.id);
        channel.isActive = row.isActive === 1;
        if (row.lastCheckedAt) channel.lastCheckedAt = new Date(row.lastCheckedAt);
        return channel;
    }

    getAllChannels(): ChannelInfo[] {
        const rows = this.db.prepare(`SELECT * FROM channels`).all();
        return rows.map((row: any) => {
            const c = new ChannelInfo(row.id);
            c.isActive = row.isActive === 1;
            if (row.lastCheckedAt) c.lastCheckedAt = new Date(row.lastCheckedAt);
            return c;
        });
    }
    getAllActiveChannels(): ChannelInfo[] {
        const rows = this.db.prepare(`SELECT * FROM channels WHERE isActive = 1`).all();
        return rows.map((row: any) => {
            const c = new ChannelInfo(row.id);
            c.isActive = row.isActive === 1;
            if (row.lastCheckedAt) c.lastCheckedAt = new Date(row.lastCheckedAt);
            return c;
        });
    }

    addChannel(channel: ChannelInfo) {
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO channels (id, isActive)
      VALUES (@id, @isActive)
    `);
        stmt.run({
            id: channel.id,
            isActive: channel.isActive ? 1 : 0,
        });
    }

    freezeChannel(id: string) {
        const stmt = this.db.prepare(`
      UPDATE channels SET isActive = 0 WHERE id = ?
    `);
        stmt.run(id);
    }

    updateLastChecked(id: string) {
        const stmt = this.db.prepare(`
      UPDATE channels SET lastCheckedAt = ? WHERE id = ?
    `);
        stmt.run(new Date().toISOString(), id);
    }
}
