import { EmbedBuilder } from 'discord.js';
import { getAllServerSettings, getUserSolve, getUserStats, getServerPuzzleStat, getServerTimezone, getServerMessageId, getServerThreadId, getServerChannel } from "../../database.js";
import { COLOURS } from '../../constants.js';
import { formatDate } from './clueRenderer.js';


export async function sendToServers(client, interaction, internalUserId, puzzleData) {
    const allSettings = await getAllServerSettings();
    let sentCount = 0;

    for (const server of allSettings) {
        if (!server.channel_id) continue;
        
        const guild = client.guilds.cache.get(server.server_id);
        if (!guild) continue;
        
        try {
            const member = await guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member) continue;
            
            const targetChannel = guild.channels.cache.get(server.channel_id);
            if (!targetChannel) continue;

            const resultEmbed = await createSolveStat(interaction, server.server_id, internalUserId, puzzleData);
            await targetChannel.send({ embeds: [resultEmbed] });
            sentCount++;
        } catch (err) {
            console.error(`Error sending stats to ${server.server_id}:`, err);
        }
    }
    return sentCount;
}

export const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return "0s";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
};

async function createSolveStat(interaction, serverId, internalUserId, puzzleData) {
    const userSolve = await getUserSolve(internalUserId, puzzleData.id);
    const userStats = await getUserStats(interaction.user.id);
    const serverStats = await getServerPuzzleStat(puzzleData.puzzle_uuid, serverId);
    const serverTz = await getServerTimezone(serverId);
    const activeChannelId = await getServerChannel(serverId);
    const clueMessageId = await getServerMessageId(serverId)
    const clueThreadId = await getServerThreadId(serverId)

    const helpUsedCount = userSolve?.help_used ? userSolve.help_used.length : 0;
    const parDiff = helpUsedCount - puzzleData.par;
    const avgParDiff = helpUsedCount - (puzzleData.par_details?.averagePar || 0);

    let parText = "Equal to target par";
    if (parDiff > 0) parText = `${parDiff} above target`;
    if (parDiff < 0) parText = `${Math.abs(parDiff)} below target`;

    let avgParText = "Equal to world average par";
    if (avgParDiff > 0) avgParText = `${Number(avgParDiff.toFixed(2))} above world average`;
    if (avgParDiff < 0) avgParText = `${Number(Math.abs(avgParDiff).toFixed(2))} below world average`;

    const now = new Date();
    const localStr = now.toLocaleString("en-US", { timeZone: serverTz });
    const localMidnight = new Date(localStr);
    localMidnight.setDate(localMidnight.getDate() + 1);
    localMidnight.setHours(0, 0, 0, 0);
    const epochDiff = localMidnight.getTime() - new Date(localStr).getTime();
    const nextMidnightEpoch = Math.floor((now.getTime() + epochDiff) / 1000);

    const resultEmbed = new EmbedBuilder()
        .setTitle(`🎉 Puzzle Solved for ${formatDate(puzzleData.date)}!`)
        .setColor(COLOURS.definition.hex)
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
        .setDescription(`
## **<@${interaction.user.id}>**
**🔥 Clue Streak:** ${userStats?.streak || 1} (Max: ${userStats?.max_streak || 1})
**📈 Lifetime:** ${userStats?.total_solves || 1} solve(s) (${userStats?.perfect_solves || 0} perfect)

**💡 Hints Used:** ${helpUsedCount} (Target Par: ${puzzleData.par} | World Avg: ${puzzleData.par_details?.averagePar || 0})
**⛳ Performance:** 
> ${parText} 
> ${avgParText}

**⏱️ Timing:**
> **Your Time:** ${formatTime(userSolve?.time_taken_seconds)}
> **Avg Server Time:** ${formatTime(serverStats?.average_time)}
> **Avg World Time:** ${formatTime(puzzleData.par_details?.medianSolveTimeSeconds)}

**⏳ Next Clue:** <t:${nextMidnightEpoch}:R>

**▶️ [Watch The Explanation Video](${puzzleData.explainer_video})**

**🧩 [Scroll Back To The Clue](https://discord.com/channels/${serverId}/${activeChannelId}/${clueMessageId})**
**💬 [Join The Discussion Thread](https://discord.com/channels/${serverId}/${clueThreadId})** _(spoilers)_
        `)
        .setFooter({ text: "DailyMinuteCryptics" })
        .setTimestamp();

    return resultEmbed;
}
