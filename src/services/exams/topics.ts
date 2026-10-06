import type { AttemptRecord } from "./storage";
import { studyProgress, hasExamFile, type StudyPlanRecord, type DayProgress } from "./study-plan";

/** "planId/topicId": topics from every uploaded plan share one key space. */
export const topicKey = (planId: string, topicId: string) => `${planId}/${topicId}`;

/** One resolved topic: its plan, the plan's day source, and derived progress. */
export interface TopicItem {
  record: StudyPlanRecord;
  progress: DayProgress | undefined;
  topic: StudyPlanRecord["plan"]["days"][number];
  key: string;
}

/**
 * Every topic of every plan, newest plan first. A configured exam still waiting
 * for its file has no derived progress yet. A paper's plan has one topic.
 */
export function topicList(plans: StudyPlanRecord[], attempts: AttemptRecord[]): TopicItem[] {
  return plans.flatMap((record) =>
    hasExamFile(record)
      ? studyProgress(record, attempts).map((progress, i) => ({
          record,
          progress: progress as DayProgress | undefined,
          topic: record.plan.days[i],
          key: topicKey(record.id, progress.id),
        }))
      : record.plan.days.map((topic) => ({
          record,
          progress: undefined,
          topic,
          key: topicKey(record.id, topic.id),
        })),
  );
}
