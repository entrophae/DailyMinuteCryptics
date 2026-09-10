import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { getServerChannel, getDailyServerLeaderboard, getServerMessageId, getServerThreadId } from "../database.js";
import { COLOURS } from '../constants.js';
import { formatTime } from './clue/solveRenderer.js';
import { formatDate } from './clue/clueRenderer.js';

export async function sendDailyRecap(client, serverId, oldPuzzle) {
    const activeChannelId = await getServerChannel(serverId);
    const guild = client.guilds.cache.get(serverId);
    const channel = guild?.channels.cache.get(activeChannelId);
    if (!channel) return;
    const clueMessageId = await getServerMessageId(serverId);
    const clueThreadId = await getServerThreadId(serverId);
    const endLinkings = `
**▶️ [Watch The Explanation Video](${oldPuzzle.explainer_video})**

**🧩 [Scroll Back To The Clue](https://discord.com/channels/${serverId}/${activeChannelId}/${clueMessageId})**
**💬 [Join The Discussion Thread](https://discord.com/channels/${serverId}/${clueThreadId})** _(spoilers)_`;

    const leaderboard = await getDailyServerLeaderboard(serverId, oldPuzzle.id);

    if (!leaderboard || leaderboard.length <= 0) {
        const embed = new EmbedBuilder()
            .setTitle(`📊 Yesterday's Leaderboard: ${formatDate(oldPuzzle.date)}`)
            .setColor(COLOURS.leaderboard.hex)
            .setDescription(`
The day is over! Here is how the server performed on yesterday's clue:

😭 No one solved the clue

${endLinkings}
`)
            .setFooter({ text: `Page 1 of 1 | Daily Minute Cryptics` });
    }

    const itemsPerPage = 10;
    const totalPages = Math.ceil(leaderboard.length / itemsPerPage);
    let currentPage = 0;

    const generateEmbed = (page) => {
        const start = page * itemsPerPage;
        const currentItems = leaderboard.slice(start, start + itemsPerPage);
        
        let message = '';
        currentItems.forEach((entry, index) => {
            const rank = start + index + 1;
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🏅';
            message += `${medal} **#${rank}** <@${entry.user_id}> - ${entry.hints_used} hints in ${formatTime(entry.time_taken_seconds)}\n`;
        });

        return new EmbedBuilder()
            .setTitle(`📊 Yesterday's Leaderboard: ${formatDate(oldPuzzle.date)}`)
            .setColor(COLOURS.leaderboard.hex)
            .setDescription(`
The day is over! Here is how the server performed on yesterday's clue:

${message}

${endLinkings}
`)
            .setFooter({ text: `Page 1 of 1 | Daily Minute Cryptics` });
    };

    const generateButtons = (page) => {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('prev_page_recap')
                .setLabel('◀️ Previous')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId('next_page_recap')
                .setLabel('Next ▶️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(page === totalPages - 1)
        );
    };

    const messagePayload = { embeds: [generateEmbed(currentPage)] };
    if (totalPages > 1) {
        messagePayload.components = [generateButtons(currentPage)];
    }

    // Send the message to the channel
    const response = await channel.send(messagePayload);

    // Attach the collector if there are multiple pages
    if (totalPages > 1) {
        const collector = response.createMessageComponentCollector({ 
            componentType: ComponentType.Button, 
            time: 5 * 60 * 1000 
        });

        collector.on('collect', async i => {
            // Anyone can click these buttons, so no user ID check is needed
            if (i.customId === 'prev_page_recap') currentPage--;
            else if (i.customId === 'next_page_recap') currentPage++;

            await i.update({
                embeds: [generateEmbed(currentPage)],
                components: [generateButtons(currentPage)]
            });
        });

        collector.on('end', async () => {
            await response.edit({ components: [] }).catch(() => {});
        });
    }
}