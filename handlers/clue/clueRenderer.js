import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getServerChannel, getServerMessageId, getServerPuzzle, getServerPuzzleStat, updateServerMessageId } from "../../database.js";
import { getParRequestData } from "./puzzleSync.js";
import { COLOURS, SPACES, URLS, COURSES } from '../../constants.js';

export async function sendClueEmbed(client, serverId) {
    const puzzleData = await getServerPuzzle(serverId);
    const activeChannelId = await getServerChannel(serverId);
    const guild = client.guilds.cache.get(serverId);
    if (guild && activeChannelId) {
        const activeChannel = guild.channels.cache.get(activeChannelId);
        if (activeChannel) {
            const message = await createMessage(puzzleData, serverId);
            const sentMessage = await activeChannel.send(message);
            await updateServerMessageId(serverId, sentMessage.id);
        }
    }
}

export async function createMessage(puzzleData, serverId, userRevealedPieces = [], userRevealedHints = [], hintMessage = null){
    const fullClue = puzzleData.clue.join(" ");
    const uuid = puzzleData.puzzle_uuid;

    const formattedAnsiClue = formatClueAnsi(fullClue, puzzleData.hints, userRevealedHints);
    const config = puzzleData.config || [puzzleData.puzzle_pieces.length];

    const answerLength = config.join(", ");

    let pieceIndex = 0;
    
    const answerBlanks = config.map(wordLength => {
        let wordBlanks = [];
        for (let i = 0; i < wordLength; i++) {
            const piece = puzzleData.puzzle_pieces[pieceIndex];
            if (userRevealedPieces.includes(pieceIndex)) {
                wordBlanks.push(`**\`${piece}\`**`);
            } else {
                wordBlanks.push("\`\_\`");
            }
            pieceIndex++;
        }
        return wordBlanks.join(" ");
    }).join(` ${SPACES.ems} `);

    const d = new Date(puzzleData.date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const date = `${day}.${month}.${year}`;

    let description = `## Clue:\n\`\`\`ansi\n${formattedAnsiClue} (${answerLength})\n\`\`\`\n## Answer:\n# ${answerBlanks}`;
    if (hintMessage) {
        description += `\n\n**Hint:**\n> ${hintMessage}`;
    }

    const footerText = await generateStatsFooterText(puzzleData, serverId);

    const embed = new EmbedBuilder()
        .setColor(COLOURS.default.hex)
        .setAuthor({ 
            name: `By ${puzzleData.setter_name} | ${date}`, 
            url: URLS.minuteCryptic 
        })
        .setDescription(description)
        .addFields(
            { name: 'Color Legend:', value: `\`\`\`ansi\nDefinition: ${COLOURS.definition.ansi} ${COLOURS.default.ansi} \nIndicators: ${COLOURS.indicators.ansi} ${COLOURS.default.ansi} \nFodder: ${COLOURS.fodder.ansi} ${COLOURS.default.ansi}\n\`\`\``, inline: true },
            { name: SPACES.zws, value: SPACES.zws, inline: true },
            { name: SPACES.zws, value: SPACES.zws, inline: true },
            { name: 'Letterplay Courses:', value: COURSES.letterplay, inline: true },
            { name: 'Wordplay Courses:', value: COURSES.wordplay, inline: true },
            { name: 'Weirdplay Courses:', value: COURSES.weirdplay, inline: true },
        )
        .setFooter({ text: footerText})
        .setTimestamp();

    const hintRow = new ActionRowBuilder();

    if (puzzleData.hints?.some(h => h.type === 'wordplay' && h.text?.trim())) {
        hintRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`daily-minute-cryptics_wordplay_${uuid}`)
                .setLabel('Show Wordplay')
                .setStyle(ButtonStyle.Primary)
        );
    }
    if (puzzleData.hints?.some(h => h.type === 'indicators' && h.text?.trim())) {
        hintRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`daily-minute-cryptics_indicators_${uuid}`)
                .setLabel('Show Indicators')
                .setStyle(ButtonStyle.Primary)
        );
    }
    if (puzzleData.hints?.some(h => h.type === 'fodder' && h.text?.trim())) {
        hintRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`daily-minute-cryptics_fodder_${uuid}`)
                .setLabel('Show Fodders')
                .setStyle(ButtonStyle.Primary)
        );
    }
    const defHints = puzzleData.hints?.filter(h => h.type === 'definition' && h.text?.trim()) || [];
    if (defHints.length === 1) {
        hintRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`daily-minute-cryptics_definition_${uuid}`)
                .setLabel('Show Definition')
                .setStyle(ButtonStyle.Primary)
        );
    } else if (defHints.length > 1) {
        defHints.forEach((_, i) => {
            hintRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`daily-minute-cryptics_definition-${i}_${uuid}`)
                    .setLabel(`Show Definition ${i + 1}`)
                    .setStyle(ButtonStyle.Primary)
            );
        });
    }

    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`daily-minute-cryptics_start_${uuid}`)
            .setLabel('Start Timer')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`daily-minute-cryptics_reveal-letter_${uuid}`)
            .setLabel('Reveal Letter')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`daily-minute-cryptics_submit-answer_${uuid}`)
            .setLabel('Submit Answer')
            .setStyle(ButtonStyle.Success)
    );

    return { embeds: [embed], components: [hintRow, actionRow] };
}

