import { ChannelInfo, ChannelTable } from "./DTO/channel.info";
import { CommentInfo, CommentTable } from "./DTO/comment.info";
import { RequestState, RequestTable } from "./DTO/request.info";
import { VideoBucket, VideoInfo, VideoTable } from "./DTO/video.info";

import { CONFIG } from "./config";
import Database from "better-sqlite3";
import { LlmService } from './llm.service';
import { YouTubeService } from "./youtube.service";

export class CheckBot {
    // Constantes pour les intervalles (en ms)
    readonly HOT_INTERVAL = 10 * 60 * 1000;   // 10 minutes
    readonly MEDIUM_INTERVAL = 60 * 60 * 1000; // 1 heure
    readonly COLD_INTERVAL = 24 * 60 * 60 * 1000; // 1 jour

    private channels: ChannelTable;
    private videos: VideoTable;
    private comments: CommentTable;
    private requests: RequestTable;


    constructor(private youTubeService: YouTubeService, private llmService: LlmService) {
        const dataTable = new Database("checkbot.db");
        this.channels = new ChannelTable(dataTable);
        this.videos = new VideoTable(dataTable);
        this.comments = new CommentTable(dataTable);
        this.requests = new RequestTable(dataTable);
    }

    //#region Channel Management
    async updateChannels() {
        console.log("Updating channels..");

        const filePath = "./channels.txt";
        const fs = require("fs");
        const data = fs.readFileSync(filePath, "utf-8");
        const fileChannels = data.split("\n").map((line: string) => line.trim()).filter((line: string | any[]) => line.length > 0);

        const dbChannels = this.channels.getAllActiveChannels();

        //  Deleted channels → freeze
        for (const c of dbChannels) {
            if (!fileChannels.includes(c.id) && c.isActive) {
                console.log(`Freezing channel ${c.id} as it was removed`);
                this.channels.freezeChannel(c.id);
                for (const v of this.videos.getVideosByChannel(c.id))
                    this.videos.freezeVideo(v.id);
            }
        }

        //  New channels → insert in DB
        for (const id of fileChannels) {
            if (!dbChannels.some(c => c.id === id)) {
                console.log(`Adding new channel ${id}`);
                this.channels.addChannel(new ChannelInfo(id));
            }
        }

        console.log("End of channel update");
    }

    async updateChannelsVideo() {
        for (const channel of this.channels.getAllActiveChannels()) {
            await this.scanChannel(channel.id);
            this.channels.updateLastChecked(channel.id);
        }
    }
    async scanChannel(channelId: string) {
        const channel = this.channels.getChannel(channelId);
        if (!channel) {
            console.log(`Channel ${channelId} not found in DB`);
            return;
        }

        console.log(`Scanning channel ${channelId}, lastCheckedAt=${channel?.lastCheckedAt}`);

        const channelVideos: { id: string; title: string; publishedAt: string }[] = await this.youTubeService.getAllVideosOfChannel(channelId, channel.lastCheckedAt);

        for (const cv of channelVideos) {
            const videoInfo = new VideoInfo(cv.id, channelId, new Date(cv.publishedAt), cv.title, this.assignBucket(cv.publishedAt));
            this.videos.addVideo(videoInfo);
            console.log(`New video found : ${videoInfo.title}`);
        }

        console.log(`Scan complete for channel ${channelId}`);

    }

    private assignBucket(publishedAt: string | Date): VideoBucket {
        const ageMs = Date.now() - new Date(publishedAt).getTime();
        const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
        const oneMonthMs = 30 * 24 * 60 * 60 * 1000;

        if (ageMs < oneWeekMs) {
            return VideoBucket.HOT;
        } else if (ageMs < oneMonthMs) {
            return VideoBucket.MEDIUM;
        } else {
            return VideoBucket.COLD;
        }
    }


    //#endregion


    //#region Loop
    async start() {
        console.log("Starting CheckBot...");

        await this.updateChannels();
        await this.updateChannelsVideo();

        console.log("CheckBot is running with", this.channels.getAllChannels().length, "channels");
        setInterval(() => this.updateHot(), this.HOT_INTERVAL);
        setInterval(() => this.updateMedium(), this.MEDIUM_INTERVAL);
        setInterval(() => this.updateCold(), this.COLD_INTERVAL);

        this.updateHot()
    }

    async updateCommon(videoBucket: VideoBucket) {
        const videos = this.videos.getVideosByBucket(videoBucket);

        console.log(`Starting scan for ${videos.length} videos...`);

        for (const video of videos) {
            await this.scanVideo(video);
        }

        console.log(`Scan done for ${videos.length} videos !`);
    }

    async updateHot() {
        console.log(`\nHot Update ...`)

        await this.updateCommon(VideoBucket.HOT);

        await this.processPendingComments()
        await this.processingPendingRequests()
        await this.processingApprovedRequests()
    }

    async updateMedium() {
        console.log(`\nMedium Update ...`)

        await this.updateCommon(VideoBucket.MEDIUM);
    }

    async updateCold() {
        await this.updateChannels();
        await this.updateChannelsVideo();

        console.log(`\nCold Update ...`)

        await this.updateCommon(VideoBucket.COLD);

        await this.demoteVideos();

    }
    //#endregion

