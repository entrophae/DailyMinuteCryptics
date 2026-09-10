import { ActionRowBuilder, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getPuzzleByUuid, getOrAddUser, getUserPuzzleReveals, startUserPuzzle, updateUserHintReveals, getPuzzleReveals, updateUserPuzzleReveals, finishUserPuzzle, getServerTimezone, updateUserAfterSolve, getUserSolve } from "../../database.js";
import { devLog } from "../../dev.js";
import { createMessage } from "./clueRenderer.js";
import { sendToServers } from "./solveRenderer.js";
import { COLOURS } from '../../constants.js';

export async function handleSolverButtons(client, interaction) {
    const serverId = interaction.guild.id;
    const parts = interaction.customId.split("_");
    const buttonOrigin = parts[0];
    const buttonCommand = parts[1];
    const puzzleUuid = parts[2];

    if (buttonCommand === 'submit-answer') {
        const answerInput = new TextInputBuilder()
            .setCustomId('answer_input')
            .setLabel("What is the answer?")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const actionRow = new ActionRowBuilder().addComponents(answerInput);

        const modal = new ModalBuilder()
            .setCustomId(`daily-minute-cryptics_submit-modal_${puzzleUuid}`)
            .setTitle('Submit Your Answer')
            .addComponents(actionRow);

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

            const sentCount = await sendToServers(client, interaction, internalUserId, puzzleData);

            const hintsList = puzzleData.hints
                ?.filter(h => h.text?.trim()) // Make sure the hint actually has text
                .map((h, i) => `**${h.type.toUpperCase()}:** ${h.text}`)
                .join("\n\n");
            
            const hintsEmbed = new EmbedBuilder()
                .setTitle('🧩 Puzzle Explanations')
                .setColor(COLOURS.definition.hex)
                .setDescription(hintsList || "No textual hints available for this puzzle.");

            return interaction.editReply({
                content:`✅ **Correct!** Your stats have been posted in the channel and ${(sentCount -1)} other server(s).`,
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
