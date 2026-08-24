import pg from "pg";
const { Pool, Client } = pg;

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});
pool.on('error', (err, client) => {
    console.error('Unexpected error on idle database client:', err.message);
});
async function initiateDatabase() {

    const initClient = new Client({
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: "postgres",
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT,
    });
    await initClient.connect();


    const res = await initClient.query(
        `SELECT datname FROM pg_catalog.pg_database WHERE datname = $1`, 
        [process.env.DB_NAME]
    );

    if (res.rowCount === 0) {
        console.log(`Database "${process.env.DB_NAME}" does not exist. Creating it now...`);
        await initClient.query(`CREATE DATABASE "${process.env.DB_NAME}"`);
    }

    await initClient.end();
}

export async function createTables() {
    try {
        // await initiateDatabase();

        await pool.query(`
            CREATE TABLE IF NOT EXISTS "user" (
                id SERIAL PRIMARY KEY,
                user_id TEXT UNIQUE NOT NULL,
                servers TEXT[],
                solves INT NOT NULL DEFAULT 0,
                perfect_solves INT NOT NULL DEFAULT 0,
                last_solve DATE,
                streak INT NOT NULL DEFAULT 0,
                max_streak INT NOT NULL DEFAULT 0,
                min_help_used INT NOT NULL DEFAULT 0,
                max_help_used INT NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS puzzle (
                id SERIAL PRIMARY KEY,
                puzzle_uuid UUID UNIQUE NOT NULL,
                answer TEXT,
                clue TEXT[],
                puzzle_pieces TEXT[],
                letter_reveal_order INT[],
                par INT,
                explainer_video TEXT,
                date DATE,
                hints JSONB,
                par_details JSONB,
                setter_name TEXT
            );

            CREATE TABLE IF NOT EXISTS solve_stat (
                id SERIAL PRIMARY KEY,
                puzzle_id INT REFERENCES puzzle(id) ON DELETE CASCADE,
                user_id INT REFERENCES "user"(id) ON DELETE CASCADE,
                is_finished BOOLEAN DEFAULT false,
                revealed_puzzle_pieces INT[],
                help_used TEXT[],
                revealed_hint_types TEXT[],
                started_at TIMESTAMP WITH TIME ZONE,
                completed_at TIMESTAMP WITH TIME ZONE,
                UNIQUE(user_id, puzzle_id)
            );

            CREATE TABLE IF NOT EXISTS server_user (
                server_id TEXT NOT NULL,
                user_id INT REFERENCES "user"(id) ON DELETE CASCADE,
                PRIMARY KEY (server_id, user_id)
            );

            CREATE TABLE IF NOT EXISTS server_setting (
                server_id TEXT PRIMARY KEY,
                timezone TEXT NOT NULL DEFAULT 'Europe/Berlin',
                channel_id TEXT,
                current_puzzle_uuid TEXT,
                current_puzzle_date DATE,
                current_puzzle_message_id TEXT,
                puzzle_stat JSONB[]
            );
        `);

        console.log("Tables created successfully!");
    } catch (err) {
        console.error("Error creating tables:", err);
    }
}

/**
 * gets or creates a user and links them to the current server
 * returns the internal db id (the SERIAL one) for the user
 */
export async function getOrAddUser(discordUserId, serverId) {
    try {
        const { rows } = await pool.query(`
            INSERT INTO "user" (user_id)
            VALUES ($1)
            ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
            RETURNING id;
        `, [discordUserId]);

        const internalId = rows[0].id;

        // link the user to the server so highscores work
        if (serverId) {
            await pool.query(`
                INSERT INTO server_user (server_id, user_id)
                VALUES ($1, $2)
                ON CONFLICT DO NOTHING;
            `, [serverId, internalId]);
        }

        return internalId;
    } catch (err) {
        console.error("error adding user:", err);
    }
}

/**
 * saves the puzzle data from the api
 * returns the internal db id for the puzzle
 */
