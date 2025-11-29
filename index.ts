import { CONFIG } from "./src/config";
import { CheckBot } from "./src/checkbot";
import { LlmService } from "./src/llm.service";
import { YouTubeService } from "./src/youtube.service";

async function main() {
    const youtube = new YouTubeService(CONFIG.clientId, CONFIG.clientSecret);
    const llm = new LlmService()
    const checkBot = new CheckBot(youtube, llm);
    checkBot.start();
}

main();
