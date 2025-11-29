import { CONFIG } from "./config";
import fetch from "node-fetch";

export class LlmService {
    constructor() { }

    async askRelevance(prompt: string): Promise<string> {
        const res = await fetch("https://api.aimlapi.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${CONFIG.aimlApiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "o3-mini",
                messages: [
                    {
                        role: "system",
                        content: `
                        Tu es CheckBot, un fact-checker YouTube.
                        Ta tâche est d'évaluer si un commentaire mérite un fact checking.
                        La sortie doit TOUJOURS commencer par "OUI" ou "NON".
                        Après ce mot, tu peux ajouter une justification concise (max 2 phrases).`
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ]
            })
        });

        const data = await res.json() as { choices: Array<{ message: { content: string } }> };
        return data.choices[0].message.content;
    }

    async askAnswer(prompt: string, relevance: string): Promise<string> {
        const res = await fetch("https://api.aimlapi.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${CONFIG.aimlApiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "o3-mini",
                messages: [
                    {
                        role: "system",
                        content: `
                        Tu es CheckBot, un fact-checker YouTube.
                        Ta tâche est de debunk ce commentaire, pour la raison suivante : ${relevance}
                        La sortie doit être une réponse claire, factuelle, bien structurée et adaptée au contexte YouTube.`
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ]
            })
        });

        const data = await res.json() as { choices: Array<{ message: { content: string } }> };
        return data.choices[0].message.content;
    }

}
