import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { getServerLeaderboard, getUserStats} from '../../database.js';

export default {
	data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Look at stats')
        .addSubcommand((subcommand) =>
            subcommand.setName('self')
                .setDescription('Stats about yourself')
        )
        .addSubcommand((subcommand) =>
            subcommand.setName('user')
                .setDescription('Stats about someone else')
                .addUserOption((option) => 
                    option.setName('target').setDescription('The user').setRequired(true)
            ),
        )
        .addSubcommand((subcommand) =>
            subcommand.setName('server')
                .setDescription('Stats about server')
        ),
	async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        await interaction.deferReply();

        if (subcommand === 'self' || subcommand === 'user') {
            const targetUser = subcommand === 'self' 
                ? interaction.user 
                : interaction.options.getUser('target');

            const stats = await getUserStats(targetUser.id);

            if (!stats) {
                return interaction.editReply(`No puzzle stats found for ${targetUser.username} yet.`);
            }

            return interaction.editReply(
                `**Stats for ${targetUser.username}:**\n` +
                `- Total Solves: ${stats.total_solves}\n` +
                `- Perfect Solves (No Help): ${stats.perfect_solves}\n` +
                `- Current Streak: ${stats.streak}\n` +
                `- Max Streak: ${stats.max_streak}`
            );
        }

        if (subcommand === 'server') {
            const leaderboard = await getServerLeaderboard(interaction.guild.id);

            if (leaderboard.length === 0) {
                return interaction.editReply("Nobody in this server has solved a puzzle yet!");
            }

            let message = `**Leaderboard for ${interaction.guild.name}:**\n`;
            leaderboard.forEach((entry, index) => {
                message += `${index + 1}. <@${entry.user_id}> - ${entry.total_solves} solves (Streak: ${entry.streak})\n`;
            });

            return interaction.editReply(message);
        }
    },
};

async function createEmbed(subcommand) {
    if (subcommand === 'self' || subcommand === 'user') {
        const targetUser = subcommand === 'self' 
            ? interaction.user 
            : interaction.options.getUser('target');

        const stats = await getUserStats(targetUser.id);
        if (!stats) {
            return interaction.editReply(`No stats found for ${targetUser.username} yet.`);
        }
        const hasSolves = stats.total_solves > 0;
        const lastSolve = stats.last_solve_date 
            ? `<t:${Math.floor(new Date(stats.last_solve_date).getTime() / 1000)}:D>` 
            : 'Never';
        
        const embed = new EmbedBuilder()
            .setTitle(`📊 Cryptic Stats: ${targetUser.username}`)
            .setColor('#2b2d31')
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'Total Solves', value: `${stats.total_solves}`, inline: true },
                { name: 'Perfect Solves', value: `${stats.perfect_solves}`, inline: true },
                { name: 'Last Solve', value: lastSolve, inline: true },
                
                { name: 'Least Help Used', value: hasSolves ? `${stats.least_help ?? 0} hints` : 'N/A', inline: true },
                { name: 'Max Help Used', value: hasSolves ? `${stats.max_help ?? 0} hints` : 'N/A', inline: true },
                { name: '\u200B', value: '\u200B', inline: true },
                
                { name: 'Current Streak', value: `🔥 ${stats.streak}`, inline: true },
                { name: 'Max Streak', value: `⭐ ${stats.max_streak}`, inline: true },
                { name: '\u200B', value: '\u200B', inline: true }
            )
            .setFooter({ text: 'Daily Minute Cryptics' })
            .setTimestamp();
    }
    else if (subcommand === 'server') {
        const leaderboard = await getServerLeaderboard(interaction.guild.id);

        if (leaderboard.length === 0) {
            return interaction.editReply("Nobody in this server has solved a puzzle yet!");
        }

        const itemsPerPage = 10;
        const totalPages = Math.ceil(leaderboard.length / itemsPerPage);
        let currentPage = 0;

        // helper function to generate the embed for a specific page
        const generateEmbed = (page) => {
            const start = page * itemsPerPage;
            const currentItems = leaderboard.slice(start, start + itemsPerPage);

            let message = '';
            currentItems.forEach((entry, index) => {
                const rank = start + index + 1;
                const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🏅';
                message += `${medal} **#${rank}** <@${entry.user_id}> - ${entry.total_solves} solves (🔥 ${entry.streak})\n`;
            });

            return new EmbedBuilder()
                .setTitle(`🏆 Server Leaderboard: ${interaction.guild.name}`)
                .setColor('#ffd700')
                .setDescription(message)
                .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
                .setFooter({ text: `Page ${page + 1} of ${totalPages} | Daily Minute Cryptics` })
                .setTimestamp();
        };

        // helper function to generate the buttons
        const generateButtons = (page) => {
            return new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('prev_page')
                    .setLabel('◀️ Previous')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page === 0),
                new ButtonBuilder()
                    .setCustomId('next_page')
                    .setLabel('Next ▶️')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page === totalPages - 1)
            );
        };

        const response = await interaction.editReply({ 
            embeds: [generateEmbed(currentPage)], 
            components: totalPages > 1 ? [generateButtons(currentPage)] : [] 
        });

        if (totalPages > 1) {
            const collector = response.createMessageComponentCollector({ 
                componentType: ComponentType.Button, 
                time: 5*60*1000 
            });

            collector.on('collect', async i => {
                // prevent other users from clicking the buttons
                if (i.user.id !== interaction.user.id) {
                    await i.reply({ content: 'You cannot use these buttons.', ephemeral: true });
                    return;
                }

                if (i.customId === 'prev_page') currentPage--;
                else if (i.customId === 'next_page') currentPage++;

                await i.update({
                    embeds: [generateEmbed(currentPage)],
                    components: [generateButtons(currentPage)]
                });
            });

            // when the 5 minutes are up, remove the buttons so they don't sit there dead
            collector.on('end', async () => {
                await interaction.editReply({ components: [] }).catch(() => {});
            });
        }
        return;
    }

    return interaction.editReply({ embeds: [embed] });
}
