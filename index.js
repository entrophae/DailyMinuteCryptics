import { Client, Events, GatewayIntentBits, Collection, MessageFlags } from 'discord.js';
import { devLog, startHeartbeat } from './dev.js';
import timezone from './commands/settings/timezone.js';
import channel from './commands/settings/channel.js';
import stats from './commands/utility/stats.js';
import currentClue from './commands/utility/currentClue.js';
import { syncCommand } from './deploy-commands.js';
import { initializeServer, deleteServerSettings, createTables } from './database.js';
import { loopServers, handleSolverButtons, handleAnswerSubmit } from './handlers/solver.js';

const COLOURS = {
    indicators: "#f5d1fd",
    fodder: "#fff2b1",
    definition: "#add3ff",
    card: "#f4f5f6"
}
const DISCORD_COLOURS = {
    indicators: "[45m ",
    fodder: "[43m ",
    definition: "[44m ",
    ending: " [0m"
}

/** Solved result card
 *  Clue streak: X clue streak
 *  Hints used: Your hints - Average hints
 *  Par count: X below/above world par -
 *  Timing: Yout time - Average server time - Average world time 
 *  Solvers: X solvers in server - Y solvers in world
 *  Next clue in X time
 *  Explanation video
 *  Hints available
 */

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.MessageContent,
    ],
});
client.commands = new Collection();
const commands = [
    timezone,
    channel,
    stats,
    currentClue
];

client.login(process.env.TOKEN).catch(err => {
    console.error("Login failed!", err);
    process.exit(1);
});

client.on(Events.ClientReady, async () => {
    await createTables();
    await startHeartbeat(client, 10);
    let message = `Logged in as ${client.user.tag} in:\n`
    for (const guild of client.guilds.cache.values()) {
        await initializeServer(guild.id);
        message += `- ${guild.name}\n`;
    }
    loopServers(client);

    console.info(message.trim());
    for (const command of commands) {
        client.commands.set(command.data.name, command);
    }
    for (const guild of client.guilds.cache.values()) {
        for (const command of commands) {
                await syncCommand(client, guild, command);
        }
    }
});

client.on(Events.GuildCreate, async (guild) => {
    console.info(`Added to ${guild.name}!`);
    await initializeServer(guild.id);
    for (const command of commands) {
        client.commands.set(command.data.name, command);
        await syncCommand(client, guild, command);
    }
});

client.on(Events.GuildDelete, async (guild) => {
    console.info(`Removed from ${guild.name}. Deleting settings.`);
    await deleteServerSettings(guild.id);
});

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        
        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            await command.autocomplete(interaction);
        } catch (error) {
            console.error(error);
        }
        return;
    }
    if(interaction.isChatInputCommand() && !interaction.isModalSubmit()){
        const command = client.commands.get(interaction.commandName);
        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            await devLog(client, error, "Command execution", interaction.guild?.name);
            const errPayload = { content: 'There was an error processing this button!', flags: MessageFlags.Ephemeral };
            if (interaction.replied || interaction.deferred) await interaction.followUp(errPayload);
            else await interaction.reply(errPayload);
        }
    }
    if (interaction.isButton()) {
        try {
            await handleSolverButtons(client, interaction);
        } catch (error) {
            await devLog(client, error, "Button Interaction", interaction.guild?.name);
            const errorPayload = { content: 'There was an error processing this button!', flags: MessageFlags.Ephemeral };
            if (interaction.replied || interaction.deferred) await interaction.followUp(errorPayload);
            else await interaction.reply(errorPayload);
        }
        return;
    }
    else if(interaction.isModalSubmit()){
        const modalId = interaction.customId;
        
        if (modalId === "daily-minute-cryptics_submit-modal") {
            try {
                await handleAnswerSubmit(client, interaction);
            } catch (error) {
                await devLog(client, error, "Modal Submission", interaction.guild?.name);
                const errPayload = { content: 'There was an error processing your answer!', flags: MessageFlags.Ephemeral };
                if (interaction.replied || interaction.deferred) await interaction.followUp(errPayload);
                else await interaction.reply(errPayload);
            }
        }
        return;
    }
});
