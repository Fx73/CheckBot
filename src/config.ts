import dotenv from "dotenv";

dotenv.config();
export const CONFIG = {
    clientId: process.env.CLIENT_ID!,
    clientSecret: process.env.CLIENT_SECRET!,
    youtubeHandle: process.env.YOUTUBE_HANDLE!,
    aimlApiKey: process.env.AIML_API_KEY!,
};