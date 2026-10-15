export type CompetitionFieldStatus = "known" | "unknown" | "not_stated" | "not_applicable" | "pending" | "conflict";
export interface CompetitionField<T> {
  value: T | null;
  status: CompetitionFieldStatus;
  reason: string;
}
export interface CompetitionLimit {
  scope: string;
  text: string;
  minimum: number | null;
  maximum: number | null;
  counts: "students" | "teachers" | "total_including_teacher" | "teacher_group" | "other";
}
export interface CompetitionTime {
  scope: string;
  label: string;
  officialText: string;
  precision: "minute" | "day" | "month" | "approximate";
  timezone: string;
  start: string | null;
  end: string | null;
}
export type CompetitionActivity = "registration_open" | "registration_upcoming" | "registration_closed" | "competition_ongoing" | "competition_upcoming" | "competition_finished" | "unknown";
export interface CompetitionNode {
  kind: "registration_start" | "registration_end" | "competition_start" | "competition_end";
  scope: string;
  label: string;
  officialText: string;
  precision: "day" | "minute";
  timezone: string;
  date: string;
  daysRemaining: number;
}
export interface CompetitionRecord {
  competitionId: string;
  catalogueName: string;
  editionId: string;
  revisionId: string;
  version: number;
  publishedAt: string;
  name: CompetitionField<string>;
  year: CompetitionField<{ primary: number; officialText: string }>;
  promotionImage: CompetitionField<string>;
  categories: CompetitionField<string[]>;
  schoolRecognition: {
    schoolLevel: string | null;
    schoolLevelByScope: Array<{ scope: string; level: string }>;
    schoolRecognitionText: string | null;
  };
  participantLimit: CompetitionField<CompetitionLimit[]>;
  teacherLimit: CompetitionField<CompetitionLimit[]>;
  registrationTimes: CompetitionField<CompetitionTime[]>;
  competitionTimes: CompetitionField<CompetitionTime[]>;
  stages: CompetitionField<string[]>;
  officialWebsite: CompetitionField<string>;
  files: CompetitionField<Array<{ title: string; url: string }>>;
  introduction: CompetitionField<string>;
  activity: Array<{ kind: "registration" | "competition"; scope: string; label: string; status: CompetitionActivity }>;
  nextNodes: CompetitionNode[];
  sources: Array<{ url: string; fetchedAt: string }>;
}
export interface CompetitionList {
  items: CompetitionRecord[];
  total: number;
  page: number;
  pageSize: number;
  computedAt: string;
}
export interface CompetitionDetail {
  item: CompetitionRecord;
  editions: Array<{ editionId: string; name: string | null; year: number | null }>;
  computedAt: string;
}
export interface CompetitionFilters {
  categories: string[];
  schoolLevels: string[];
  years: number[];
  hasUnknownYear: boolean;
  activities: CompetitionActivity[];
  sorts: Array<"catalogue" | "year_desc" | "next_node">;
}
