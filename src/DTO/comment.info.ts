import { RequestInfo, RequestTable } from "./request.info";

import Database from "better-sqlite3";

export class CommentInfo {
    id: string;
    parentId: string;
    videoId: string;
    authorHandle: string;
    text: string;
    publishedAt: Date;
    request: RequestInfo[] = [];

    constructor(id: string, parentId: string, videoId: string, authorHandle: string, text: string, publishedAt: Date) {
        this.id = id;
        this.parentId = parentId;
        this.videoId = videoId;
        this.authorHandle = authorHandle;
        this.text = text;
        this.publishedAt = publishedAt;
    }
}


export class CommentTable {
    private db: Database.Database;
    requestTable: RequestTable;

    constructor(db: Database.Database) {
        this.db = db;
        this.db.exec(`
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  parentId TEXT NOT NULL,
  videoId TEXT NOT NULL,
  authorHandle TEXT,
  text TEXT,
  publishedAt TEXT NOT NULL,
  FOREIGN KEY(videoId) REFERENCES videos(id)
);
        `);
        this.requestTable = new RequestTable(db);
    }

    getAllPendingComments() {
        const stmt = this.db.prepare(`
            SELECT *
            FROM comments c
            WHERE NOT EXISTS (
            SELECT 1 FROM requests r WHERE r.commentId = c.id
            )`);
        const rows = stmt.all() as Array<{ id: string; parentId: string; videoId: string; authorHandle: string; text: string; publishedAt: string }>;
        return rows.map(row => new CommentInfo(row.id, row.parentId, row.videoId, row.authorHandle, row.text, new Date(row.publishedAt)));
    }

    getComment(id: string): CommentInfo | null {
        const stmt = this.db.prepare(`
            SELECT *
            FROM comments
            WHERE id = @id
        `);

        const row = stmt.get({ id }) as | { id: string; parentId: string; videoId: string; authorHandle: string; text: string; publishedAt: string; } | undefined;

        if (!row) {
            return null;
        }

        return new CommentInfo(row.id, row.parentId, row.videoId, row.authorHandle, row.text, new Date(row.publishedAt));
    }


    addComment(comment: CommentInfo) {
        const stmt = this.db.prepare(`SELECT id FROM comments WHERE id = ?`);
        const existing = stmt.get(comment.id);
        if (existing) {
            return;
        }

        const insert = this.db.prepare(`
            INSERT INTO comments (id, parentId, videoId, authorHandle, text, publishedAt)
            VALUES (@id, @parentId, @videoId, @authorHandle, @text, @publishedAt)
            `);

        insert.run({
            id: comment.id,
            parentId: comment.parentId,
            videoId: comment.videoId,
            authorHandle: comment.authorHandle,
            text: comment.text,
            publishedAt: comment.publishedAt.toISOString(),
        });
    }



    wipeAll() {
        const stmt = this.db.prepare(`DELETE FROM comments`);
        stmt.run();
        console.log("All comments wiped from DB");
    }
}