export async function savePuzzle(puzzleData) {
    try {
        // map clue to just an array of the text strings (ignoring type)
        const clueTexts = puzzleData.clue.map(c => c.text);
        
        // map puzzle pieces to just an array of the answer letters (ignoring isRevealed and input)
        const pieceAnswers = Object.values(puzzleData.puzzlePieces).map(p => p.answer);
        
        // filter hints to only keep the properties needed (ignoring color)
        const filteredHints = puzzleData.hints.map(h => ({
            text: h.text,
            type: h.type,
            highlighting: h.highlighting
        }));

        // filter par details (ignoring the three different solvetimeseconds vars)
        const filteredParDetails = {
            averagePar: puzzleData.parDetails.averagePar,
            solveCount: puzzleData.parDetails.solveCount,
            medianSolveTimeSeconds: puzzleData.parDetails.medianSolveTimeSeconds
        };

        const { rows } = await pool.query(`
            INSERT INTO puzzle (
                puzzle_uuid, date, answer, par, setter_name, 
                clue, puzzle_pieces, letter_reveal_order, explainer_video, 
                hints, par_details
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (puzzle_uuid) DO UPDATE
            SET par_details = EXCLUDED.par_details
            RETURNING id;
        `, [
            puzzleData.puzzleId,
            puzzleData.date,
            puzzleData.answer,
            puzzleData.par,
            puzzleData.setterName,
            clueTexts,
            pieceAnswers,
            puzzleData.letterRevealOrder,
            puzzleData.explainerVideo,
            JSON.stringify(filteredHints),
            JSON.stringify(filteredParDetails)
        ]);

        return rows[0].id;
    } catch (err) {
        console.error("error saving puzzle:", err);
    }
}

export async function updatePuzzleParDetails(puzzleUuid, parDetails) {
    try {
        await pool.query(`
            UPDATE puzzle
            SET par_details = $1
            WHERE puzzle_uuid = $2
        `, [ JSON.stringify(parDetails), puzzleUuid ]);
    } catch (err) {
        console.error("error updating puzzleParDetails");
    }
}

export async function getPuzzleByUuid(uuid) {
    try {
        const { rows } = await pool.query(`
            SELECT * FROM puzzle WHERE puzzle_uuid = $1
        `, [uuid]);
        return rows.length > 0 ? rows[0] : null;
    } catch (error) {
        console.error('error fetching puzzle by uuid:', error);
        return null;
    }
}

export async function updateServerMessageId(serverId, messageId) {
    try {
        await pool.query(`
            UPDATE server_setting 
            SET current_puzzle_message_id = $2 
            WHERE server_id = $1
        `, [serverId, messageId]);
    } catch (err) {
        console.error("error updating server message id:", err);
    }
}

export async function getServerMessageId(serverId) {
    try {
        const { rows } = await pool.query(`
            SELECT current_puzzle_message_id FROM server_setting WHERE server_id = $1
        `, [serverId]);
        return rows.length > 0 ? rows[0].current_puzzle_message_id : null;
    } catch (error) {
        console.error('error fetching server message id:', error);
        return null;
    }
}

/**
 * saves or updates a users solve attempt
 */
export async function saveSolveStat(internalUserId, internalPuzzleId, statData) {
    try {
        // grab the index keys where isRevealed is true, and convert them to integers
        const revealedPieces = Object.entries(statData.puzzlePieces || {})
            .filter(([_, piece]) => piece.isRevealed)
            .map(([index, _]) => parseInt(index, 10));

        await pool.query(`
            INSERT INTO solve_stat (
                user_id, puzzle_id, is_finished, help_used, 
                revealed_puzzle_pieces, revealed_hint_types, 
                started_at, completed_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (user_id, puzzle_id)
            DO UPDATE SET
                is_finished = EXCLUDED.is_finished,
                help_used = EXCLUDED.help_used,
                revealed_puzzle_pieces = EXCLUDED.revealed_puzzle_pieces,
                revealed_hint_types = EXCLUDED.revealed_hint_types,
                completed_at = EXCLUDED.completed_at;
        `, [
            internalUserId,
            internalPuzzleId,
            statData.isFinished,
            statData.helpUsed,
            revealedPieces, 
            statData.revealedHintTypes, 
            statData.startedAt,
            statData.completedAt 
        ]);
        console.log(`saved stat for user ${internalUserId} on puzzle ${internalPuzzleId}`);
    } catch (err) {
        console.error("error saving solve stat:", err);
    }
}

export async function updateUserAfterSolve(internalUserId, currentDateStr, helpUsedCount) {
    try {
        await pool.query(`
            UPDATE "user"
            SET 
                streak = CASE 
                    WHEN last_solve = $2::DATE THEN streak 
                    WHEN last_solve = $2::DATE - INTERVAL '1 day' THEN streak + 1 
                    ELSE 1 
                END,
                max_streak = GREATEST(max_streak, 
                    CASE 
                        WHEN last_solve = $2::DATE THEN streak 
                        WHEN last_solve = $2::DATE - INTERVAL '1 day' THEN streak + 1 
                        ELSE 1 
                    END
                ),
                last_solve = $2::DATE,
                solves = solves + 1,
                perfect_solves = perfect_solves + CASE WHEN $3::INT = 0 THEN 1 ELSE 0 END,
                min_help_used = CASE WHEN solves = 0 THEN $3::INT ELSE LEAST(min_help_used, $3::INT) END,
                max_help_used = CASE WHEN solves = 0 THEN $3::INT ELSE GREATEST(max_help_used, $3::INT) END
            WHERE id = $1;
        `, [internalUserId, currentDateStr, helpUsedCount]);
    } catch (err) {
        console.error("error updating user stats:", err);
    }
}

