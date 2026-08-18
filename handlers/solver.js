import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getPuzzleReveals,  getServerChannel,  getUserPuzzleReveals, updateUserPuzzleReveals, getServerTimezone,savePuzzle, updateServerPuzzle, getServerPuzzle, getOrAddUser, getServerPuzzleStat, updateUserHintReveals, getAllServerSettings, getServerPuzzleDate, finishUserPuzzle, getUserSolve, getUserStats, startUserPuzzle} from "../database.js";
import { devLog } from "../dev.js";

export async function loopServers(client){
    setInterval(async () => {
        const servers = await getAllServerSettings();
        
        for (const server of servers) {
            // Check if it is midnight and fetch the puzzle
            const isNewClue = await checkForNewClue(client, server.server_id);
            
            // If a new clue was successfully fetched and saved, send the embed
            if (isNewClue) {
                await sendClueEmbed(client, server.server_id);
            }
        }
    }, 5 * 60 * 1000);
}

export async function checkForNewClue(client, serverId) {
    const tz = await getServerTimezone(serverId);

    const currentDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());

    const savedDate = await getServerPuzzleDate(serverId);
    if (savedDate === currentDate) {
        return false;
    }

    const url = new URL(`https://www.minutecryptic.com/api/daily_puzzle/today?tz=${encodeURIComponent(tz)}`);
    const parUrl = new URL(`https://www.minutecryptic.com/api/daily_puzzle/par/${currentDate}`)
    
    try {
        const [request, requestPar] = await Promise.all([
            fetch(url),
            fetch(parUrl)
        ]);

        if (!request.ok || !requestPar.ok) {
            console.error( `Failed to fetch puzzle: ${request.status}, par: ${requestPar.status}` );
            return false;
        }

        const puzzleData = await request.json();
        const parData = await requestPar.json();

        puzzleData.parDetails = parData.parDetails;

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
            await activeChannel.send(message);
        }
    }
}

async function createMessage(puzzleData, serverId, userRevealedPieces = [], userRevealedHints = [], hintMessage = null){
    const fullClue = puzzleData.clue.join(" ");
    const answerLength = puzzleData.puzzle_pieces.length;

    const formattedAnsiClue = formatClueAnsi(fullClue, puzzleData.hints, userRevealedHints);

    const answerBlanks = puzzleData.puzzle_pieces.map((piece, index) => {
        if (userRevealedPieces.includes(index)) return `**\\\`${piece}\\\`**`;
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
            { name: 'Wordplays:', value: `-# Substit. Synonyms\n-# Substit. Symbols\n-# Containers\n-# Deletions\n-# Homophones`, inline: true },
            { name: 'Letterplays:', value: `\n-# Anagrams\n-# Selectors\n-# Hiddens\n-# Reversals`, inline: true },
            { name: 'Weirdplays:', value: `\n-# Translations\n-# Homoglyphs\n-# Double Definitions\n-# Rebuses\n-# &lits`, inline: true },
        )
        .setFooter({ text: `\n🌍 Stats: Total Solves: ${puzzleData.par_details.solveCount} | Average Help: ${puzzleData.par_details.averagePar} | Average Time: ${puzzleData.par_details.medianSolveTimeSeconds}s\n🏡 Total Solves: ${serverData.total_solves} | Average Help: ${serverData.average_help} | Average Time: ${serverData.average_time}s`})
        .setTimestamp();

    const hintRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('daily-minute-cryptics_indicators')
            .setLabel('Show Indicators')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('daily-minute-cryptics_fodder')
            .setLabel('Show Fodders')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('daily-minute-cryptics_definition')
            .setLabel('Show Definition(s)')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('daily-minute-cryptics_reveal-letter')
            .setLabel('Reveal Letter')
            .setStyle(ButtonStyle.Primary),
    );
    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('daily-minute-cryptics_start')
            .setLabel('Start Timer')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('daily-minute-cryptics_submit-answer')
            .setLabel('Submit Answer')
            .setStyle(ButtonStyle.Success)
    );

    return { embeds: [embed], components: [hintRow, actionRow] };
}

