import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { getServerLeaderboard, getUserStats, getServerGlobalStats } from '../../database.js';

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
        await interaction.deferReply();

        await createEmbed(interaction);
    },
};

async function createEmbed(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'self' || subcommand === 'user') {
        const targetUser = subcommand === 'self' 
            ? interaction.user
            : interaction.options.getUser('target');

        const userStats = await getUserStats(targetUser.id);
        const serverStats = await getServerGlobalStats(interaction.guild.id);

        if (!userStats) {
            return interaction.editReply(`No stats found for ${targetUser.username} yet.`);
        }
        const avgHelpUsedCount = userStats.avg_help || 0;
        const avgParDiff = userStats.avg_par_diff || 0;
        const lastSolve = userStats.last_solve_date 
            ? `<t:${Math.floor(new Date(userStats.last_solve_date).getTime() / 1000)}:D>` 
            : 'Never';
        let parText = "Equal to server average";
        if (avgParDiff > 0) parText = `${avgParDiff} above server average`;
        if (avgParDiff < 0) parText = `${Math.abs(avgParDiff)} below server average`;

        const embed = new EmbedBuilder()
            .setTitle(`Server Stats: ${targetUser.username}`)
            .setColor('#f5d1fd')
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .setDescription(`
## **<@${targetUser.id}>**
**✨ Total Solves:** ${userStats.total_solves || 0} (${userStats.perfect_solves || 0} perfect)
**✨ Last Solve:** ${lastSolve}

**🔥 Current Streak:** ${userStats.streak || 1}
**🏆 Max Streak:** ${userStats.max_streak || 1}

**💡 Max Hints Used:** ${userStats.max_help ?? 0} hints
**💡 Min Hints Used:** ${userStats.least_help ?? 0} hints
**💡 Avg Hints Used:** ${avgHelpUsedCount} hints (Server Avg: ${serverStats.server_avg_help})
**⛳ Avg Par Diff:** ${parText}
            `)
            .setFooter({ text: 'Daily Minute Cryptics' })
            .setTimestamp();

        interaction.editReply({ embeds: [embed] });
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
    }
}


async function createUserStat(interaction, serverId) {
    const userStats = await getUserStats(interaction.user.id);
    const serverStats = await getServerGlobalStats(serverId);

    const avgHelpUsedCount = userStats?.avg_help || 0;
    const avgParDiff = userStats?.avg_par_diff || 0;

    let parText = "Equal to server average";
    if (avgParDiff > 0) parText = `${avgParDiff} above server average`;
    if (avgParDiff < 0) parText = `${Math.abs(avgParDiff)} below server average`;

    const resultEmbed = new EmbedBuilder()
        .setTitle(`📊 Lifetime Stats`)
        .setColor('#fff2b1')
        .setDescription(`
## **<@${interaction.user.id}>**
**✨ Total Solves:** ${userStats?.total_solves || 0} (${userStats?.perfect_solves || 0} perfect)

**🔥 Current Streak:** ${userStats?.streak || 1}
**🏆 Max Streak:** ${userStats?.max_streak || 1}

**💡 Avg Hints Used:** ${avgHelpUsedCount} hints (Server Avg: ${serverStats.server_avg_help})
**⛳ Avg Par Diff:** ${parText}
        `)
        .setFooter({ text: "DailyMinuteCryptics" })
        .setTimestamp();

    return resultEmbed;
}