    //#region Video management
    async demoteVideos() {
        console.log(`Demoting videos...`);
        const hotVideos = this.videos.getVideosByBucket(VideoBucket.HOT);
        let count = 0;
        for (const video of hotVideos) {
            const publishedAt = video.publishedAt.getTime();
            const ageMs = Date.now() - publishedAt;
            const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
            if (ageMs >= oneWeekMs) {
                count++;
                this.videos.updateBucket(video.id, VideoBucket.MEDIUM);
            }
        }
        console.log(`Demoted ${count} videos from HOT to MEDIUM !`);

        const mediumVideos = this.videos.getVideosByBucket(VideoBucket.MEDIUM);
        count = 0;
        for (const video of mediumVideos) {
            const publishedAt = video.publishedAt.getTime();
            const ageMs = Date.now() - publishedAt;
            const oneMonthMs = 30 * 24 * 60 * 60 * 1000;
            if (ageMs >= oneMonthMs) {
                count++;
                this.videos.updateBucket(video.id, VideoBucket.COLD);
            }
        }
        console.log(`Demoted ${count} videos from MEDIUM to COLD !`);
    }

    async scanVideo(video: VideoInfo) {
        const scantime = new Date();
        const comments: CommentInfo[] = await this.youTubeService.getNewRepliesWithMention(video.id, video.lastScannedAt, CONFIG.youtubeHandle);
        this.videos.updateLastScanned(video.id, scantime);

        for (const c of comments) {
            this.comments.addComment(c);
            console.log(`Stored new pending comment ${c.id} on video ${video.title}`);
        }
    }

    //#endregion

    //#region  Request Management
    parseHandles(text: string, selfHandle: string): { handle: string; offset?: number; }[] {
        const regex = /@([A-Za-z0-9_-]+)(?:\s*\+(\d+))?/g;
        const matches: { handle: string; offset?: number; }[] = [];
        let m;
        while ((m = regex.exec(text)) !== null) {
            const handle = `@${m[1]}`;
            if (handle.toLowerCase() === selfHandle.toLowerCase()) continue;
            const offset = m[2] ? parseInt(m[2], 10) : undefined;
            matches.push({ handle, offset });
        }
        return matches;
    }

    async processPendingComments() {
        console.log(`Commencing processing of pending comments...`);

        const pendingComments = this.comments.getAllPendingComments();

        for (const comment of pendingComments) {
            try {
                console.log(`Processing comment ${comment.id} from ${comment.authorHandle}...`);
                await this.parseRequestsFromComments(comment);
            } catch (err) {
                console.error(`Error processing comment ${comment.id}:`, err);
            }
        }

        console.log(`Processed ${pendingComments.length} pending comments !`);
    }


    async parseRequestsFromComments(triggerComment: CommentInfo) {
        const requests = this.parseHandles(triggerComment.text, CONFIG.youtubeHandle);

        if (requests.length === 0) {
            console.log(`No target handle found in comment ${triggerComment.id}`);
            this.requests.rejectComment(triggerComment.id, "No target handle found");
            return;
        }

        const comments = await this.youTubeService.getCommentsOfParentWithHandle(triggerComment.parentId, requests.map(r => r.handle));

        // Group by author
        const grouped = new Map<string, CommentInfo[]>();
        for (const c of comments) {
            if (!grouped.has(c.authorHandle)) grouped.set(c.authorHandle, []);
            grouped.get(c.authorHandle)!.push(c);
        }

        // For each author, find relevant comments and create request
        for (const req of requests) {
            const list = grouped.get(req.handle) ?? [];
            const relevant = list.filter(c => c.publishedAt <= triggerComment.publishedAt).sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

            let factToCheck: string = "";

            if (relevant.length === 0) {
                console.log(`No comments found for handle ${req.handle} before trigger comment ${triggerComment.id}`);
                this.requests.rejectComment(triggerComment.id, "No comments found for target handle");
                continue;
            }

            if (req.offset) {
                factToCheck = relevant[req.offset].text;
            } else {
                const cutoff = new Date(relevant[0].publishedAt.getTime() - 24 * 60 * 60 * 1000);
                const recentRelevant = relevant.filter(c => c.publishedAt >= cutoff);
                for (const c of recentRelevant) {
                    if ((factToCheck + c.text).length > 800) break;
                    factToCheck += c.text + "\n\n";
                }
            }
            this.requests.addRequest(triggerComment.id, req.handle, factToCheck);
        }
    }

    async processingPendingRequests() {
        console.log("Starting request approval ...")
        const pendingRequests = this.requests.getRequestsByState(RequestState.PENDING);
        for (const req of pendingRequests) {
            console.log("Request for ", req.handle)
            try {
                const relevanceResult = (await this.llmService.askRelevance(req.text)).trim();
                const isRelevant = relevanceResult.startsWith("OUI");
                const justification = relevanceResult.replace(/^OUI|^NON/, "").trim().replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "").trim();

                if (isRelevant) {
                    await this.requests.acceptRequest(req.id, justification);
                    console.log("Request approved", req.handle)

                } else {
                    await this.requests.rejectRequest(req.id, justification || "Not relevant");
                    console.log("Request rejected", req.handle)
                }

            } catch (err) {
                console.error(`Relevance error for ${req.id}`, err);
                await this.requests.rejectRequest(req.id, "Erreur relevance");
            }
        }

        console.log("End of request approval !")
    }

    async processingApprovedRequests() {
        console.log("Starting request response ...")
        const approvedRequests = this.requests.getRequestsByState(RequestState.APPROVED);
        for (const req of approvedRequests) {
            console.log("Request for ", req.handle)
            const answer = (await this.llmService.askAnswer(req.text, req.relevance ?? 'debunk')).trim();
            const comment = this.comments.getComment(req.commentId);

            if (!comment) {
                console.log("Error retreiving comment.")
                this.requests.removeRequest(req.id)
                continue;
            }
            const youtubeAnswer = req.handle + " " + comment.authorHandle + "\n" + answer;
            const postResult = await this.youTubeService.postAnswerComment(youtubeAnswer, comment)
            if (postResult) {
                this.requests.completeRequest(req.id, answer)
            }
        }

        console.log("End of request response !")
    }
    //#endregion
}

