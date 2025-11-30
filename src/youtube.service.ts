import { CommentInfo } from "./DTO/comment.info";
import { OAuth2Client } from "google-auth-library";
import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import { google } from "googleapis";

export class YouTubeService {
    private youtube;
    private oauth2Client: OAuth2Client;

    private creditCounter: number = 0;

    private readonly REDIRECT_URI = "http://localhost:3000/oauth2callback";
    private readonly waiter = express();

    private readonly youtubeRssWaiter = express();

    constructor(clientId: string, clientSecret: string) {
        this.oauth2Client = new google.auth.OAuth2({ clientId: clientId, clientSecret: clientSecret, redirectUri: this.REDIRECT_URI });
        this.youtube = google.youtube({ version: "v3", auth: this.oauth2Client });

        const tokens = YouTubeService.getTokens();
        if (tokens) {
            this.oauth2Client.setCredentials(tokens);
        } else {
            const authUrl = this.oauth2Client.generateAuthUrl({
                access_type: "offline",
                scope: ["https://www.googleapis.com/auth/youtube.force-ssl"],
            });
            console.log("Log CheckBot with link:", authUrl);

            this.waiter.get("/oauth2callback", async (req, res) => {
                const code = req.query.code as string;
                const { tokens } = await this.oauth2Client.getToken(code);
                YouTubeService.storeTokens(tokens);
                res.send("✅ Authorized ! Close this window. ✅ ");
                this.initYoutubeRssServer();
            });
            this.waiter.listen(3000, () => {
                console.log("Waiting for OAuth2 callback to save tokens...");
            });
        }
    }

    async saveNewTokens(code: string) {
        const { tokens } = await this.oauth2Client.getToken(code);
        this.oauth2Client.setCredentials(tokens);
        YouTubeService.storeTokens(tokens);
    }

    //#region Youtube RSS (WebSub)
    initYoutubeRssServer() {
        this.youtubeRssWaiter.use(express.text({ type: "*/*" }));
        // Hub Challenge endpoint
        this.youtubeRssWaiter.get("/youtube/websub", (req, res) => {
            const challenge = req.query["hub.challenge"];
            if (challenge) {
                res.send(challenge);
            } else {
                res.send("OK");
            }
        });

        // Receive Notifications endpoint
        this.youtubeRssWaiter.post("/youtube/websub", (req, res) => {
            console.log("Received :", req.body);
            // 🔹 Here xml parse
            res.send("OK");
        });

        this.youtubeRssWaiter.listen(3001, () => {
            console.log("Youtube webhook listening on port 3001");
        });
    }