export async function updateLiveStats(client, serverId) {
    try {
        const channelId = await getServerChannel(serverId);
        const messageId = await getServerMessageId(serverId);
        if (!channelId || !messageId) return;

        const guild = client.guilds.cache.get(serverId);
        const channel = guild?.channels.cache.get(channelId);
        if (!channel) return;

        const message = await channel.messages.fetch(messageId).catch(() => null);
        if (!message) return;

        const puzzleData = await getServerPuzzle(serverId);
        if (!puzzleData) return;

        const newFooterText = await generateStatsFooterText(puzzleData, serverId, true);
        const oldEmbed = message.embeds[0];

        if (oldEmbed) {
            const updatedEmbed = EmbedBuilder.from(oldEmbed).setFooter({ text: newFooterText });
            await message.edit({ embeds: [updatedEmbed] });
        }
    } catch (err) {
        console.error(`Failed to background update live stats for server ${serverId}:`, err);
    }
}

async function generateStatsFooterText(puzzleData, serverId) {
    const serverStats = await getServerPuzzleStat(puzzleData.puzzle_uuid, serverId);

    let worldSolves = puzzleData.par_details?.solveCount || "N/A";
    let worldAvgHelp = puzzleData.par_details?.averagePar || "N/A";
    let worldAvgTime = puzzleData.par_details?.medianSolveTimeSeconds || "N/A";

    try {
        const parData = await getParRequestData(serverId);
        if (parData) {
            worldSolves = parData.parDetails?.solveCount || worldSolves;
            worldAvgHelp = parData.parDetails?.averagePar || worldAvgHelp;
            worldAvgTime = parData.parDetails?.medianSolveTimeSeconds || worldAvgTime;
        } else {console.error('Failed to fetch fresh world stats: parData returned null');}
    } catch (error) {
        console.error('Failed to fetch fresh world stats:', error);
    }
    return `\n🌍 Stats: Total Solves: ${worldSolves} | Average Help: ${worldAvgHelp} | Average Time: ${worldAvgTime}s\n🏡 Total Solves: ${serverStats.total_solves} | Average Help: ${serverStats.average_help} | Average Time: ${serverStats.average_time}s\n`;
}

function formatClueAnsi(fullClue, hints, revealedHintTypes = []) {

    let inserts = [];
    if (!hints || revealedHintTypes.length === 0) return fullClue;

    let typeCounts = {};

    for (const hint of hints) {
        // Keep track of how many of this hint type we've seen so far
        if (!typeCounts[hint.type]) typeCounts[hint.type] = 0;
        const currentIndex = typeCounts[hint.type];
        typeCounts[hint.type]++;

        // Check if the user unlocked the generic type OR this specific indexed type
        const exactMatch = revealedHintTypes.includes(hint.type);
        const indexedMatch = revealedHintTypes.includes(`${hint.type}-${currentIndex}`);

        if ((exactMatch || indexedMatch) && hint.highlighting) {
            const color = COLOURS[hint.type].ansi || "";
            for (const [start, end] of hint.highlighting) {
                inserts.push({ index: start, text: color, isReset: 0 });
                inserts.push({ index: end, text: COLOURS.default.ansi, isReset: 1 });
            }
        }
    }

    // Sort descending so insertions don't disrupt upcoming index positions
    inserts.sort((a, b) => {
        if (b.index === a.index) return a.isReset - b.isReset;
        return b.index - a.index;
    });

    let formattedClue = fullClue;
    for (const insert of inserts) {
        formattedClue = formattedClue.slice(0, insert.index) + insert.text + formattedClue.slice(insert.index);
    }

    return formattedClue;
}


export async function reloadLiveMessage(client, serverId) {
    try {
        const channelId = await getServerChannel(serverId);
        const messageId = await getServerMessageId(serverId);
        if (!channelId || !messageId) return false;
        
        const guild = client.guilds.cache.get(serverId);
        const channel = guild?.channels.cache.get(channelId);
        if (!channel) return false;
        
        const message = await channel.messages.fetch(messageId).catch(() => null);
        if (!message) return false;
        
        const puzzleData = await getServerPuzzle(serverId);
        if (!puzzleData) return false;
        
        // Rebuild the message payload with the new config data
        const messagePayload = await createMessage(puzzleData, serverId);
        
        // Edit the live message
        await message.edit(messagePayload);
        return true;
    } catch (err) {
        console.error(`Failed to reload live message for server ${serverId}:`, err);
        return false;
    }
}