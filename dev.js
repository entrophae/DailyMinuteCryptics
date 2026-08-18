import { EmbedBuilder, MessageFlags } from 'discord.js';
import https from 'https';

const HEALTHCHECK_URL = process.env.HEALTHCHECK_URL;
const DEV_SERVER = process.env.DEV_SERVER
const DEV_CHANNEL = process.env.DEV_CHANNEL

/**
 * Sends a diagnostic log to the designated Developer Channel.
 * @param {Client} client - The Discord client instance
 * @param {Error|string} error - The error object or message
 * @param {string} context - Where the error happened (e.g., "Heartbeat", "Command: /play")
 * @param {string} serverName - The name of the server (if applicable)
 */
export async function devLog(client, error, context, serverName = "System") {
    const DEV_CHANNEL_ID = process.env.DEV_CHANNEL;

    if (!DEV_CHANNEL_ID) {
        return console.warn("[devLog] No DEV_CHANNEL ID found in environment variables.");
    }

    try {
        const channel = await client.channels.fetch(DEV_CHANNEL_ID);
        if (!channel) return;

        const errorMessage = error instanceof Error ? error.stack : String(error);
        // Discord has a 4096 limit for embed descriptions, 2000 for standard messages
        const truncatedError = errorMessage.length > 1500
            ? errorMessage.substring(0, 1497) + "..."
            : errorMessage;

        const embed = new EmbedBuilder()
            .setTitle('🚨 System Diagnostic')
            .setColor(0xED4245) // Red
            .addFields(
                { name: 'Context', value: context, inline: true },
                { name: 'Server', value: serverName, inline: true },
            )
            .setDescription(`\`\`\`js\n${truncatedError}\n\`\`\``)
            .setTimestamp();

        await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error("Critical: devLog failed to send to Discord:", err.message);
    }
    console.error(context, error);
}

/**
 * Sends a heartbeat to the Healthcheck URL.
 * @param {Client} client - The Discord client instance
 * @param {Error|string} minutes - The frequency to ping
 * @param {string} context - Where the error happened (e.g., "Heartbeat", "Command: /play")
 * @param {string} serverName - The name of the server (if applicable)
 */
export async function startHeartbeat(client, minutes){
    if (HEALTHCHECK_URL) {
        console.log("Healthcheck_URL found");
        setInterval(async () => {
            https.get(HEALTHCHECK_URL).on("error", async (err) => {
            await devLog(client, err, "Healthcheck ping failed:");
            });
        }, minutes * 60 * 1000); // minutes in milliseconds

        await https.get(HEALTHCHECK_URL).on("error", (err) => console.error("Healthcheck ping failed:", err));
    } else {
        console.warn("No Healthcheck_URL found. Checking for heartbeat might be important");
    }
}