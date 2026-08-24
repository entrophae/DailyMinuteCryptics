import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getPuzzleByUuid, getPuzzleReveals, getServerChannel, getUserPuzzleReveals, updateUserPuzzleReveals, getServerTimezone, savePuzzle, updateServerPuzzle, getServerPuzzle, getOrAddUser, getServerPuzzleStat, updateUserHintReveals, getAllServerSettings, getServerPuzzleDate, finishUserPuzzle, getUserSolve, getUserStats, startUserPuzzle, updateServerMessageId, getServerMessageId, updatePuzzleParDetails, updateUserAfterSolve } from "../database.js";
import { devLog } from "../dev.js";

export async function loopServers(client){
    setInterval(async () => {
        try {
            const servers = await getAllServerSettings();

            for (const server of servers) {
                try {
                    const isNewClue = await checkForNewClue(client, server.server_id);

                    if (isNewClue) {
                        await sendClueEmbed(client, server.server_id);
                    } else {
                        await updateLiveStats(client, server.server_id);
                    }
                } catch (serverErr) {
                    console.error(`Loop error for server ${server.server_id}:`, serverErr);
                }
            }
        } catch (globalErr) {
            console.error('Fatal database error in 5-minute loop:', globalErr);
        }
    }, 5 * 60 * 1000);
}

async function getCurrentDate(serverId) {
    const tz = await getServerTimezone(serverId);

    const tzDate = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
    const year = tzDate.getFullYear();
    const month = String(tzDate.getMonth() + 1).padStart(2, '0');
    const day = String(tzDate.getDate()).padStart(2, '0');
    const currentDate = `${year}-${month}-${day}`;
    return currentDate;
}

async function getPuzzleRequestData(serverId) {
    const tz = await getServerTimezone(serverId);
    const url = new URL(`https://www.minutecryptic.com/api/daily_puzzle/today?tz=${encodeURIComponent(tz)}`);
    const request = await fetch(url);
    if (!request.ok) {
        console.error(`Failed to fetch puzzle: ${request.status} : ${url}`);
        return null;
    }
    else return await request.json();
}
async function getParRequestData(serverId) {
    const currentDate = await getCurrentDate(serverId);
    const url = new URL(`https://www.minutecryptic.com/api/daily_puzzle/par/${currentDate}`)
    const request = await fetch(url);
    if (!request.ok) {
        console.error(`Failed to fetch puzzle par: ${request.status} : ${url}`);
        return null;
    }
    else return await request.json();
}

export async function checkForNewClue(client, serverId) {
    const currentDate = await getCurrentDate(serverId);
    const savedDate = await getServerPuzzleDate(serverId);

    try {
        const puzzleData = await getPuzzleRequestData(serverId);
        if (!puzzleData) return false;

        const parData = await getParRequestData(serverId);
        if (parData) {
            if (JSON.stringify(puzzleData.parDetails) !== JSON.stringify(parData.parDetails)) {
                await updatePuzzleParDetails(puzzleData.puzzle_uuid, parData.parDetails);
            }
        }

        if (savedDate === currentDate) {
    	    return false;
    	}

        await savePuzzle(puzzleData);
        await updateServerPuzzle(serverId, puzzleData.puzzleId, puzzleData.date);

        return true;
    } catch (e) {
        devLog(client, e, "Fetching new Clue");
        return false;
    }
}

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