    async subscribeChannel(channelId: string) {
        const hubUrl = "https://pubsubhubbub.appspot.com/subscribe";
        const topic = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
        const callback = "https://bot.com/youtube/websub";

        const res = await fetch(hubUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                "hub.callback": callback,
                "hub.mode": "subscribe",
                "hub.topic": topic,
                "hub.verify": "async"
            })
        });

        console.log("Subscription response:", await res.text());
    }
    //#endregion


    //#region Polling

    public async getAllVideosOfChannel(channelId: string, lastCheckedAt: Date | null): Promise<{ id: string; title: string; publishedAt: string }[]> {
        // dériver l’ID de la playlist uploads (UC → UU)
        const uploadsPlaylistId = channelId.replace(/^UC/, "UU");

        const oneYearMs = 365 * 24 * 60 * 60 * 1000;
        const cutoffDate = new Date(Date.now() - oneYearMs);

        const videos: { id: string; title: string; publishedAt: string }[] = [];
        let nextPageToken: string | undefined = undefined;
        let pageCount = 0;

        do {
            const res: any = await this.youtube.playlistItems.list({
                part: ["snippet"],
                playlistId: uploadsPlaylistId,
                maxResults: 50,
                pageToken: nextPageToken,
            });

            if (res.data.items) {
                for (const item of res.data.items) {
                    const publishedAt = item.snippet?.publishedAt;
                    if (lastCheckedAt && publishedAt && new Date(publishedAt) <= lastCheckedAt) {
                        return videos;
                    }

                    if (new Date(publishedAt) < cutoffDate) {
                        return videos;
                    }

                    const videoId = item.snippet?.resourceId?.videoId;
                    if (videoId && publishedAt) {
                        const title = item.snippet?.title ?? "";
                        videos.push({ id: videoId, title, publishedAt });
                    }
                }
            }

            nextPageToken = res.data.nextPageToken ?? undefined;
            pageCount++;
            this.creditCounter++;
        } while (nextPageToken && pageCount < 4); // max 4 pages

        return videos;
    }


    async getNewRepliesWithMention(videoId: string, since: Date | null, youtubeHandle: string): Promise<CommentInfo[]> {
        const replies: CommentInfo[] = [];
        let nextPageToken: string | undefined = undefined;

        // borne minimale = 1 mois
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        const effectiveSince = (since && since > oneMonthAgo) ? since : oneMonthAgo;

        // 1. Get top level comments
        do {
            const res: any = await this.youtube.commentThreads.list({
                part: ["snippet"],
                videoId,
                maxResults: 100,
                pageToken: nextPageToken,
                order: "time",
            });

            if (res.data.items) {
                for (const item of res.data.items) {
                    const topId = item.snippet?.topLevelComment?.id;
                    if (!topId) continue;

                    // Skip if no replies
                    if (item.snippet.totalReplyCount === 0) {
                        continue;
                    }

                    // 2. Get replies
                    let replyPageToken: string | undefined = undefined;
                    do {
                        const replyRes: any = await this.youtube.comments.list({
                            part: ["snippet"],
                            parentId: topId,
                            maxResults: 100,
                            pageToken: replyPageToken,
                        });

                        if (replyRes.data.items) {
                            for (const reply of replyRes.data.items) {
                                const rc = reply.snippet;
                                const publishedAt = new Date(rc.publishedAt);
                                if (publishedAt > effectiveSince) {
                                    const text = rc.textDisplay ?? "";
                                    if (text.includes(youtubeHandle)) {
                                        replies.push(new CommentInfo(reply.id!, rc.parentId, videoId, rc.authorDisplayName ?? rc.authorChannelId ?? "", text, publishedAt));
                                    }
                                }
                            }
                        }
                        replyPageToken = replyRes.data.nextPageToken ?? undefined;
                    } while (replyPageToken);
                }
            }

            nextPageToken = res.data.nextPageToken ?? undefined;
            this.creditCounter++;
        } while (nextPageToken);

        return replies;
    }



    async getCommentsOfParentWithHandle(parentId: string, handles: string[]): Promise<CommentInfo[]> {
        let allItems: any[] = [];
        let pageToken: string | undefined = undefined;

        // All replies
        do {
            const res: any = await this.youtube.comments.list({
                part: ["snippet"],
                parentId,
                maxResults: 100,
                pageToken
            });
            if (res.data.items?.length) {
                allItems.push(...res.data.items);
            }
            pageToken = res.data.nextPageToken;
            this.creditCounter++;
        } while (pageToken);

        // Parent
        const parentRes: any = await this.youtube.comments.list({
            part: ["snippet"],
            id: [parentId]
        });
        this.creditCounter++;

        if (parentRes.data.items?.length)
            allItems.push(parentRes.data.items[0]);



        const filtered = allItems.filter(item => {
            const author = item.snippet?.authorDisplayName ?? "";
            return handles.some(h => author.toLowerCase().includes(h.toLowerCase()));
        });

        return filtered.map(item => new CommentInfo(item.id!, item.snippet!.parentId ?? parentId, item.snippet!.videoId ?? "", item.snippet!.authorDisplayName ?? "", item.snippet!.textDisplay ?? "", new Date(item.snippet!.publishedAt ?? Date.now())));
    }



    //#endregion

    //#region Answer
    async postAnswerComment(youtubeAnswer: string, comment: CommentInfo): Promise<Boolean> {
        try {
            const res: any = await this.youtube.comments.insert({
                part: ["snippet"],
                requestBody: {
                    snippet: {
                        parentId: comment.parentId,
                        textOriginal: youtubeAnswer
                    }
                }
            });

            console.log(`Posted answer to comment ${comment.id}: ${youtubeAnswer}`);
            this.creditCounter += 50;
            return true
        } catch (err) {
            console.error(`Failed to post answer to comment ${comment.id}:`, err);
            return false
        }
    }

    //#endregion


    //#region Tokens
    private static TOKEN_PATH = "./tokens.json";
    static getTokens(): any | null {
        if (fs.existsSync(this.TOKEN_PATH)) {
            return JSON.parse(fs.readFileSync(this.TOKEN_PATH, "utf-8"));
        }
        return null;
    }

    static storeTokens(tokens: any) {
        fs.writeFileSync(this.TOKEN_PATH, JSON.stringify(tokens, null, 2));
        console.log("✅ Tokens sauvegardés dans", this.TOKEN_PATH);
    }
    //#endregion
}