/**
 * gets the timezone for a server, defaulting to Europe/Berlin if none is set
 */
export async function getServerTimezone(serverId) {
    try {
        const { rows } = await pool.query(`
            SELECT timezone FROM server_setting WHERE server_id = $1
        `, [serverId]
        );
        return rows.length > 0 ? rows[0].timezone : 'Europe/Berlin';
    } catch (error) {
        console.error('error fetching server timezone:', error);
        return 'Europe/Berlin';
    }
}

/**
 * updates or sets the puzzle for a server
 */
export async function updateServerPuzzle(serverId, puzzle_uuid, puzzle_date) {
    try {
        await pool.query(`
            INSERT INTO server_setting (server_id, current_puzzle_uuid, current_puzzle_date)
            VALUES ($1, $2, $3)
            ON CONFLICT (server_id)
            DO UPDATE SET 
                current_puzzle_uuid = EXCLUDED.current_puzzle_uuid,
                current_puzzle_date = EXCLUDED.current_puzzle_date
        `, [serverId, puzzle_uuid, puzzle_date]
        );
        console.log(`updated current puzzle for server ${serverId} to ${puzzle_uuid} at ${puzzle_date}`);
    } catch (err) {
        console.error("error updating server puzzle:", err);
    }
}

/**
 * gets current server puzzle
 */
export async function getServerPuzzle(serverId) {
    try {
        let uuid;
        const { rows } = await pool.query(`
            SELECT current_puzzle_uuid FROM server_setting WHERE server_id = $1
        `, [serverId]
        );
        if (rows.length === 0 || !rows[0].current_puzzle_uuid) {
            return null;
        }

        uuid = rows[0].current_puzzle_uuid;
        const { rows: pRows } = await pool.query(`
            SELECT * FROM puzzle WHERE puzzle_uuid = $1
        `, [uuid]);

        return pRows.length > 0 ? pRows[0] : null;
    } catch (error) {
        console.error('error fetching server puzzle:', error);
        return null;
    }
}

/**
 * updates or sets the timezone for a server
 */
export async function updateServerTimezone(serverId, timezone) {
    try {
        await pool.query(`
            INSERT INTO server_setting (server_id, timezone)
            VALUES ($1, $2)
            ON CONFLICT (server_id)
            DO UPDATE SET timezone = EXCLUDED.timezone
        `, [serverId, timezone]
        );
        console.log(`updated timezone for server ${serverId} to ${timezone}`);
    } catch (err) {
        console.error("error updating server timezone:", err);
    }
}


/**
 * gets the active channel for a server
 */
export async function getServerChannel(serverId) {
    try {
        const { rows } = await pool.query(`
            SELECT channel_id FROM server_setting WHERE server_id = $1
        `, [serverId]
        );
        return rows.length > 0 ? rows[0].channel_id : null;
    } catch (error) {
        console.error('error fetching server channel_id:', error);
        return null;
    }
}

/**
 * updates or sets the active channel for a server
 */
export async function updateServerChannel(serverId, channelId) {
    try {
        await pool.query(`
            INSERT INTO server_setting (server_id, channel_id)
            VALUES ($1, $2)
            ON CONFLICT (server_id)
            DO UPDATE SET channel_id = EXCLUDED.channel_id
        `, [serverId, channelId]
        );
        console.log(`updated channel_id for server ${serverId} to ${channelId}`);
    } catch (err) {
        console.error("error updating server channel_id:", err);
    }
}

export async function getServerPuzzleDate(serverId) {
    try {
        const { rows } = await pool.query(`
            SELECT TO_CHAR(current_puzzle_date, 'YYYY-MM-DD') AS current_puzzle_date
            FROM server_setting
            WHERE server_id = $1
        `, [serverId]);

        return rows.length > 0 ? rows[0].current_puzzle_date : null;
    } catch (error) {
        console.error('error fetching server puzzle date:', error);
        return null;
    }
}

/**
 * Gets aggregate server stats for a specific puzzle (Solves, Avg Help, Avg Time)
 */
