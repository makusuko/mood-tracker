// recoveryPatterns.ts
//
// Detects "recovery episodes" — sequences where mood dipped below a threshold
// and (hopefully) climbed back above a recovery threshold for a sustained run.
//
// Pulled out of the React component so:
//   - The detection logic can be unit-tested with synthetic series.
//   - The component stays a thin renderer.
//   - The <2-data-point edge case (which crashed before) is handled here.
import { Activity } from "@/components/types";
import { daysBetween } from "./dateHelpers";

export const RECOVERY_THRESHOLD = 6.0;
export const DIP_THRESHOLD = 4.0;
export const NONRECOVERY_THRESHOLD = 5.0;
export const MIN_RECOVERY_DAYS = 2;
export const MIN_NONRECOVERY_DAYS = 4;

export type MoodActivityRow = {
    id: number;
    date: string;
    mood: number;
    activities: Activity[];
};

export type MoodEntry = {
    date: string;
    mood: number;
}

export type RecoveryEpisode = {
    startDate: string;
    endDate: string | null;
    worstMood: number;
    currentMood: number;
    worseningActivities: Set<Activity>;
    recoveringActivities: Set<Activity>;
    entries: MoodEntry[];
    durationDays: number;
    dips: number;
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
    let currentEntries: MoodActivityRow[] = []
    let startOfRecovery: string | null = null;
    let startOfNonRecovery: string | null = null;
    let activityOccurance: Map<Activity, {worsening: number, recovering: number}> = new Map();

    for (const entry of entries) {
        if (!entry || typeof entry.date !== 'string') continue;
        if (typeof entry.mood !== 'number' || !Number.isFinite(entry.mood)) continue;
        if (Number.isNaN(new Date(entry.date).getTime())) continue;

        const mood = entry.mood;
        if (!currentEp && mood <= DIP_THRESHOLD) {
            currentEp = {
                startDate: entry.date,
                endDate: null,
                worstMood: mood,
                currentMood: mood,
                durationDays: 0,
                dips: 1,
                entries: [],
                worseningActivities: new Set(),
                recoveringActivities: new Set(),
                recovered: false,
            };
            startOfRecovery = null;
            startOfNonRecovery = null;

            currentEntries = [entry];

            activityOccurance = new Map();
            entry.activities.forEach((a) => activityOccurance.set(a, {worsening: 1, recovering: 0}));
        } else if (currentEp && mood >= RECOVERY_THRESHOLD) {
            currentEntries.push(entry);
            currentEp.currentMood = mood;
            currentEp.durationDays = daysBetween(currentEp.startDate, entry.date);
            entry.activities.forEach((a) => {
                const occurance = activityOccurance.get(a) ?? {worsening: 0, recovering: 0};
                occurance.recovering += 1;
                activityOccurance.set(a, occurance);
            });

            if (startOfRecovery == null) {
                startOfRecovery = entry.date;
                continue;
            }

            const recoveryDays = daysBetween(startOfRecovery, entry.date);
            if (recoveryDays >= MIN_RECOVERY_DAYS) {
                currentEp.recovered = true;
                currentEp.endDate = entry.date;
                currentEp.entries = currentEntries.map((e) => ({date: e.date, mood: e.mood}));

                const activities = [...activityOccurance.entries()]
                currentEp.worseningActivities = new Set(activities.filter((v) => {
                    const [_, {worsening, recovering}] = v;
                    return worsening > recovering;
                }).sort((v1, v2) => v2[1].worsening - v1[1].worsening).splice(0, 10).map((v) => v[0]));
                currentEp.recoveringActivities = new Set(activities.filter((v) => {
                    const [_, {worsening, recovering}] = v;
                    return recovering > worsening;                        
                }).sort((v1, v2) => v2[1].recovering - v1[1].recovering).splice(0, 10).map((v) => v[0]));

                episodes.push(currentEp);
                currentEp = null;
            }
        }
        else if (currentEp) {
            if (mood < currentEp.worstMood)
                currentEp.worstMood = mood;

            currentEntries.push(entry);
            currentEp.durationDays = daysBetween(currentEp.startDate, entry.date);

            if (mood > currentEp.currentMood)
                entry.activities.forEach((a) => {
                    const occurance = activityOccurance.get(a) ?? {worsening: 0, recovering: 0};
                    occurance.recovering += 1;
                    activityOccurance.set(a, occurance);
                });
            else if (mood < currentEp.currentMood)
                entry.activities.forEach((a) => {
                    const occurance = activityOccurance.get(a) ?? {worsening: 0, recovering: 0};
                    occurance.worsening += 1;
                    activityOccurance.set(a, occurance);
                });

            if (mood <= DIP_THRESHOLD) {
                if (currentEp.currentMood >= NONRECOVERY_THRESHOLD)
                    currentEp.dips += 1;

                currentEp.currentMood = mood;
                startOfRecovery = null;
                startOfNonRecovery = null;
            } 
            else if (mood >= NONRECOVERY_THRESHOLD) {
                currentEp.currentMood = mood;
                if (startOfNonRecovery == null) {
                    startOfNonRecovery = entry.date;
                    startOfRecovery = null;
                    continue;
                }

                const recoveryDays = daysBetween(startOfNonRecovery, entry.date);
                if (recoveryDays >= MIN_NONRECOVERY_DAYS) {
                    currentEp.recovered = false;
                    currentEp.endDate = entry.date;
                    currentEp.entries = currentEntries.map((e) => ({date: e.date, mood: e.mood}));

                    const activities = [...activityOccurance.entries()]
                    currentEp.worseningActivities = new Set(activities.filter((v) => {
                        const [_, {worsening, recovering}] = v;
                        return worsening > recovering;
                    }).sort((v1, v2) => v2[1].worsening - v1[1].worsening).splice(0, 10).map((v) => v[0]));
                    currentEp.recoveringActivities = new Set(activities.filter((v) => {
                        const [_, {worsening, recovering}] = v;
                        return recovering > worsening;
                    }).sort((v1, v2) => v2[1].recovering - v1[1].recovering).splice(0, 10).map((v) => v[0]));

                    episodes.push(currentEp);
                    currentEp = null;
                }
            } else {
                currentEp.currentMood = mood;
            }
        }
    }

    if (currentEp)
        currentEp.entries = currentEntries.map((e) => ({date: e.date, mood: e.mood}));

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