async function createMessage(puzzleData, serverId, userRevealedPieces = [], userRevealedHints = [], hintMessage = null){
    const fullClue = puzzleData.clue.join(" ");
    const answerLength = puzzleData.puzzle_pieces.length;
    const uuid = puzzleData.puzzle_uuid;

    const formattedAnsiClue = formatClueAnsi(fullClue, puzzleData.hints, userRevealedHints);

    const answerBlanks = puzzleData.puzzle_pieces.map((piece, index) => {
        if (userRevealedPieces.includes(index)) return `**\`${piece}\`**`;
        return "\`\_\`";
    }).join("  ");

    const d = new Date(puzzleData.date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const date = `${day}.${month}.${year}`;

    const serverData = getServerPuzzleStat(puzzleData.puzzle_uuid, serverId);

    let description = `## Clue:\n\`\`\`ansi\n${formattedAnsiClue} (${answerLength})\n\`\`\`\n## Answer:\n# ${answerBlanks}`;
    if (hintMessage) {
        description += `\n\n**Hint:**\n> ${hintMessage}`;
    }

    const footerText = await generateStatsFooterText(puzzleData, serverId);
    const coursePrefix = "https://www.minutecryptic.com/course";

    const embed = new EmbedBuilder()
        .setColor("#f4f5f6")
        .setAuthor({ 
            name: `By ${puzzleData.setter_name} | ${date}`, 
            url: "https://minutecryptic.com" 
        })
        .setDescription(description)
        .addFields(
            { name: 'Color Legend:', value: `\`\`\`ansi\nDefinition: [46m [0m \nIndicators: [45m [0m \nFodder: [43m [0m\n\`\`\``, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: 'Letterplay Course:', value: `\n-# [Basics](${coursePrefix}/letterplay/basics/1)\n-# [Anagrams](${coursePrefix}/letterplay/anagrams/1)\n-# [Selectors](${coursePrefix}/letterplay/selectors/1)\n-# [Hiddens](${coursePrefix}/letterplay/hiddens/1)\n-# [Reversals](${coursePrefix}/letterplay/reversals/1)`, inline: true },
            { name: 'Wordplay Course:', value: `\n-# [Synonyms](${coursePrefix}/wordplay/synonyms/1)\n-# [Symbols](${coursePrefix}/wordplay/symbols/1)\n-# [Containers](${coursePrefix}/wordplay/containers/1)\n-# [Deletions](${coursePrefix}/wordplay/deletions/1)\n-# [Homophones](${coursePrefix}/wordplay/homophones/1)`, inline: true },
            { name: 'Weirdplay Course:', value: `\n-# [Translations](${coursePrefix}/weirdplay/translation/1)\n-# [Homoglyphs](${coursePrefix}/weirdplay/homoglyphs/1)\n-# [Double Definitions](${coursePrefix}/weirdplay/double-definitions/1)\n-# [Rebuses](${coursePrefix}/weirdplay/rebuses/1)\n-# [&lits](${coursePrefix}/weirdplay/and-lits/1)`, inline: true },
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
                    .setCustomId(`daily-minute-cryptics_definition-${i}_${uuid}`) // e.g., definition-0
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

async function updateLiveStats(client, serverId) {
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

export async function handleSolverButtons(client, interaction) {
    const serverId = interaction.guild.id;
    const parts = interaction.customId.split("_");
    const buttonOrigin = parts[0];
    const buttonCommand = parts[1];
    const puzzleUuid = parts[2];

    if (buttonCommand === 'submit-answer') {
        const modal = new ModalBuilder()
            .setCustomId(`daily-minute-cryptics_submit-modal_${puzzleUuid}`)
            .setTitle('Submit Your Answer');

        const answerInput = new TextInputBuilder()
            .setCustomId('answer_input')
            .setLabel("What is the answer?")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const actionRow = new ActionRowBuilder().addComponents(answerInput);
        modal.addComponents(actionRow);

        return await interaction.showModal(modal);
    }

    const isEphemeral = interaction.message.flags.has(MessageFlags.Ephemeral);
    if (isEphemeral) {
        await interaction.deferUpdate();
    } else {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    const puzzleData = await getPuzzleByUuid(puzzleUuid);
    if (!puzzleData) {
        return interaction.editReply({ content: "Error: Could not locate this puzzle in the database."});
    }

    const internalUserId = await getOrAddUser(interaction.user.id, serverId);
    const statRes = await getUserPuzzleReveals(internalUserId, puzzleData.id);
    const isFinished = statRes.rows[0]?.is_finished || false;

    if (isFinished) {
        return interaction.editReply({ 
            content: "🏁 You have already completed this puzzle! Check your stats or wait for tomorrow."
        });
    }

    if (buttonCommand === 'start') {
        await startUserPuzzle(internalUserId, puzzleData.id);
        return interaction.editReply({
            content: "⏱️ **Timer started!** Good luck solving the cryptic!"
        });
    }

    if (buttonCommand === 'reveal-letter') {
        const revealData = await revealNextLetter(client, internalUserId, puzzleData.id);

        if (!revealData) return interaction.editReply("An error occurred while revealing the letter.");
        if (revealData.error) return interaction.editReply("You have already revealed all available letters!");

        const statRes = await getUserPuzzleReveals(internalUserId, puzzleData.id);
        const userRevealedPieces = statRes.rows[0]?.revealed_puzzle_pieces || [];
        const userRevealedHints = statRes.rows[0]?.revealed_hint_types || [];

        const messagePayload = await createMessage(puzzleData, serverId, userRevealedPieces, userRevealedHints, null);
        return interaction.editReply(messagePayload);
    }
    if (['indicators', 'fodder', 'definition', 'wordplay'].includes(buttonCommand)) {
        const baseCommand = buttonCommand.split('-')[0];
        const isIndexed = buttonCommand.includes('-');
        const targetIndex = isIndexed ? parseInt(buttonCommand.split('-')[1], 10) : 0;
        
        const matchingHints = puzzleData.hints?.filter(h => h.type === baseCommand && h.text?.trim());

        // Guard against missing hints
        if (!matchingHints || matchingHints.length === 0 || !matchingHints[targetIndex]) {
            return interaction.editReply(`There is no **${baseCommand}** available for this puzzle.`);
        }

        const hint = puzzleData.hints?.find(h => h.type === buttonCommand);

        await updateUserHintReveals(internalUserId, puzzleData.id, buttonCommand);

        const statRes = await getUserPuzzleReveals(internalUserId, puzzleData.id);
        const userRevealedPieces = statRes.rows[0]?.revealed_puzzle_pieces || [];
        const userRevealedHints = statRes.rows[0]?.revealed_hint_types || [];

        const displayLabel = isIndexed ? `${baseCommand.toUpperCase()} ${targetIndex + 1}` : baseCommand.toUpperCase();
        const hintMessage = `**${displayLabel}:** ${hint.text}`;

        const messagePayload = await createMessage(puzzleData, serverId, userRevealedPieces, userRevealedHints, hintMessage);
        return interaction.editReply(messagePayload);
    }
}

/**
 * Reveals the next letter for a user based on the puzzle's reveal order.
 * Updates the database and returns the letter and its position.
 */
export async function revealNextLetter(client, internalUserId, internalPuzzleId) {
    try {
        const puzzleRes = await getPuzzleReveals(internalPuzzleId)
        if (puzzleRes.rows.length === 0) return null;

        const puzzle = puzzleRes.rows[0];
        const statRes = await getUserPuzzleReveals(internalUserId, internalPuzzleId);
        const currentRevealed = statRes.rows[0]?.revealed_puzzle_pieces || [];
        const nextRevealOrderIndex = currentRevealed.length;

        if (nextRevealOrderIndex >= puzzle.letter_reveal_order.length) {
            return { error: "All letters already revealed" };
        }

        const nextPieceIndex = puzzle.letter_reveal_order[nextRevealOrderIndex];
        const letterToReveal = puzzle.puzzle_pieces[nextPieceIndex];

        await updateUserPuzzleReveals(internalUserId, internalPuzzleId, nextPieceIndex)

        return {
            index: nextPieceIndex,
            letter: letterToReveal
        };

    } catch (err) {
        devLog(client, err, "Revealing letter");
        return null;
    }
}

function formatClueAnsi(fullClue, hints, revealedHintTypes = []) {
    const ANSI_COLORS = {
        definition: "\u001b[46m",
        indicators: "\u001b[45m",
        fodder: "\u001b[43m",
        reset: "\u001b[0m"
    };

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
            const color = ANSI_COLORS[hint.type] || "";
            for (const [start, end] of hint.highlighting) {
                inserts.push({ index: start, text: color, isReset: 0 });
                inserts.push({ index: end, text: ANSI_COLORS.reset, isReset: 1 });
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

export async function handleAnswerSubmit(client, interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const serverId = interaction.guild.id;
        const parts = interaction.customId.split("_");
        const puzzleUuid = parts[2];

        const puzzleData = await getPuzzleByUuid(puzzleUuid);

        if (!puzzleData) {
            return interaction.editReply({ content: "Error: Could not locate this puzzle in the database.", flags: MessageFlags.Ephemeral });
        }

        const submittedAnswer = interaction.fields.getTextInputValue('answer_input').trim().toUpperCase();
        const correctAnswer = puzzleData.answer.toUpperCase();
        const internalUserId = await getOrAddUser(interaction.user.id, serverId);

        const statRes = await getUserPuzzleReveals(internalUserId, puzzleData.id);
        if (statRes.rows[0]?.is_finished) {
            return interaction.editReply({ 
                content: "🏁 You have already completed this puzzle!" 
            });
        }

        if (submittedAnswer === correctAnswer) {
            await finishUserPuzzle(internalUserId, puzzleData.id);

            const userSolve = await getUserSolve(internalUserId, puzzleData.id);
            const helpUsedCount = userSolve?.help_used ? userSolve.help_used.length : 0;

            const serverTz = await getServerTimezone(serverId);
            const now = new Date(new Date().toLocaleString("en-US", { timeZone: serverTz }));
            const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

            await updateUserAfterSolve(internalUserId, todayStr, helpUsedCount);

            const resultEmbed = await createSolveStat(interaction, serverId, internalUserId, puzzleData);

            const hintsList = puzzleData.hints
                ?.filter(h => h.text?.trim()) // Make sure the hint actually has text
                .map((h, i) => `**${h.type.toUpperCase()}:** ${h.text}`)
                .join("\n\n");
            
            const hintsEmbed = new EmbedBuilder()
                .setTitle('🧩 Puzzle Explanations')
                .setColor('#add3ff')
                .setDescription(hintsList || "No textual hints available for this puzzle.");

            return interaction.editReply({
                content:`✅ **Correct!** Your stats have been posted in the channel `,
                embeds: [hintsEmbed]
            });

        } else {
            return interaction.editReply({ 
                content: `❌ **Incorrect!** \`${submittedAnswer}\` is not the right answer. Keep trying!`, 
                flags: MessageFlags.Ephemeral 
            });
        }
    } catch (err) {
        console.error("Crash inside handleAnswerSubmit:", err);
        return interaction.editReply({ content: "An internal error occurred while checking your answer." });
    }
}

const formatTime = (seconds) => {
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

    const helpUsedCount = userSolve?.help_used ? userSolve.help_used.length : 0;
    const parDiff = helpUsedCount - puzzleData.par;
    const avgParDiff = helpUsedCount - (puzzleData.par_details?.averagePar || 0);;

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

    const d = new Date(puzzleData.date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const date = `${day}.${month}.${year}`;

    const resultEmbed = new EmbedBuilder()
        .setTitle(`🎉 Puzzle Solved for ${date}!`)
        .setColor('#add3ff')
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

[**▶️ Watch Explanation Video**](${puzzleData.explainer_video})
        `)
        .setFooter({ text: "DailyMinuteCryptics" })
        .setTimestamp();

    return resultEmbed;
}