export async function getServerPuzzleStat(puzzleUuid, serverId) {
    try {
        const { rows } = await pool.query(`
            SELECT 
                COUNT(s.id)::int as total_solves,
                COALESCE(AVG(cardinality(s.help_used)), 0)::numeric(10,1) as average_help,
                COALESCE(AVG(EXTRACT(EPOCH FROM (s.completed_at - s.started_at))), 0)::numeric(10,1) as average_time
            FROM solve_stat s
            JOIN "user" u ON s.user_id = u.id
            JOIN server_user su ON u.id = su.user_id
            JOIN puzzle p ON s.puzzle_id = p.id
            WHERE su.server_id = $1 AND p.puzzle_uuid = $2 AND s.is_finished = true
        `, [serverId, puzzleUuid]);
        
        if (rows.length > 0) return rows[0];
        
        return { total_solves: 0, average_help: 0, average_time: 0 };
    } catch (err) {
        console.error("error fetching server puzzle stat:", err);
        return { total_solves: 0, average_help: 0, average_time: 0 };
    }
}

/**
 * Appends a requested hint type (indicator, fodder, definition) to user stats
 */
export async function updateUserHintReveals(internalUserId, internalPuzzleId, hintType) {
    try {
        await pool.query(`
            INSERT INTO solve_stat (user_id, puzzle_id, revealed_hint_types, help_used, started_at)
            VALUES ($1, $2, ARRAY[$3]::TEXT[], ARRAY['HINT']::TEXT[], NOW())
            ON CONFLICT (user_id, puzzle_id)
            DO UPDATE SET 
                revealed_hint_types = array_append(COALESCE(solve_stat.revealed_hint_types, ARRAY[]::TEXT[]), $3::TEXT),
                help_used = array_append(COALESCE(solve_stat.help_used, ARRAY[]::TEXT[]), 'HINT');
        `, [internalUserId, internalPuzzleId, hintType]);
    } catch (err) {
        console.error("error updating hint reveals:", err);
    }
}

/**
 * creates default server settings when the bot joins a new server
 */
export async function initializeServer(serverId) {
    try {
        await pool.query(`
            INSERT INTO server_setting (server_id, timezone)
            VALUES ($1, 'Europe/Berlin')
            ON CONFLICT (server_id) DO NOTHING;
        `, [serverId]);
        console.log(`initialized default settings for new server: ${serverId}`);
    } catch (err) {
        console.error("error initializing server:", err);
    }
}
/**
 * deletes the settings and user links for a server
 */
export async function deleteServerSettings(serverId) {
    try {
        await pool.query('DELETE FROM server_user WHERE server_id = $1', [serverId]);
        await pool.query('DELETE FROM server_setting WHERE server_id = $1', [serverId]);
        console.log(`deleted settings and user links for server ${serverId}`);
    } catch (err) {
        console.error("error deleting server settings:", err);
    }
}

/**
 * gets the stats for a specific discord user
 */
export async function getUserStats(discordUserId) {
    try {
        const { rows } = await pool.query(`
            SELECT
                u.streak,
                u.max_streak,
                u.solves as total_solves,
                u.perfect_solves,
                u.last_solve as last_solve_date,
                u.min_help_used as least_help,
                u.max_help_used as max_help,
                COALESCE(AVG(cardinality(s.help_used)), 0)::numeric(10,1) as avg_help,
                COALESCE(AVG(EXTRACT(EPOCH FROM (s.completed_at - s.started_at))), 0)::numeric(10,1) as avg_time,
                COALESCE(AVG(cardinality(s.help_used) - p.par), 0)::numeric(10,1) as avg_par_diff
            FROM "user" u
            LEFT JOIN solve_stat s ON u.id = s.user_id AND s.is_finished = true
            LEFT JOIN puzzle p ON s.puzzle_id = p.id
            WHERE u.user_id = $1
            GROUP BY u.id;
        `, [discordUserId]);

        return rows[0] || null;
    } catch (err) {
        console.error("error fetching user stats:", err);
        return null;
    }
}

