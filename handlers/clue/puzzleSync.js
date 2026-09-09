import { getAllServerSettings, getServerTimezone, getServerPuzzleDate, updatePuzzleParDetails, savePuzzle, updateServerPuzzle } from "../../database.js";
import { devLog } from "../../dev.js";
import { sendClueEmbed, updateLiveStats } from "./clueRenderer.js";

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

export async function getPuzzleRequestData(serverId) {
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