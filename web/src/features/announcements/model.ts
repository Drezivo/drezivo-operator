/** One announcement emailed to every client business, with delivery progress from its jobs. */
export type Announcement = {
  id: string;
  subject: string;
  body: string;
  created_by: string;
  recipient_count: number;
  created_at: string;
  delivered: number;
  queued: number;
  failed: number;
};
export type SentAnnouncement = { id: string; subject: string; recipient_count: number; created_at: string; replayed: boolean };

export const announcementPaths = { list: "/announcements", send: "/announcements" } as const;
export const SUBJECT_MAX = 160;
export const BODY_MAX = 5000;
