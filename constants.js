export const COLOURS = {
    indicators : {
        hex: "#f5d1fd",
        ansi: "\u001b[45m"
    },
    fodder: {
        hex: "#fff2b1",
        ansi: "\u001b[43m"
    },
    definition: {
        hex: "#add3ff",
        ansi: "\u001b[46m"
    },
    default: {
        hex: "#f4f5f6",
        ansi: "\u001b[0m"
    },
    leaderboard: {
        hex: "#ffd700",
        ansi: ""
    }
}

export const SPACES = {
    zws: "\u200B",
    ems: "\u2003"
}

export const URLS = {
    minuteCryptic: "https://minutecryptic.com",
    coursePrefix: "https://www.minutecryptic.com/course",
    currentClue: "https://www.minutecryptic.com/api/daily_puzzle/today?tz=",
    puzzlePar: "https://www.minutecryptic.com/api/daily_puzzle/par/"
}

export const COURSES = {
    letterplay: `\n-# [Basics](${URLS.coursePrefix}/letterplay/basics/1)\n-# [Anagrams](${URLS.coursePrefix}/letterplay/anagrams/1)\n-# [Selectors](${URLS.coursePrefix}/letterplay/selectors/1)\n-# [Hiddens](${URLS.coursePrefix}/letterplay/hiddens/1)\n-# [Reversals](${URLS.coursePrefix}/letterplay/reversals/1)`,
    wordplay: `\n-# [Synonyms](${URLS.coursePrefix}/wordplay/synonyms/1)\n-# [Symbols](${URLS.coursePrefix}/wordplay/symbols/1)\n-# [Containers](${URLS.coursePrefix}/wordplay/containers/1)\n-# [Deletions](${URLS.coursePrefix}/wordplay/deletions/1)\n-# [Homophones](${URLS.coursePrefix}/wordplay/homophones/1)`,
    weirdplay: `\n-# [Translations](${URLS.coursePrefix}/weirdplay/translation/1)\n-# [Homoglyphs](${URLS.coursePrefix}/weirdplay/homoglyphs/1)\n-# [Double Definitions](${URLS.coursePrefix}/weirdplay/double-definitions/1)\n-# [Rebuses](${URLS.coursePrefix}/weirdplay/rebuses/1)\n-# [&lits](${URLS.coursePrefix}/weirdplay/and-lits/1)`
}