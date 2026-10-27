// recoveryPatterns.ts
//
// Detects "recovery episodes" — sequences where mood dipped below a threshold
// and (hopefully) climbed back above a recovery threshold for a sustained run.
//
// Pulled out of the React component so:
//   - The detection logic can be unit-tested with synthetic series.
//   - The component stays a thin renderer.
//   - The <2-data-point edge case (which crashed before) is handled here.
import { daysBetween } from "./dateHelpers";

export const RECOVERY_THRESHOLD = 6.0;
export const DIP_THRESHOLD = 4.0;
export const MIN_RECOVERY_DAYS = 2;

export type MoodActivityRow = {
    date: string;
    mood: number;
    /** GROUP_CONCAT'd activity names — currently unused but kept for future use. */
    activity_names?: string | null;
};

export type RecoveryEpisode = {
    startDate: string;
    endDate: string | null;
    worstMood: number;
    currentMood: number;
    durationDays: number;
    recovered: boolean;
};

export type RecoveryAnalysis = {
    currentEpisode: RecoveryEpisode | null;
    historicalEpisodes: RecoveryEpisode[];
    successRate: number;  // 0..100
    avgDuration: number;  // mean days for completed episodes
};

/**
 * Analyse a list of mood entries (one row per day, sorted DESC by date — same
 * order the original SQL emits) and return episodes + summary stats.
 *
 * Gracefully handles 0, 1, or 2 data points — no crash, just empty episodes.
 */
export const analyseRecoveryPatterns = (
    entries: MoodActivityRow[]
): RecoveryAnalysis => {
    if (!entries || entries.length === 0) {
        return {
            currentEpisode: null,
            historicalEpisodes: [],
            successRate: 0,
            avgDuration: 0,
        };
    }

    const episodes: RecoveryEpisode[] = [];
    let currentEp: RecoveryEpisode | null = null;
    let startOfRecovery: string | null = null;

    for (const entry of entries) {
        const mood = entry.mood;

        if (!entry || typeof entry.date !== 'string') continue;
        if (typeof mood !== 'number' || !Number.isFinite(mood)) continue;
        const t = new Date(entry.date).getTime();
        if (Number.isNaN(t)) continue;

        if (!currentEp && mood <= DIP_THRESHOLD) {
            currentEp = {
                startDate: entry.date,
                endDate: null,
                worstMood: mood,
                currentMood: mood,
                durationDays: 0,
                recovered: false,
            };
            startOfRecovery = null;
        } else if (currentEp && mood >= RECOVERY_THRESHOLD) {
            currentEp.currentMood = mood;
            currentEp.durationDays = daysBetween(currentEp.startDate, entry.date);
            if (startOfRecovery == null) {
                startOfRecovery = entry.date;
                continue;
            }

            const recoveryDays = daysBetween(startOfRecovery, entry.date);
            if (recoveryDays >= MIN_RECOVERY_DAYS) {
                currentEp.recovered = true;
                currentEp.endDate = entry.date;
                episodes.push(currentEp);
                currentEp = null;
                startOfRecovery = null;
            }
        }
        else if (currentEp) {
            if (mood < currentEp.worstMood)
                currentEp.worstMood = mood;
            currentEp.durationDays = daysBetween(currentEp.startDate, entry.date);
            currentEp.currentMood = mood;
            startOfRecovery = null;
        }
    }

    const completed = episodes.filter((ep) => ep.endDate).sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
    const recovered = completed.filter((ep) => ep.recovered);

    const successRate =
        completed.length > 0 ? (recovered.length / completed.length) * 100 : 0;

    const avgDuration =
        completed.length > 0
            ? completed.reduce((s, ep) => s + ep.durationDays, 0) /
              completed.length
            : 0;

    return {
        currentEpisode: currentEp,
        historicalEpisodes: completed,
        successRate,
        avgDuration,
    };
};