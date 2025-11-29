import Database from "better-sqlite3";

export enum RequestState {
    PENDING = "pending",
    APPROVED = "approved",
    ANSWERED = "answered",
    REJECTED = "rejected",
}

export class RequestInfo {
    id: string;
    commentId: string;
    handle: string;
    text: string;
    state: RequestState;
    relevance?: string;
    answer?: string;
    constructor(id: string, commentId: string, handle: string, text: string) {
        this.id = id;
        this.commentId = commentId;
        this.handle = handle;
        this.text = text;
        this.state = RequestState.PENDING;
    }
}

export class RequestTable {
    private db: Database.Database;
    constructor(db: Database.Database) {
        this.db = db;
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commentId TEXT NOT NULL,          
  handle TEXT NOT NULL,
  text TEXT,             
  state TEXT CHECK(state IN ('pending','approved','answered','rejected')),
  relevance TEXT,
  answer TEXT,
  FOREIGN KEY(commentId) REFERENCES comments(id)
);
        `);
    }


    addRequest(commentId: string, handle: string, text: string): RequestInfo {
        const insert = this.db.prepare(`
                INSERT INTO requests (commentId, handle, state, text)
                VALUES (@commentId, @handle, @state, @text)
            `);
        const result = insert.run({ commentId, handle, state: RequestState.PENDING, text: text });

        const newId = result.lastInsertRowid;
        return new RequestInfo(newId.toString(), commentId, handle, text);
    }

    acceptRequest(id: string, reason: string) {
        const stmt = this.db.prepare(`
            UPDATE requests
            SET state = @state,
            relevance = @relevance
            WHERE id = @id
        `);

        stmt.run({
            id,
            state: RequestState.APPROVED,
            relevance: reason
        });
    }
    completeRequest(id: string, answer: string) {
        const stmt = this.db.prepare(`
            UPDATE requests
            SET state = @state,
            answer = @answer
            WHERE id = @id
        `);

        stmt.run({
            id,
            state: RequestState.ANSWERED,
            answer: answer
        });
    }

    rejectRequest(id: string, reason: string) {
        const stmt = this.db.prepare(`
            UPDATE requests
            SET state = @state,
                relevance = @relevance
            WHERE id = @id
        `);

        stmt.run({
            id,
            state: RequestState.REJECTED,
            relevance: reason
        });
    }

    rejectComment(commentId: string, reason: string, targetHandle?: string, targetText?: string) {
        const req = this.addRequest(commentId, targetHandle || "", targetText || "");
        this.rejectRequest(req.id, reason);
    }

    getRequestsByState(state: RequestState): RequestInfo[] {
        const stmt = this.db.prepare(`
            SELECT *
            FROM requests
            WHERE state = @state
        `);

        const rows = stmt.all({ state }) as Array<{ id: number; commentId: string; handle: string; text: string; state: string; relevance: string; }>;

        return rows.map(r => {
            const req = new RequestInfo(r.id.toString(), r.commentId, r.handle, r.text);
            req.state = r.state as RequestState;
            req.relevance = r.relevance;
            return req;
        });
    }


    removeRequest(id: string): void {
        const stmt = this.db.prepare(`
            DELETE FROM requests
            WHERE id = @id
        `);

        const result = stmt.run({ id });

        if (result.changes > 0) {
            console.log(`Request ${id} removed`);
        } else {
            console.log(`No request found with id ${id}`);
        }
    }


    wipeAll() {
        const stmt = this.db.prepare(`DELETE FROM requests`);
        stmt.run();
        console.log("All requests wiped from DB");
    }
}