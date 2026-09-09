import { getAllServerSettings, getServerTimezone, getServerPuzzle, updatePuzzleParDetails, savePuzzle, updateServerPuzzle, getServerThreadId } from "../../database.js";
import { devLog } from "../../dev.js";
import { sendClueEmbed, updateLiveStats, createThread } from "./clueRenderer.js";
import { URLS } from "../../constants.js";
import { sendDailyRecap } from "../dailyLeaderboard.js";

export async function loopServers(client){
    setInterval(async () => {
        try {
            const servers = await getAllServerSettings();

            for (const server of servers) {
                try {
                    const updateCheck = await checkForNewClue(client, server.server_id);

                    if (updateCheck.isNew) {
                        await sendDailyRecap(client, server.server_id, updateCheck.oldPuzzleData);
                        await savePuzzle(updateCheck.newPuzzleData);
                        await updateServerPuzzle(server.server_id, updateCheck.newPuzzleData.puzzleId, updateCheck.newPuzzleData.date);
                        await sendClueEmbed(client, server.server_id);
                    } else {
                        const message = await updateLiveStats(client, server.server_id);
                        // fix for the current Clue as of 09.09.2026
                        if ( message && await getServerThreadId(server.server_id) == null ) {
                            await createThread(message, server.server_id, updateCheck.oldPuzzleData);
                        }
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
    const url = new URL(`${URLS.currentClue}${encodeURIComponent(tz)}`);
    const request = await fetch(url);
    if (!request.ok) {
        console.error(`Failed to fetch puzzle: ${request.status} : ${url}`);
        return request
    }
    else return await request.json();
}

export async function getParRequestData(serverId) {
    const currentDate = await getCurrentDate(serverId);
    const url = new URL(`${URLS.puzzlePar}${currentDate}`)
    const request = await fetch(url);
    if (!request.ok) {
        console.error(`Failed to fetch puzzle par: ${request.status} : ${url}`);
        return null;
    }
    else return await request.json();
}

export async function checkForNewClue(client, serverId) {
    const savedPuzzleData = await getServerPuzzle(serverId);

    try {
        const puzzleData = await getPuzzleRequestData(serverId);
        if (!puzzleData) return false;

        const parData = await getParRequestData(serverId);
        if (parData) {
            if (JSON.stringify(puzzleData.parDetails) !== JSON.stringify(parData.parDetails)) {
                await updatePuzzleParDetails(puzzleData.puzzle_uuid, parData.parDetails);
            }
        }

        if (savedPuzzleData && savedPuzzleData.puzzle_uuid === puzzleData.puzzle_uuid) {
            return {isNew: false, newPuzzleData: null, oldPuzzleData: savedPuzzleData};
        }
        return {isNew: true, newPuzzleData: puzzleData, oldPuzzleData: savedPuzzleData};
    } catch (e) {
        devLog(client, e, "Fetching new Clue");
        return false;
    }
}