export async function getServerGlobalStats(serverId) {
    try {
        const { rows } = await pool.query(`
            SELECT
                COALESCE(AVG(cardinality(s.help_used)), 0)::numeric(10,1) as server_avg_help,
                COALESCE(AVG(EXTRACT(EPOCH FROM (s.completed_at - s.started_at))), 0)::numeric(10,1) as server_avg_time,
                COALESCE(AVG(cardinality(s.help_used) - p.par), 0)::numeric(10,1) as server_avg_par_diff
            FROM solve_stat s
            JOIN puzzle p ON s.puzzle_id = p.id
            JOIN "user" u ON s.user_id = u.id
            JOIN server_user su ON u.id = su.user_id
            WHERE su.server_id = $1 AND s.is_finished = true
        `, [serverId]);

        return rows[0] || { server_avg_help: 0, server_avg_time: 0, server_avg_par_diff: 0 };
    } catch (err) {
        console.error("error fetching server global stats:", err);
        return { server_avg_help: 0, server_avg_time: 0, server_avg_par_diff: 0 };
    }
}

/**
 * gets the top 10 players in a specific server
 */
export async function getServerLeaderboard(serverId) {
    try {
        const { rows } = await pool.query(`
            SELECT u.user_id, u.streak, u.solves as total_solves
            FROM "user" u
            JOIN server_user su ON u.id = su.user_id
            WHERE su.server_id = $1
            ORDER BY total_solves DESC;
        `, [serverId]);
        
        return rows;
    } catch (err) {
        console.error("error fetching server leaderboard:", err);
        return [];
    }
}

export async function getPuzzleReveals(internalPuzzleId) {
    return await pool.query(
        'SELECT letter_reveal_order, puzzle_pieces FROM puzzle WHERE id = $1',
        [internalPuzzleId]
    );
}

export async function getUserPuzzleReveals(internalUserId, internalPuzzleId) {
    return await pool.query(
        'SELECT revealed_puzzle_pieces, revealed_hint_types, is_finished FROM solve_stat WHERE user_id = $1 AND puzzle_id = $2',
        [internalUserId, internalPuzzleId]
    );
}
export async function updateUserPuzzleReveals(internalUserId, internalPuzzleId, nextPieceIndex) {
    await pool.query(`
        INSERT INTO solve_stat (user_id, puzzle_id, revealed_puzzle_pieces, help_used, started_at)
        VALUES ($1, $2, ARRAY[$3]::INT[], ARRAY['LETTER']::TEXT[], NOW())
        ON CONFLICT (user_id, puzzle_id)
        DO UPDATE SET 
            revealed_puzzle_pieces = array_append(COALESCE(solve_stat.revealed_puzzle_pieces, ARRAY[]::INT[]), $3::INT),
            help_used = array_append(COALESCE(solve_stat.help_used, ARRAY[]::TEXT[]), 'LETTER');
    `, [internalUserId, internalPuzzleId, nextPieceIndex]);
    
}

export async function getAllServerSettings() {
    try {
        // Parentheses removed from the SELECT statement
        const { rows } = await pool.query(
            'SELECT server_id, timezone, channel_id, current_puzzle_uuid, current_puzzle_date FROM server_setting'
        );
        return rows;
    } catch (err) {
        console.error("error fetching all server settings:", err);
        return [];
    }
}
/**
 * Starts the timer for a user without them needing to use a hint
 */
export async function startUserPuzzle(internalUserId, internalPuzzleId) {
    try {
        await pool.query(`
            INSERT INTO solve_stat (user_id, puzzle_id, started_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (user_id, puzzle_id) DO NOTHING;
        `, [internalUserId, internalPuzzleId]);
    } catch (err) {
        console.error("error starting user puzzle:", err);
    }
}

/**
 * Marks a player's puzzle attempt as finished
 */
export async function finishUserPuzzle(internalUserId, internalPuzzleId) {
    try {
        await pool.query(`
            INSERT INTO solve_stat (user_id, puzzle_id, is_finished, started_at, completed_at, help_used)
            VALUES ($1, $2, true, NOW(), NOW(), ARRAY[]::TEXT[])
            ON CONFLICT (user_id, puzzle_id)
            DO UPDATE SET 
                is_finished = true,
                completed_at = COALESCE(solve_stat.completed_at, NOW())
        `, [internalUserId, internalPuzzleId]);
    } catch (err) {
        console.error("error finishing user puzzle:", err);
    }
}

/**
 * Gets a user's final solve details to calculate timing and hint usage
 */
export async function getUserSolve(internalUserId, internalPuzzleId) {
    try {
        const { rows } = await pool.query(`
            SELECT help_used, EXTRACT(EPOCH FROM (completed_at - started_at)) as time_taken_seconds
            FROM solve_stat 
            WHERE user_id = $1 AND puzzle_id = $2
        `, [internalUserId, internalPuzzleId]);
        return rows.length > 0 ? rows[0] : null;
    } catch (err) {
        console.error("error fetching user solve:", err);
        return null;
    }
}