export async function handleSolverButtons(client, interaction) {
    const serverId = interaction.guild.id;
    const parts = interaction.customId.split("_");
    const buttonOrigin = parts[0];
    const buttonCommand = parts[1];

    if (buttonOrigin !== "daily-minute-cryptics") return;

    const puzzleData = await getServerPuzzle(serverId);
    if (!puzzleData) {
        return interaction.reply({ content: "No active puzzle found for this server.", flags: MessageFlags.Ephemeral });
    }

    const internalUserId = await getOrAddUser(interaction.user.id, serverId);
    const statRes = await getUserPuzzleReveals(internalUserId, puzzleData.id);
    const isFinished = statRes.rows[0]?.is_finished || false;
    if (isFinished) {
        return interaction.reply({ 
            content: "🏁 You have already completed this puzzle! Check your stats or wait for tomorrow.", 
            flags: MessageFlags.Ephemeral 
        });
    }

    if (buttonCommand === 'submit-answer') {
        const modal = new ModalBuilder()
            .setCustomId('daily-minute-cryptics_submit-modal')
            .setTitle('Submit Your Answer');

        const answerInput = new TextInputBuilder()
            .setCustomId('answer_input')
            .setLabel("What is the answer?")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(puzzleData.answer.length)
            .setMinLength(puzzleData.answer.length)
            .setRequired(true);

        const actionRow = new ActionRowBuilder().addComponents(answerInput);
        modal.addComponents(actionRow);

        return await interaction.showModal(modal);
    }
    

    if (buttonCommand === 'start') {
        await startUserPuzzle(internalUserId, puzzleData.id);
        return interaction.reply({ 
            content: "⏱️ **Timer started!** Good luck solving the cryptic!", 
            flags: MessageFlags.Ephemeral 
        });
    }

    const isEphemeral = interaction.message.flags.has(MessageFlags.Ephemeral);
    if (isEphemeral) {
        await interaction.deferUpdate();
    } else {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
    else if (['indicators', 'fodder', 'definition'].includes(buttonCommand)) {
        const hint = puzzleData.hints?.find(h => h.type === buttonCommand);
        
        if (!hint) {
            return interaction.editReply(`No **${buttonCommand}** hints available for this puzzle.`);
        }

        await updateUserHintReveals(internalUserId, puzzleData.id, buttonCommand);

        const statRes = await getUserPuzzleReveals(internalUserId, puzzleData.id);
        const userRevealedPieces = statRes.rows[0]?.revealed_puzzle_pieces || [];
        const userRevealedHints = statRes.rows[0]?.revealed_hint_types || [];

        const hintMessage = `**${buttonCommand.toUpperCase()}:** ${hint.text}`;
        
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

    for (const hint of hints) {
        if (revealedHintTypes.includes(hint.type) && hint.highlighting) {
            const color = ANSI_COLORS[hint.type] || "";
            for (const [start, end] of hint.highlighting) {
                // isReset flag ensures the reset tag is always inserted AFTER the color tag if indices match
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
    const serverId = interaction.guild.id;
    const puzzleData = await getServerPuzzle(serverId);

    if (!puzzleData) {
        return interaction.reply({ content: "No active puzzle found for this server.", flags: MessageFlags.Ephemeral });
    }

    const submittedAnswer = interaction.fields.getTextInputValue('answer_input').trim().toUpperCase();
    const correctAnswer = puzzleData.answer.toUpperCase();
    const internalUserId = await getOrAddUser(interaction.user.id, serverId);

    const statRes = await getUserPuzzleReveals(internalUserId, puzzleData.id);
    if (statRes.rows[0]?.is_finished) {
        return interaction.reply({ 
            content: "🏁 You have already completed this puzzle!", 
            flags: MessageFlags.Ephemeral 
        });
    }

    if (submittedAnswer === correctAnswer) {
        await finishUserPuzzle(internalUserId, puzzleData.id);

        const userSolve = await getUserSolve(internalUserId, puzzleData.id);
        const userStats = await getUserStats(interaction.user.id);
        const serverStats = await getServerPuzzleStat(puzzleData.puzzle_uuid, serverId);
        const serverTz = await getServerTimezone(serverId);

        const formatTime = (seconds) => {
            if (!seconds || isNaN(seconds)) return "0s";
            const m = Math.floor(seconds / 60);
            const s = Math.floor(seconds % 60);
            return m > 0 ? `${m}m ${s}s` : `${s}s`;
        };

        const helpUsedCount = userSolve?.help_used ? userSolve.help_used.length : 0;
        const parDiff = helpUsedCount - puzzleData.par;
        let parText = "Equal to world par";
        if (parDiff > 0) parText = `${parDiff} above world par 📈`;
        if (parDiff < 0) parText = `${Math.abs(parDiff)} below world par 📉`;

        const now = new Date();
        const localStr = now.toLocaleString("en-US", { timeZone: serverTz });
        const localMidnight = new Date(localStr);
        localMidnight.setDate(localMidnight.getDate() + 1);
        localMidnight.setHours(0, 0, 0, 0);
        const epochDiff = localMidnight.getTime() - new Date(localStr).getTime();
        const nextMidnightEpoch = Math.floor((now.getTime() + epochDiff) / 1000);


        const resultEmbed = new EmbedBuilder()
            .setTitle('🎉 Puzzle Solved!')
            .setColor('#f4f5f6')
            .setDescription(`
## **<@${interaction.user.id}>s Stats**
**🔥 Clue Streak:** ${userStats?.streak || 1} clue streak
**💡 Hints Used:** ${helpUsedCount} hints (World Avg: ${puzzleData.par_details?.averagePar || 0})
**⛳ Par Count:** ${parText}

**⏱️ Timing:**
> **Your Time:** ${formatTime(userSolve?.time_taken_seconds)}
> **Avg Server Time:** ${formatTime(serverStats?.average_time)}
> **Avg World Time:** ${formatTime(puzzleData.par_details?.medianSolveTimeSeconds)}

**👥 Solvers:** ${serverStats?.total_solves || 1} in server • ${puzzleData.par_details?.solveCount || 1} in world
**⏳ Next Clue:** <t:${nextMidnightEpoch}:R>

[**▶️ Watch Explanation Video**](${puzzleData.explainer_video})
            `)
            .setFooter({ text: 'Daily Minute Cryptics' })
            .setTimestamp();

        return interaction.reply({ 
            embeds: [resultEmbed]
        });
    } else {
        return interaction.reply({ 
            content: `❌ **Incorrect!** \`${submittedAnswer}\` is not the right answer. Keep trying!`, 
            flags: MessageFlags.Ephemeral 
        });
    }
}